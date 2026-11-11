import type { Metadata } from "next";
import { needs } from "@/lib/gates";
import { allows, differenceText, methodLabel, money, shopToday } from "@/lib/pos";
import { posDay } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink";
const label = "block text-sm font-semibold text-pos-ink-2";
const quiet = "flex h-12 items-center justify-center rounded-xl border border-pos-line bg-white px-5 font-semibold text-pos-ink no-underline hover:bg-pos-50";

/**
 * Reports: end of day (the Z report: takings by method and member of staff, refunds, the shifts' cash) with its PDF,
 * and the accountant's exports (a period's sales or lines as CSV, its summary as a PDF). Each as the role allows.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const pos = await needs("cash_up", "export");
  if (!pos.ok) return null;
  const view = pos.data;
  const asked = await searchParams;
  const date = asked.date && dayPattern.test(asked.date) ? asked.date : shopToday();
  const canDay = allows(view.permissions, "cash_up");
  const canExport = allows(view.permissions, "export");
  const day = canDay ? await posDay({ date }) : null;
  const monthStart = `${shopToday().slice(0, 8)}01`;
  return (
    <div className="grid gap-6">
      <h1 className="font-display text-3xl font-bold text-pos-ink">Reports</h1>
      {canDay ? (
        <section aria-labelledby="day-title" className="grid gap-4 rounded-[20px] bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="day-title" className="font-display text-xl font-bold text-pos-ink">
              End of day · {date}
            </h2>
            <form action="/app/reports" className="no-print flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="day-date" className={label}>
                  Day
                </label>
                <input id="day-date" type="date" name="date" defaultValue={date} className={field} />
              </div>
              <button type="submit" className={quiet}>
                Show
              </button>
              <a href={`/app/reports/file?kind=day_pdf&date=${date}`} target="_blank" rel="noopener" className={quiet}>
                PDF
              </a>
            </form>
          </div>
          {day && day.ok ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt>Sales</dt>
                <dd className="text-right">{day.data.sales.count}</dd>
                <dt>Items sold</dt>
                <dd className="text-right">{day.data.sales.items}</dd>
                <dt>Gross (before discounts)</dt>
                <dd className="text-right">{money(day.data.sales.gross, day.data.currency)}</dd>
                <dt>Discounts</dt>
                <dd className="text-right">{money(day.data.sales.discounts, day.data.currency)}</dd>
                <dt>VAT</dt>
                <dd className="text-right">{money(day.data.sales.vat, day.data.currency)}</dd>
                <dt className="font-semibold">Takings</dt>
                <dd className="text-right font-semibold">{money(day.data.sales.total, day.data.currency)}</dd>
                <dt>Refunds ({day.data.refunds.count})</dt>
                <dd className="text-right">{money(day.data.refunds.total, day.data.currency)}</dd>
                <dt className="font-display text-lg font-bold text-pos-ink">Net</dt>
                <dd className="text-right font-display text-lg font-bold text-pos-ink">{money(day.data.net, day.data.currency)}</dd>
                <dt className="text-pos-muted">On udozo.com the same day</dt>
                <dd className="text-right text-pos-muted">
                  {day.data.online.count} · {money(day.data.online.total, day.data.currency)}
                </dd>
              </dl>
              <div className="grid content-start gap-4">
                <div>
                  <h3 className="font-semibold text-pos-ink">By payment method</h3>
                  {day.data.by_method.length ? (
                    <ul className="mt-1 grid gap-1 text-sm">
                      {day.data.by_method.map(row => (
                        <li key={row.method} className="flex justify-between gap-2">
                          <span>{methodLabel(row.method)}</span>
                          <span className="font-semibold">{money(row.amount, day.data.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-pos-muted">No sales that day.</p>
                  )}
                </div>
                {day.data.by_staff.length ? (
                  <div>
                    <h3 className="font-semibold text-pos-ink">By member of staff</h3>
                    <ul className="mt-1 grid gap-1 text-sm">
                      {day.data.by_staff.map(row => (
                        <li key={row.name} className="flex justify-between gap-2">
                          <span>
                            {row.name} · {row.sales} {row.sales === 1 ? "sale" : "sales"}
                          </span>
                          <span className="font-semibold">{money(row.total, day.data.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <h3 className="font-semibold text-pos-ink">Shifts and cash-up</h3>
                  {day.data.shifts.length ? (
                    <ul className="mt-1 grid gap-1 text-sm">
                      {day.data.shifts.map(shift => (
                        <li key={shift.id}>
                          <a href={`/app/shifts/${shift.id}`} className="font-semibold">
                            {shift.till.name}
                          </a>{" "}
                          · {shift.status === "open" ? "still open" : `counted ${money(shift.counted_cash ?? 0, shift.currency)}${shift.difference !== null ? `, ${differenceText(shift.difference, shift.currency)}` : ""}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-pos-muted">No shift was opened that day.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p role="alert" className="text-pos-error">
              {day && !day.ok ? day.message : null}
            </p>
          )}
        </section>
      ) : null}
      {canExport ? (
        <section aria-labelledby="export-title" className="no-print grid gap-4 rounded-[20px] bg-white p-5">
          <h2 id="export-title" className="font-display text-xl font-bold text-pos-ink">
            Export for your accountant
          </h2>
          <form action="/app/reports/file" className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="export-from" className={label}>
                  From
                </label>
                <input id="export-from" type="date" name="from" defaultValue={monthStart} required className={field} />
              </div>
              <div>
                <label htmlFor="export-to" className={label}>
                  To
                </label>
                <input id="export-to" type="date" name="to" defaultValue={shopToday()} required className={field} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="submit" name="kind" value="sales_csv" className={quiet}>
                Sales (CSV)
              </button>
              <button type="submit" name="kind" value="lines_csv" className={quiet}>
                Every item sold (CSV)
              </button>
              <button type="submit" name="kind" value="summary_pdf" formTarget="_blank" className={quiet}>
                Summary (PDF)
              </button>
            </div>
            <p className="text-sm text-pos-muted">Up to 366 days. The CSV files open in Excel, Google Sheets and accounting software, with amounts in your currency to two decimals.</p>
          </form>
        </section>
      ) : null}
    </div>
  );
}
