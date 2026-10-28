import type { Metadata } from "next";
import Link from "next/link";
import { formatCrypto, formatFace } from "@bitocard/api-client/storefront";
import { toMinor } from "@afrippa/ui/trade-actions";
import { cardClass } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { OpenOrderForm } from "@/components/orders";
import { requireCustomer } from "@/lib/account";
import { marketPath } from "@/lib/api";
import { customerApi } from "@/lib/customer";
import { type EscrowAd, kindNames, type OrderPreview, type PaymentMethod, railOf } from "@/lib/orders-types";

export const metadata: Metadata = { title: "Open an order", robots: { index: false, follow: false } };

type Search = { fiat?: string; method?: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const radio = "flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50";

/**
 * Taking an ad: how much, and where the money goes (a sell ad's account the buyer pays into, or, selling to a buy ad,
 * one of the trader's own the buyer can pay into), then the order previewed with Afrippa's fees and opened on confirm.
 * The amount and account are a plain GET form, so the preview is the API's own answer.
 */
export default async function TakePage({ params, searchParams }: { params: Promise<{ ad: string }>; searchParams: Promise<Search> }) {
  const [{ ad: id }, search] = await Promise.all([params, searchParams]);
  const here = `/take/${id}${search.fiat ? `?${new URLSearchParams(search as Record<string, string>)}` : ""}`;
  await requireCustomer(here);
  if (!uuid.test(id)) return <Shell>{<p className={cardClass}>This ad is no longer available. Choose another.</p>}</Shell>;

  const found = await customerApi<EscrowAd>("GET", `/v1/afrippa/p2p/ads/${id}`);
  if (!found.ok)
    return (
      <Shell>
        <p className={cardClass}>
          {found.message}{" "}
          <Link href="/" className="font-semibold text-brand-700 underline">
            Back to the market
          </Link>
        </p>
      </Shell>
    );
  const ad = found.data;
  if (ad.mine) return <Shell>{<p className={cardClass}>This is your own ad. Other traders open orders on it.</p>}</Shell>;

  // Buying from a sell ad: pay into one of its accounts. Selling to a buy ad: be paid into one of your own it can pay.
  const buying = ad.side === "sell";
  let choices: Array<{ id: string; title: string; note: string }>;
  let noChoice: React.ReactNode = null;
  if (buying) {
    choices = ad.payment_methods.map(method => ({ id: method.id, title: method.label, note: `${kindNames[method.kind]}${method.reversible ? " · can be reversed by the payer" : ""}` }));
  } else {
    const own = await customerApi<{ data: PaymentMethod[] }>("GET", "/v1/afrippa/p2p/payment-methods");
    const rails = new Set(ad.payment_methods.map(railOf));
    choices = (own.ok ? own.data.data : [])
      .filter(method => method.currency === ad.currency && method.usable && rails.has(railOf(method)))
      .map(method => ({ id: method.id, title: `${method.label} ${method.hint}`, note: kindNames[method.kind] }));
    if (!choices.length)
      noChoice = (
        <p className="text-sm text-slate-600">
          The buyer pays from {ad.payment_methods.map(method => method.label).join(", ")}. Add an account in {ad.currency} they can pay into, in{" "}
          <Link href="/payment-methods" className="font-semibold text-brand-700 underline">
            Payment methods
          </Link>
          ; it can be used 24 hours after you add it.
        </p>
      );
  }

  const fiat = toMinor(search.fiat ?? "");
  const method = choices.find(choice => choice.id === search.method);
  const preview = fiat && method ? await customerApi<OrderPreview>("POST", "/v1/afrippa/p2p/orders", { ad_id: ad.id, price: ad.price, fiat, payment_method_id: method.id, preview: true }) : null;

  return (
    <Shell>
      <section className={`${cardClass} space-y-2`} aria-label="The ad">
        <p className="font-semibold">
          {buying ? "Buy" : "Sell"} {ad.asset} {buying ? "from" : "to"} {ad.trader.nickname}
        </p>
        <p className="text-sm text-slate-600">
          {formatFace(ad.price, ad.currency)} per {ad.asset} · {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)} · {formatCrypto(ad.available, ad.asset)} available
        </p>
        <p className="text-sm text-slate-600">
          {buying ? "You" : "The buyer"} pay{buying ? "" : "s"} within {ad.payment_window} minutes, directly into the seller&apos;s account. Afrippa holds the coins in escrow until the seller confirms the money arrived.
        </p>
        {ad.terms ? <p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap">{ad.terms}</p> : null}
      </section>

      <form method="get" className={`${cardClass} space-y-4`} aria-label="How much">
        <label className="block space-y-1.5 text-sm font-semibold">
          Amount in {ad.currency}
          <input name="fiat" inputMode="decimal" required defaultValue={search.fiat} placeholder={`${ad.min_fiat / 100} to ${ad.max_fiat / 100}`} className="min-h-12 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] font-normal" />
        </label>
        {noChoice ?? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{buying ? "You pay into" : "You are paid into"}</legend>
            {choices.map(choice => (
              <label key={choice.id} className={radio}>
                <input type="radio" name="method" value={choice.id} required defaultChecked={choice.id === search.method || choices.length === 1} className="mt-0.5" />
                <span>
                  <span className="block font-semibold">{choice.title}</span>
                  <span className="block text-slate-500">{choice.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {noChoice ? null : (
          <button type="submit" className="inline-flex min-h-12 items-center rounded-xl px-5 font-semibold ring-1 ring-slate-300 hover:ring-slate-400">
            See the order
          </button>
        )}
      </form>

      {preview ? (
        preview.ok ? (
          <section className={`${cardClass} space-y-4`} aria-label="Your order">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">{buying ? "You pay" : "You are paid"}</dt>
              <dd className="text-right font-semibold">{formatFace(preview.data.fiat, preview.data.currency)}</dd>
              <dt className="text-slate-500">Coins traded</dt>
              <dd className="text-right">{formatCrypto(preview.data.amount, preview.data.asset)}</dd>
              <dt className="text-slate-500">{buying ? "Afrippa’s fee (from what you receive)" : "Afrippa’s fee (on top, held in escrow)"}</dt>
              <dd className="text-right">{formatCrypto(buying ? preview.data.buyer_fee : preview.data.seller_fee, preview.data.asset)}</dd>
              <dt className="text-slate-500">{buying ? "You receive" : "The buyer receives"}</dt>
              <dd className="text-right font-semibold">{formatCrypto(preview.data.received, preview.data.asset)}</dd>
            </dl>
            <p className="text-sm text-slate-600">
              {buying
                ? `Pay within ${preview.data.payment_window} minutes from an account in your own name. Payments from anyone else are refused.`
                : `Your coins and the fee go into escrow now. Release them only once the money is in your account.`}
            </p>
            <OpenOrderForm adId={ad.id} price={ad.price} fiat={search.fiat ?? ""} methodId={method!.id} nonce={crypto.randomUUID()} label={buying ? "Open the order" : "Open the order and hold my coins"} />
          </section>
        ) : (
          <p className={cardClass} role="alert">
            {preview.message}
          </p>
        )
      ) : null}
      <Link href={marketPath(ad.market)} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
        Back to the market
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AccountShell title="Open an order" current="/orders">
      {children}
    </AccountShell>
  );
}
