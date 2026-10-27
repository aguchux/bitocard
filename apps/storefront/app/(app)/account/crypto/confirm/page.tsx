import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { StoreP2pQuote } from "@bitocard/api-client/storefront";
import { QuoteDetails } from "@bitocard/crypto-ui/trade-views";
import { card } from "@/components/app/crypto";
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
      <Link href="/account/crypto" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back to the market
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Confirm your trade</h1>
      {quote ? (
        <QuoteDetails quote={quote}>
          <ConfirmTradeForm adId={params.ad!} price={price} feeBps={quote.fee_bps} fiat={fiat} label={buying ? `Buy ${quote.asset} now` : `Sell ${quote.asset} now`} nonce={randomUUID()} />
        </QuoteDetails>
      ) : (
        <div className={card} role="alert">
          <p className="font-semibold">This trade is not available</p>
          <p className="mt-1 text-sm text-slate-600">{preview && !preview.ok ? preview.message : "The ad changed or the amount is outside its limits."}</p>
          <Link href="/account/crypto" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
            Choose another ad
          </Link>
        </div>
      )}
    </div>
  );
}
