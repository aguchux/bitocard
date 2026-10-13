import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { card, CoinBadge, date } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Trade" };

/** One trade's receipt: what moved, at what price, the fee, with whom (by nickname) and when. */
export default async function TradePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const result = await customerApi<StoreP2pTrade>("GET", `/v1/store/p2p/trades/${id}`);
  if (!result.ok) notFound();
  const trade = result.data;
  const bought = trade.side === "buy";
  const rows: Array<[string, string]> = [
    ["Trade", trade.number],
    ["Price", `${formatFace(trade.price, trade.currency)} / ${trade.asset}`],
    [bought ? "You paid" : "You received", formatFace(trade.fiat, trade.currency)],
    [bought ? "Coins bought" : "Coins sold", formatCrypto(trade.amount, trade.asset)],
    ["BitoCard fee", formatCrypto(trade.fee, trade.asset)],
    [bought ? "Coins you received" : "The buyer received", formatCrypto(trade.received, trade.asset)],
    [bought ? "Seller" : "Buyer", trade.counterparty.nickname],
    ["When", date(trade.completed_at ?? trade.created_at)],
  ];

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/trades" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> All trades
      </Link>
      {done ? (
        <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800" role="status">
          <CheckCircle2 className="size-5" aria-hidden="true" /> Done. {bought ? `${formatCrypto(trade.received, trade.asset)} is in your crypto wallet.` : `${formatFace(trade.fiat, trade.currency)} is in your P2P money.`}
        </p>
      ) : null}
      <section className={card} aria-label="Trade receipt">
        <div className="flex items-center gap-3">
          <CoinBadge asset={trade.asset} size="size-12" />
          <div>
            <h1 className="font-display text-xl font-extrabold text-[#070f4c]">
              {bought ? "Bought" : "Sold"} {formatCrypto(bought ? trade.received : trade.amount, trade.asset)}
            </h1>
            <p className="text-sm text-slate-500">{trade.status === "completed" ? "Completed instantly" : trade.status}</p>
          </div>
        </div>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-right font-semibold break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Link href="/account/crypto" className="inline-flex min-h-11 items-center rounded-xl bg-[#070f4c] px-4 font-semibold text-white">
        Back to crypto
      </Link>
    </div>
  );
}
