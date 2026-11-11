import type { Metadata } from "next";
import Link from "next/link";
import { methodLabel, money, salesPage, salesQuery, saleTime, shopToday } from "@/lib/pos";
import { ownerSales } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Sales", robots: { index: false, follow: false } };

type Params = { q?: string; status?: string; day?: string; page?: string };

function hrefWith(current: ReturnType<typeof salesQuery>, change: Partial<{ q: string; status: string; day: string; page: number }>) {
  const next = { q: current.q, status: current.status, day: current.day, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.status) search.set("status", next.status);
  if (next.day) search.set("day", next.day);
  if (next.page > 1) search.set("page", String(next.page));
  const text = search.toString();
  return `/app/sales${text ? `?${text}` : ""}`;
}

const chip = (on: boolean) => `flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap no-underline ${on ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`;

/** Every sale rung up at the shop's tills, newest first, with what was taken and refunded for the filter shown. */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = salesQuery(await searchParams);
  const result = await ownerSales(query.api);
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const sales = result.data;
  const pages = Math.max(1, Math.ceil(sales.total / salesPage));
  const today = shopToday();
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-pos-ink">Sales</h1>
          <p className="mt-1 text-pos-ink-2">Every sale rung up at your tills. Open one to see it, or to refund it.</p>
        </div>
        <Link href="/app/till" className="inline-flex h-11 items-center rounded-xl bg-pos-600 px-5 font-bold text-white no-underline hover:bg-pos-700">
          Open the till
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Sales" value={`${sales.summary.sales}`} />
        <Figure label="Taken" value={money(sales.summary.takings, sales.currency)} />
        <Figure label="Refunds" value={`${sales.summary.refunds}`} />
        <Figure label="Refunded" value={money(sales.summary.refunded, sales.currency)} />
      </dl>

      <form role="search" action="/app/sales" className="flex flex-wrap gap-2">
        <label htmlFor="sale-search" className="sr-only">
          Find a sale by its number
        </label>
        <input id="sale-search" name="q" defaultValue={query.q} placeholder="Sale number, like POS-000123" className="h-12 min-w-0 flex-1 rounded-xl border border-pos-line bg-white px-4 text-base" />
        <label htmlFor="sale-day" className="sr-only">
          Day
        </label>
        <input id="sale-day" type="date" name="day" defaultValue={query.day} max={today} className="h-12 rounded-xl border border-pos-line bg-white px-3 text-base" />
        {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
        <button type="submit" className="h-12 rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700">
          Find
        </button>
      </form>

      <nav aria-label="Show" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {[
            { value: "", label: "All" },
            { value: "completed", label: "Completed" },
            { value: "refunded", label: "Refunded" },
          ].map(view => (
            <li key={view.value || "all"}>
              <Link href={hrefWith(query, { status: view.value })} aria-current={query.status === view.value ? "page" : undefined} className={chip(query.status === view.value)}>
                {view.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href={hrefWith(query, { day: query.day === today ? "" : today })} aria-current={query.day === today ? "page" : undefined} className={chip(query.day === today)}>
              Today
            </Link>
          </li>
        </ul>
      </nav>

      {sales.data.length ? (
        <ul className="grid gap-2">
          {sales.data.map(sale => (
            <li key={sale.id}>
              <Link href={`/app/sales/${sale.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] bg-white p-4 no-underline hover:ring-2 hover:ring-pos-600">
                <span className="min-w-0">
                  <span className="block font-semibold text-pos-ink">
                    {sale.number}
                    {sale.status === "refunded" ? <span className="ml-2 rounded-full bg-pos-warn-bg px-2 py-0.5 text-xs text-pos-warn">Refunded</span> : null}
                  </span>
                  <span className="block truncate text-sm text-pos-muted">
                    {saleTime(sale.created_at)} · {sale.till.name} · {sale.items} {sale.items === 1 ? "item" : "items"} · {sale.payments.map(payment => methodLabel(payment.method)).join(" and ")}
                  </span>
                </span>
                <span className={`font-display text-lg font-bold ${sale.status === "refunded" ? "text-pos-muted line-through" : "text-pos-ink"}`}>{money(sale.total, sale.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">{query.q || query.day || query.status ? "No sales match." : "No sales yet. Ring one up at the till."}</p>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {query.page > 1 ? (
            <Link href={hrefWith(query, { page: query.page - 1 })} className="font-semibold">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-pos-muted">
            Page {query.page} of {pages}
          </span>
          {sales.has_more ? (
            <Link href={hrefWith(query, { page: query.page + 1 })} className="font-semibold">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] bg-white p-4">
      <dt className="text-sm text-pos-muted">{label}</dt>
      <dd className="mt-1 truncate font-display text-2xl font-bold text-pos-ink">{value}</dd>
    </div>
  );
}
