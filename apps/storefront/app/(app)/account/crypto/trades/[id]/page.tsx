import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { TradeReceipt } from "@bitocard/crypto-ui/trade-views";
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

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/trades" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> All trades
      </Link>
      {done ? (
        <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800" role="status">
          <CheckCircle2 className="size-5" aria-hidden="true" /> Done. {bought ? `${formatCrypto(trade.received, trade.asset)} is in your crypto wallet.` : `${formatFace(trade.fiat, trade.currency)} is in your fiat balance.`}
        </p>
      ) : null}
      <TradeReceipt trade={trade} />
      <Link href="/account/crypto" className="inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 font-semibold text-white">
        Back to crypto
      </Link>
    </div>
  );
}
