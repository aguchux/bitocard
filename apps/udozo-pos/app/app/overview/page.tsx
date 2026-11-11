import type { Metadata } from "next";
import Link from "next/link";
import { SalesChart } from "@/components/sales-chart";
import { needs } from "@/lib/gates";
import { changeText, comparedWith, methodLabel, money, type ReportPeriod, reportPeriods, saleTime } from "@/lib/pos";
import { posOverview } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Overview", robots: { index: false, follow: false } };

const day = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The overview (S2): the shop's takings beside the owner's udozo.com sales, against the period before; by the hour or
 * day; the channels and payment methods; top sellers; the latest sales; and what needs restocking.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; shop?: string }> }) {
  await needs("all_sales");
  const asked = await searchParams;
  const period: ReportPeriod = reportPeriods.some(item => item.value === asked.period) ? (asked.period as ReportPeriod) : "today";
  const custom = period === "custom" && asked.from && asked.to && day.test(asked.from) && day.test(asked.to);
  const shop = asked.shop && /^[0-9a-f-]{36}$/i.test(asked.shop) ? asked.shop : undefined;
  const result = await posOverview({ ...(custom ? { period, from: asked.from, to: asked.to } : { period: period === "custom" ? "today" : period }), shop });
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {result.message}
      </p>
    );
  }
  const view = result.data;
  const at = (amount: number) => money(amount, view.currency);
  const weekday = new Date(`${view.to}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const against = comparedWith(view.period, weekday);
  const when = view.from === view.to ? new Date(`${view.to}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : `${view.from} to ${view.to}`;
  const cards = [
    { label: view.period === "today" ? "Sales today" : "Sales", value: at(view.totals.sales.value), note: changeText(view.totals.sales.change_pct, against) },
    { label: "Transactions", value: String(view.totals.transactions.value), note: `${view.totals.transactions.pos} in the shop · ${view.totals.transactions.online} on Udozo online` },
    { label: "Average basket", value: at(view.totals.average_basket.value), note: changeText(view.totals.average_basket.change_pct, against) },
    { label: "Items sold", value: String(view.totals.items.value), note: view.totals.low_stock ? `${view.totals.low_stock} ${view.totals.low_stock === 1 ? "product needs" : "products need"} restocking` : "Nothing needs restocking" },
  ];
  const pill = (current: boolean) => `flex h-10 items-center rounded-full px-4 text-sm font-semibold no-underline ${current ? "bg-pos-600 text-white" : "bg-white text-pos-ink-2 hover:bg-pos-50"}`;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-pos-ink">Sales overview</h1>
          <p className="mt-1 text-pos-ink-2">
            {when} · {view.shop ? `${view.shop.name} and udozo.com` : (view.by_shop?.length ?? 0) > 1 ? "all your shops and udozo.com together" : "in the shop and on udozo.com together"}
          </p>
        </div>
        <Link href="/app/till" className="flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white no-underline hover:bg-pos-700">
          New sale
        </Link>
      </div>

      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        {reportPeriods
          .filter(item => item.value !== "custom")
          .map(item => (
            <Link key={item.value} href={`/app/overview?period=${item.value}${view.shop ? `&shop=${view.shop.id}` : ""}`} aria-current={view.period === item.value ? "page" : undefined} className={pill(view.period === item.value)}>
              {item.label}
            </Link>
          ))}
        <form action="/app/overview" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="period" value="custom" />
          {view.shop ? <input type="hidden" name="shop" value={view.shop.id} /> : null}
          <label className="sr-only" htmlFor="overview-from">
            From
          </label>
          <input id="overview-from" type="date" name="from" defaultValue={view.period === "custom" ? view.from : undefined} required className="h-10 rounded-full border border-pos-line bg-white px-3 text-sm" />
          <label className="sr-only" htmlFor="overview-to">
            To
          </label>
          <input id="overview-to" type="date" name="to" defaultValue={view.period === "custom" ? view.to : undefined} required className="h-10 rounded-full border border-pos-line bg-white px-3 text-sm" />
          <button type="submit" className={pill(view.period === "custom")}>
            Custom
          </button>
        </form>
      </nav>

      {(view.by_shop?.length ?? 0) > 1 ? (
        <nav aria-label="Shop" className="flex flex-wrap gap-2">
          {[{ shop_id: "", name: "All shops" }, ...view.by_shop!].map(item => {
            const current = (view.shop?.id ?? "") === item.shop_id;
            const query = new URLSearchParams({ period: view.period, ...(view.period === "custom" ? { from: view.from, to: view.to } : {}), ...(item.shop_id ? { shop: item.shop_id } : {}) });
            return (
              <Link key={item.shop_id || "all"} href={`/app/overview?${query}`} aria-current={current ? "page" : undefined} className={pill(current)}>
                {item.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(card => (
          <div key={card.label} className="min-w-0 rounded-[20px] bg-white p-4">
            <p className="text-sm font-semibold text-pos-ink-2">{card.label}</p>
            <p className="mt-1 font-display text-2xl font-bold break-words text-pos-ink">{card.value}</p>
            <p className="mt-1 text-xs text-pos-muted">{card.note}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="by-time" className="grid min-w-0 gap-3 rounded-[20px] bg-white p-5">
          <h2 id="by-time" className="font-display text-xl font-bold text-pos-ink">
            Sales by {view.by === "hour" ? "hour" : "day"}
          </h2>
          <SalesChart overview={view} />
          <p className="text-sm text-pos-ink-2">{view.busiest ? `Busiest ${view.by === "hour" ? "hour" : "day"} so far: ${view.busiest.label} (${at(view.busiest.amount)}).` : "Nothing sold yet in this period."}</p>
        </section>
        <section aria-labelledby="channels" className="grid min-w-0 gap-3 rounded-[20px] bg-white p-5">
          <h2 id="channels" className="font-display text-xl font-bold text-pos-ink">
            Channel and payment
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>In the shop · {view.channels.pos.share_pct}%</dt>
            <dd className="text-right font-semibold">{at(view.channels.pos.amount)}</dd>
            <dt>Udozo online · {view.channels.online.share_pct}%</dt>
            <dd className="text-right font-semibold">{at(view.channels.online.amount)}</dd>
          </dl>
          <h3 className="font-semibold text-pos-ink">Payment methods in the shop</h3>
          {view.payment_methods.length ? (
            <ul className="grid gap-2">
              {view.payment_methods.map(row => (
                <li key={row.method} className="grid gap-1">
                  <span className="flex justify-between gap-2 text-sm">
                    <span>{methodLabel(row.method)}</span>
                    <span className="font-semibold">
                      {row.share_pct}% · {at(row.amount)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="h-2 rounded-full bg-pos-50">
                    <span className="block h-2 rounded-full bg-pos-600" style={{ width: `${row.share_pct}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pos-muted">No sales in the shop yet.</p>
          )}
          {(view.by_shop?.length ?? 0) > 1 ? (
            <>
              <h3 className="font-semibold text-pos-ink">By shop</h3>
              <ul className="grid gap-1 text-sm">
                {view.by_shop!.map(row => (
                  <li key={row.shop_id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {row.name} · {row.sales} {row.sales === 1 ? "sale" : "sales"}
                    </span>
                    <span className="shrink-0 font-semibold">{at(row.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {view.totals.refunds.count ? (
            <p className="text-sm text-pos-warn">
              {view.totals.refunds.count} {view.totals.refunds.count === 1 ? "refund" : "refunds"} · {at(view.totals.refunds.amount)}
            </p>
          ) : null}
        </section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <section aria-labelledby="top" className="min-w-0 rounded-[20px] bg-white p-5">
          <h2 id="top" className="font-display text-xl font-bold text-pos-ink">
            Top sellers
          </h2>
          {view.top_sellers.length ? (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-pos-muted">
                <tr>
                  <th scope="col" className="py-1 font-semibold">
                    Product
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Sold
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.top_sellers.slice(0, 6).map(row => (
                  <tr key={row.listing_id} className="border-t border-pos-line">
                    <td className="py-1.5 pr-2 break-words">{row.title}</td>
                    <td className="py-1.5 text-right">{row.quantity}</td>
                    <td className="py-1.5 text-right font-semibold whitespace-nowrap">{at(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-pos-muted">Nothing sold yet.</p>
          )}
        </section>
        <section aria-labelledby="recent" className="min-w-0 rounded-[20px] bg-white p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="recent" className="font-display text-xl font-bold text-pos-ink">
              Recent sales
            </h2>
            <Link href="/app/sales" className="text-sm font-semibold">
              Sales history
            </Link>
          </div>
          {view.recent.length ? (
            <ul className="mt-2 grid gap-2">
              {view.recent.map(row => (
                <li key={`${row.channel}-${row.id}`} className="flex justify-between gap-3 border-t border-pos-line pt-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-pos-muted">{row.channel === "pos" ? "In the shop" : "Udozo online"}</span>
                    {row.channel === "pos" ? (
                      <Link href={`/app/sales/${row.id}`} className="block truncate font-semibold">
                        {row.number} · {row.title}
                      </Link>
                    ) : (
                      <span className="block truncate font-semibold">{row.title}</span>
                    )}
                    <span className="block truncate text-pos-muted">
                      {row.meta} · {saleTime(row.at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-semibold">
                    {at(row.amount)}
                    {row.status === "refunded" ? <span className="block text-xs text-pos-warn">Refunded</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-pos-muted">No sales yet.</p>
          )}
        </section>
        <section aria-labelledby="restock" className="min-w-0 rounded-[20px] bg-white p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="restock" className="font-display text-xl font-bold text-pos-ink">
              Needs restocking
            </h2>
            <Link href="/app/products" className="text-sm font-semibold">
              Products
            </Link>
          </div>
          {view.restock.length ? (
            <ul className="mt-2 grid gap-2">
              {view.restock.map(row => (
                <li key={row.listing_id} className="border-t border-pos-line pt-2 text-sm">
                  <span className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{row.title}</span>
                    <span className={`shrink-0 font-semibold ${row.stock === 0 ? "text-pos-error" : "text-pos-warn"}`}>{row.stock === 0 ? "Out of stock" : `${row.stock} left`}</span>
                  </span>
                  <span className="block text-pos-muted">
                    {row.reorder_level !== null ? `Reorder level ${row.reorder_level}` : "No reorder level"}
                    {row.per_day ? ` · selling ${row.per_day} a day` : ""}
                    {row.days_left !== null && row.stock > 0 ? ` · about ${row.days_left} ${row.days_left === 1 ? "day" : "days"} left` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-pos-muted">Everything is above its reorder level.</p>
          )}
        </section>
      </div>
    </div>
  );
}
