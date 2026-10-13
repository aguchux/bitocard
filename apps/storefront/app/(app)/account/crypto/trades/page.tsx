import type { Metadata } from "next";
import Link from "next/link";
import type { StoreList, StoreP2pTrade } from "@bitocard/api-client/storefront";
import { card, CryptoNav, TradeRow } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Trades" };

/** Every P2P trade the customer made, newest first, in pages. */
export default async function TradesPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const params = await searchParams;
  const after = /^[0-9a-f-]{36}$/.test(params.after ?? "") ? params.after! : null;
  const result = await customerApi<StoreList<StoreP2pTrade>>("GET", `/v1/store/p2p/trades?limit=25${after ? `&starting_after=${after}` : ""}`);
  const trades = result.ok ? result.data.data : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Trades</h1>
      <CryptoNav current="/account/crypto/trades" />
      <section className={card} aria-label="Your trades">
        {trades.length ? (
          <div className="divide-y divide-slate-100">
            {trades.map(trade => (
              <TradeRow key={trade.id} trade={trade} />
            ))}
          </div>
        ) : (
          <p className="text-slate-600">{result.ok ? "No trades yet. Buy or sell on the market and they show here." : "Your trades cannot be shown right now. Try again shortly."}</p>
        )}
        {result.ok && result.data.has_more ? (
          <Link href={`/account/crypto/trades?after=${trades[trades.length - 1].id}`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-[#ff2382] hover:underline">
            Older trades
          </Link>
        ) : null}
      </section>
    </div>
  );
}
