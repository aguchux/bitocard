import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import type { StoreP2pQuote } from "@bitocard/api-client/storefront";
import { ConfirmTradeForm } from "@bitocard/crypto-ui/forms";
import { cardClass, QuoteDetails } from "@bitocard/crypto-ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm trade", robots: { index: false, follow: false } };

type Search = { ad?: string; price?: string; fiat?: string };

/** The trade about to be made, exactly (the shared quote details); nothing moves until the customer confirms. */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await requireCustomer(`/confirm?${new URLSearchParams(params as Record<string, string>)}`);
  const price = Number(params.price);
  const fiat = Number(params.fiat);
  const valid = /^[0-9a-f-]{36}$/.test(params.ad ?? "") && Number.isInteger(price) && price > 0 && Number.isInteger(fiat) && fiat > 0;
  const preview = valid ? await customerApi<StoreP2pQuote>("POST", "/v1/afrippa/p2p/trades", { ad_id: params.ad, price, fiat, preview: true }) : null;
  const quote = preview?.ok ? preview.data : null;
  const buying = quote?.side !== "sell";
  return (
    <AccountShell title="Confirm your trade" current="/trades">
      {quote ? (
        <QuoteDetails quote={quote}>
          <ConfirmTradeForm adId={params.ad!} price={price} feeBps={quote.fee_bps} fiat={fiat} label={buying ? `Buy ${quote.asset} now` : `Sell ${quote.asset} now`} nonce={randomUUID()} />
        </QuoteDetails>
      ) : (
        <div className={cardClass} role="alert">
          <p className="font-semibold">This trade is not available</p>
          <p className="mt-1 text-sm text-slate-600">{preview && !preview.ok ? preview.message : "The ad changed or the amount is outside its limits."}</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
            Choose another ad
          </Link>
        </div>
      )}
    </AccountShell>
  );
}
