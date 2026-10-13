import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pQuote } from "@bitocard/api-client/storefront";
import { card, CoinBadge } from "@/components/app/crypto";
import { ConfirmTradeForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm trade" };

type Search = { ad?: string; price?: string; fiat?: string };

/**
 * The trade the customer is about to make, exactly: price, what they pay or receive, BitoCard's fee and the coins
 * that arrive. Nothing moves until they confirm; a changed price is refused, never charged.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const price = Number(params.price);
  const fiat = Number(params.fiat);
  const valid = /^[0-9a-f-]{36}$/.test(params.ad ?? "") && Number.isInteger(price) && price > 0 && Number.isInteger(fiat) && fiat > 0;
  const preview = valid ? await customerApi<StoreP2pQuote>("POST", "/v1/store/p2p/trades", { ad_id: params.ad, price, fiat, preview: true }) : null;
  const quote = preview?.ok ? preview.data : null;
  const buying = quote?.side !== "sell";

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/market" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back to the market
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Confirm your trade</h1>
      {quote ? (
        <section className={card} aria-label="Trade details">
          <div className="flex items-center gap-3">
            <CoinBadge asset={quote.asset} size="size-12" />
            <div>
              <p className="text-sm text-slate-500">{buying ? "You buy" : "You sell"}</p>
              <p className="font-display text-2xl font-extrabold">{formatCrypto(quote.amount, quote.asset)}</p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">Price</dt>
              <dd className="font-semibold">
                {formatFace(quote.price, quote.currency)} / {quote.asset}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{buying ? "You pay" : "You receive"}</dt>
              <dd className="font-semibold">{formatFace(quote.fiat, quote.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">BitoCard fee</dt>
              <dd className="font-semibold">{formatCrypto(quote.fee, quote.asset)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{buying ? "Coins you receive" : "The buyer receives"}</dt>
              <dd className="font-bold text-emerald-700">{formatCrypto(quote.received, quote.asset)}</dd>
            </div>
          </dl>
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            {buying ? "Paid from your P2P money first, then your wallet. " : "The money goes to your P2P balance at once. "}
            Settled instantly by BitoCard: the coins and the money move together in one step, or not at all.
          </p>
          <div className="mt-4">
            <ConfirmTradeForm adId={params.ad!} price={price} feeBps={quote.fee_bps} fiat={fiat} label={buying ? `Buy ${quote.asset} now` : `Sell ${quote.asset} now`} nonce={randomUUID()} />
          </div>
        </section>
      ) : (
        <div className={card} role="alert">
          <p className="font-semibold">This trade is not available</p>
          <p className="mt-1 text-sm text-slate-600">{preview && !preview.ok ? preview.message : "The ad changed or the amount is outside its limits."}</p>
          <Link href="/account/crypto/market" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
            Choose another ad
          </Link>
        </div>
      )}
    </div>
  );
}
