import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/auto-print";
import { ShiftFigures } from "@/components/shift-panel";
import { needs } from "@/lib/gates";
import { differenceText, money, saleTime } from "@/lib/pos";
import { posShift } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Shift", robots: { index: false, follow: false } };

/** A shift's report: who opened and closed it, what it took, cash in and out, and the count against what was expected. */
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  await needs("till", "cash_up");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await posShift(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const shift = result.data;
  const at = (amount: number) => money(amount, shift.currency);
  const balance = differenceText(shift.difference, shift.currency);
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/shifts" className="text-sm font-semibold no-print">
          ← Shifts
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
          {shift.till.name} shift {shift.status === "open" ? <span className="ml-2 rounded-full bg-pos-50 px-3 py-1 align-middle text-sm text-pos-700">Open</span> : null}
        </h1>
        <p className="mt-1 text-pos-ink-2">
          Opened {saleTime(shift.opened_at)} by {shift.opened_by}
          {shift.closed_at ? ` · closed ${saleTime(shift.closed_at)} by ${shift.closed_by}` : ""}
        </p>
      </div>
      <section className="grid gap-4 rounded-[20px] bg-white p-5 sm:max-w-xl">
        <ShiftFigures shift={shift} />
        {shift.status === "closed" ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-pos-line pt-3">
            <dt className="font-semibold">Cash counted</dt>
            <dd className="text-right font-semibold">{at(shift.counted_cash ?? 0)}</dd>
            {balance ? (
              <>
                <dt className="font-semibold">Over or short</dt>
                <dd className={`text-right font-semibold ${shift.difference === 0 ? "text-pos-700" : "text-pos-error"}`}>{balance}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {shift.cash.length ? (
          <div className="border-t border-pos-line pt-3">
            <h2 className="font-semibold text-pos-ink">Cash in and out</h2>
            <ul className="mt-1 grid gap-1 text-sm">
              {shift.cash.map(item => (
                <li key={item.id}>
                  {item.kind === "in" ? "Paid in" : "Paid out"} {at(item.amount)}: {item.reason} <span className="text-pos-muted">· {item.by}, {saleTime(item.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {shift.note ? <p className="text-sm text-pos-ink-2">Note: {shift.note}</p> : null}
        <div className="no-print">
          <AutoPrint auto={false} />
        </div>
      </section>
    </div>
  );
}
