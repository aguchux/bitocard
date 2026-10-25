/* eslint-disable @next/next/no-img-element -- the seller's cover photo, from the media CDN. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck, Wallet } from "lucide-react";
import { buyerOrderLabels, listingPath, listingRef, shopMoney, type ShopListingPage, type ShopOrder, type ShopSafePayQuote, type ShopViewer, type ShopWallet } from "@bitocard/api-client/classifieds";
import { SafePayOrderActions, SafePayRequest } from "@/components/safe-pay";
import { marketFor, shopApi } from "@/lib/api";
import { currentCustomer, customerApi, signInPath } from "@/lib/customer";
import { myShopHref } from "@/lib/handoff";

type Props = { params: Promise<{ cc: string; listing: string }>; searchParams: Promise<{ offer?: string }> };

export const metadata: Metadata = { title: "Buy with Safe pay", robots: { index: false, follow: false } };

const steps = ["You ask; the seller accepts.", "You pay from your BitoCard wallet. We hold the money.", "You check the item, then release the money.", "Not as described? Open a dispute and we decide."];

const unavailable: Record<string, string> = {
  safe_pay_unavailable: "Safe pay is not open here yet. You can still chat with the seller.",
  price_required: "This listing has no price: agree one by offer in the chat first, then buy at that price.",
  offer_not_accepted: "Use an offer the seller accepted in the last 7 days.",
  listing_reserved: "Someone has already paid for this with Safe pay.",
  safe_pay_limited: "This seller cannot take Safe pay orders right now. You can still chat with them.",
  classifieds_unavailable: "BitoCard Shop is not open in your country yet.",
};

/**
 * Buy with Safe pay (`/ng/l/<number>/buy`): how it protects the buyer, meet-up or delivery, the price, fee and total
 * and the wallet, then the request to the seller. Once asked, the same page shows the order: waiting for the seller,
 * then **Pay** from the wallet once they accept; from there the order continues in the Shop tab.
 */
export default async function BuyPage({ params, searchParams }: Props) {
  const { cc, listing: segment } = await params;
  const ref = listingRef(segment);
  if (!ref) notFound();
  const offer = (await searchParams).offer;
  const self = `/${cc}/l/${ref}/buy${offer ? `?offer=${encodeURIComponent(offer)}` : ""}`;
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(self, "buy"));

  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const page = await shopApi<ShopListingPage>(`/v1/classifieds/listings/${ref}?country=${market.country}`);
  if (!page.ok) notFound();
  const listing = page.data;
  const back = listingPath(cc, listing.ref, listing.slug);
  const viewer = await customerApi<ShopViewer>("GET", `/v1/classifieds/listings/${listing.id}/viewer`);
  const order = viewer.ok && viewer.data.order ? await customerApi<ShopOrder>("GET", `/v1/classifieds/orders/${viewer.data.order.id}`) : null;
  const quote = order?.ok ? null : await customerApi<ShopSafePayQuote>("GET", `/v1/classifieds/listings/${listing.id}/safe-pay${offer && /^[0-9a-f-]{36}$/.test(offer) ? `?offer_id=${offer}` : ""}`);
  const currency = order?.ok ? order.data.currency : quote?.ok ? quote.data.currency : listing.price.currency;
  const wallet = await customerApi<ShopWallet>("GET", `/v1/store/wallet?currency=${currency}`);
  const total = order?.ok ? (order.data.total ?? 0) : quote?.ok ? quote.data.total : 0;
  const balance = wallet.ok ? wallet.data.balance : null;
  const addFunds = customer.country ? myShopHref(customer.country, "/account/wallet") : null;
  const myOrder = order?.ok && customer.country ? myShopHref(customer.country, `/shop/orders/${order.data.id}`) : null;

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 pt-4">
      <header className="flex items-center gap-2">
        <Link href={back} className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-navy-50" aria-label="Back to the listing">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-extrabold">Buy with Safe pay</h1>
      </header>
      <Link href={back} className="flex items-center gap-3 rounded-2xl border border-navy-200 bg-white p-3">
        <span className="size-16 shrink-0 overflow-hidden rounded-xl bg-navy-100">{listing.photos[0] ? <img src={listing.photos[0].url} alt="" className="size-full object-cover" /> : null}</span>
        <span className="grid min-w-0">
          <strong className="truncate">{listing.title}</strong>
          <span className="text-sm text-navy-600">
            {listing.seller.name} · {listing.area.name}, {listing.area.state.name}
          </span>
        </span>
      </Link>

      {order?.ok ? (
        <section className="grid gap-4 rounded-2xl border border-navy-200 bg-white p-4" aria-labelledby="order">
          <div className="grid gap-1">
            <span className="text-xs font-semibold text-navy-500">{order.data.number}</span>
            <h2 id="order" className="text-lg font-bold">
              {buyerOrderLabels[order.data.status]}
            </h2>
            {order.data.status === "requested" ? <p className="text-sm text-navy-600">We will tell you when {order.data.with.name} answers, by {new Date(order.data.deadlines.accept_by).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.</p> : null}
            {order.data.status === "awaiting_payment" && order.data.deadlines.pay_by ? <p className="text-sm text-navy-600">Pay by {new Date(order.data.deadlines.pay_by).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} to reserve it for you.</p> : null}
          </div>
          <Money price={order.data.price} fee={order.data.buyer_fee ?? 0} total={total} currency={currency} />
          {order.data.status === "awaiting_payment" ? <WalletLine balance={balance} total={total} currency={currency} addFunds={addFunds} /> : null}
          <SafePayOrderActions orderId={order.data.id} canPay={order.data.status === "awaiting_payment"} canCancel={["requested", "awaiting_payment"].includes(order.data.status)} addFundsHref={addFunds} total={total} currency={currency} />
          {myOrder && !["requested", "awaiting_payment"].includes(order.data.status) ? (
            <a href={myOrder} className="flex h-12 items-center justify-center rounded-2xl bg-navy-900 font-bold text-white">
              {order.data.fulfilment === "meet_up" && order.data.status === "paid" ? "See my release code" : "Open the order in My Shop"}
            </a>
          ) : null}
        </section>
      ) : quote?.ok ? (
        <>
          <section aria-labelledby="how" className="grid gap-3">
            <h2 id="how" className="text-base font-bold">
              How Safe pay protects you
            </h2>
            <ol className="grid gap-2">
              {steps.map((text, index) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mint-50 text-xs font-bold text-mint-700">{index + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
          </section>
          <Money price={quote.data.price} fee={quote.data.buyer_fee} total={quote.data.total} currency={currency} note="The fee comes back to you if the item does not change hands." />
          <WalletLine balance={balance} total={quote.data.total} currency={currency} addFunds={addFunds} />
          {quote.data.reserved ? <p className="rounded-2xl bg-navy-50 p-3.5 text-sm">{unavailable.listing_reserved}</p> : <SafePayRequest quote={quote.data} sellerName={listing.seller.name} acceptHours={quote.data.accept_hours} />}
          <details className="text-sm text-navy-700">
            <summary className="cursor-pointer font-semibold">What Safe pay covers</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {quote.data.covers.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <section className="grid gap-3 rounded-2xl bg-navy-50 p-4 text-sm">
          <p>{(quote && !quote.ok && quote.code && unavailable[quote.code]) || quote?.message || "Safe pay could not be opened just now. Try again shortly."}</p>
          <Link href={back} className="font-semibold text-brand-700 hover:underline">
            Back to the listing
          </Link>
        </section>
      )}
      <p className="flex items-center gap-2 text-xs text-navy-600">
        <ShieldCheck className="size-4 text-mint-700" aria-hidden="true" /> BitoCard holds the money and pays the seller only once you have the item. BitoCard is not the seller.
      </p>
    </div>
  );
}

function Money({ price, fee, total, currency, note }: { price: number; fee: number; total: number; currency: string; note?: string }) {
  return (
    <section aria-label="What you pay" className="grid gap-2 rounded-2xl border border-navy-200 bg-white p-4 text-sm">
      <div className="flex justify-between">
        <span>Item price</span>
        <span className="font-semibold">{shopMoney(price, currency)}</span>
      </div>
      <div className="flex justify-between">
        <span>Safe pay fee</span>
        <span className="font-semibold">{shopMoney(fee, currency)}</span>
      </div>
      <div className="my-1 h-px bg-navy-100" />
      <div className="flex justify-between text-base">
        <strong>Total</strong>
        <strong>{shopMoney(total, currency)}</strong>
      </div>
      {note ? <p className="text-xs text-navy-600">{note}</p> : null}
    </section>
  );
}

function WalletLine({ balance, total, currency, addFunds }: { balance: number | null; total: number; currency: string; addFunds: string | null }) {
  const short = balance !== null && balance < total ? total - balance : 0;
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-navy-200 bg-white p-3.5">
      <Wallet className="size-6 shrink-0 text-navy-700" aria-hidden="true" />
      <span className="grid flex-1 gap-0.5 text-sm">
        <strong>Paid from your BitoCard wallet</strong>
        <span className="text-navy-600">{balance === null ? "Your balance could not be read just now." : `Balance ${shopMoney(balance, currency)}${short ? ` · add ${shopMoney(short, currency)} before paying` : ""}`}</span>
      </span>
      {addFunds ? (
        <a href={addFunds} className="text-sm font-bold text-brand-700 hover:underline">
          Add funds
        </a>
      ) : null}
    </section>
  );
}
