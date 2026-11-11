import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { collectionText, dayText, money, saleTime, settlementText } from "@/lib/pos";
import { ownerSettlement } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Settlement", robots: { index: false, follow: false } };

/** One day's settlement, the statement: every transfer in it, Udozo's fee on each, and what was paid to the bank. */
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await ownerSettlement(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const settlement = result.data;
  const at = (amount: number) => money(amount, settlement.currency);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/app/collections" className="text-sm font-semibold print:hidden">
            ← Payments
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
            Settlement {settlement.number}
            {settlement.mode === "test" ? <span className="ml-3 rounded-full bg-pos-warn-bg px-3 py-1 align-middle text-sm text-pos-warn">Sandbox</span> : null}
          </h1>
          <p className="mt-1 text-pos-ink-2">
            {dayText(settlement.day)} · {settlementText(settlement)}
          </p>
        </div>
        <PrintButton />
      </div>

      <section aria-labelledby="totals" className="rounded-[20px] bg-white p-5">
        <h2 id="totals" className="sr-only">
          Totals
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-pos-ink-2 sm:max-w-md">
          <dt>
            {settlement.collections} {settlement.collections === 1 ? "transfer" : "transfers"}
          </dt>
          <dd className="text-right">{at(settlement.gross)}</dd>
          <dt>Udozo&apos;s fee</dt>
          <dd className="text-right">−{at(settlement.fees)}</dd>
          <dt className="font-display text-xl font-bold text-pos-ink">Paid to you</dt>
          <dd className="text-right font-display text-xl font-bold text-pos-ink">{at(settlement.amount)}</dd>
        </dl>
      </section>

      <section aria-labelledby="items" className="rounded-[20px] bg-white p-5">
        <h2 id="items" className="font-display text-xl font-bold text-pos-ink">
          The transfers
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-pos-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Received</th>
                <th className="py-2 pr-3 font-semibold">From</th>
                <th className="py-2 pr-3 font-semibold">Till</th>
                <th className="py-2 pr-3 font-semibold">For</th>
                <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                <th className="py-2 pr-3 text-right font-semibold">Fee</th>
                <th className="py-2 text-right font-semibold">To you</th>
              </tr>
            </thead>
            <tbody>
              {(settlement.items ?? []).map((item) => (
                <tr key={item.id} className="border-t border-pos-line">
                  <td className="py-2 pr-3">{saleTime(item.received_at)}</td>
                  <td className="py-2 pr-3">{item.payer_name ?? "Not named"}</td>
                  <td className="py-2 pr-3">{item.till?.name ?? ""}</td>
                  <td className="py-2 pr-3">{collectionText(item)}</td>
                  <td className="py-2 pr-3 text-right">{at(item.amount)}</td>
                  <td className="py-2 pr-3 text-right">{at(item.fee)}</td>
                  <td className="py-2 text-right font-semibold">{at(item.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
