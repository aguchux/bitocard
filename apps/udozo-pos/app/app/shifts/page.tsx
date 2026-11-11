import type { Metadata } from "next";
import Link from "next/link";
import { ShiftPanel } from "@/components/shift-panel";
import { needs } from "@/lib/gates";
import { allows, differenceText, money, saleTime } from "@/lib/pos";
import { currentShift, posShifts } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Shifts", robots: { index: false, follow: false } };

/**
 * Shifts and cash-up (S8): each till's shift (open it with the cash in the drawer, record cash in and out, count and
 * close it), and the latest shifts with how each counted. On a linked till, only its own till.
 */
export default async function ShiftsPage() {
  const pos = await needs("till", "cash_up");
  if (!pos.ok) return null;
  const view = pos.data;
  const tills = view.shops.flatMap(shop => shop.tills.map(till => ({ ...till, shop }))).filter(till => !view.tillId || till.id === view.tillId);
  const [currents, recent] = await Promise.all([Promise.all(tills.map(till => currentShift(till.id))), posShifts({ status: "closed", limit: "20" })]);
  const canOpen = allows(view.permissions, "till");
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Shifts</h1>
        <p className="mt-1 text-pos-ink-2">Open a shift with the cash in the drawer, and count it when you close. Sales and refunds rung up meanwhile count towards it.</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {tills.map((till, index) => {
          const current = currents[index]!;
          return (
            <section key={till.id} aria-labelledby={`till-${till.id}`} className="min-w-0 rounded-[20px] bg-white p-5">
              <h2 id={`till-${till.id}`} className="mb-3 font-display text-xl font-bold text-pos-ink">
                {view.shops.length > 1 ? `${till.shop.name}: ${till.name}` : till.name}
              </h2>
              {current.ok ? (
                <ShiftPanel key={current.data.shift?.id ?? "none"} tillId={till.id} tillName={till.name} currency={view.currency} shift={current.data.shift} canOpen={canOpen} />
              ) : (
                <p role="alert" className="text-pos-error">
                  {current.message}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <section aria-labelledby="closed" className="rounded-[20px] bg-white p-5">
        <h2 id="closed" className="font-display text-xl font-bold text-pos-ink">
          Closed shifts
        </h2>
        {recent.ok && recent.data.data.length ? (
          <ul className="mt-2 grid gap-2">
            {recent.data.data.map(shift => (
              <li key={shift.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-pos-line pt-2 text-sm">
                <Link href={`/app/shifts/${shift.id}`} className="min-w-0 font-semibold">
                  {shift.till.name} · {saleTime(shift.opened_at)}
                </Link>
                <span className="text-pos-ink-2">
                  {shift.closed_by ? `Closed by ${shift.closed_by}` : ""} · counted {money(shift.counted_cash ?? 0, shift.currency)}
                  {shift.difference !== null ? ` · ${differenceText(shift.difference, shift.currency)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-pos-muted">{recent.ok ? "No shift closed yet." : recent.message}</p>
        )}
      </section>
    </div>
  );
}
