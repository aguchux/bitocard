import type { Metadata } from "next";
import type { StoreList, StoreP2pTrade } from "@bitocard/api-client/storefront";
import { cardClass, TradeRow } from "@bitocard/crypto-ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Trades", robots: { index: false, follow: false } };

/** The customer's trades, in every market, newest first. */
export default async function TradesPage() {
  await requireCustomer("/trades");
  const result = await customerApi<StoreList<StoreP2pTrade>>("GET", "/v1/afrippa/p2p/trades?limit=50");
  const trades = result.ok ? result.data.data : [];
  return (
    <AccountShell title="Trades" current="/trades">
      {!result.ok ? (
        <p className={cardClass}>Your trades cannot be shown right now. Try again shortly.</p>
      ) : trades.length ? (
        <ul className={`${cardClass} divide-y divide-slate-100 py-1`}>
          {trades.map(trade => (
            <li key={trade.id}>
              <TradeRow trade={trade} href={`/trades/${trade.id}`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={cardClass}>No trades yet. Take an ad on a market, or post your own.</p>
      )}
    </AccountShell>
  );
}
