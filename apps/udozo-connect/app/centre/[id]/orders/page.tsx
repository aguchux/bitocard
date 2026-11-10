import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { FindOrder } from "@/components/counter-order";
import { counterStatus, type CounterView, counterViews } from "@/lib/centres";
import { readCentre, readOrders } from "@/lib/centre-data";
import { when } from "@/lib/connect";

export const metadata: Metadata = { title: "Items" };

const views = new Set<string>(counterViews.map(item => item.view));

/** The centre's items: on their way, at the centre (to shelve, ready to collect) and done; or find one by its label. */
export default async function OrdersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const asked = (await searchParams).view;
  const view: CounterView = asked && views.has(asked) ? (asked as CounterView) : "expected";
  const [centre, orders] = await Promise.all([readCentre(id), readOrders(id, view)]);
  if (!centre.ok) return null;
  const country = centre.data.country;
  return (
    <div className="grid gap-5">
      <FindOrder centre={id} />
      <nav aria-label="Items" className="flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none]">
        {counterViews.map(item => (
          <a
            key={item.view}
            href={`/centre/${id}/orders?view=${item.view}`}
            aria-current={item.view === view ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold ${item.view === view ? "border-brand-500 text-navy-900" : "border-transparent text-slate-600 hover:text-navy-900"}`}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {!orders.ok ? (
        <Problem message={orders.message} />
      ) : orders.data.data.length ? (
        <ul className="grid gap-3">
          {orders.data.data.map(order => (
            <li key={order.id}>
              <a href={`/centre/${id}/orders/${order.id}`} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm hover:border-navy-200">
                {order.listing.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the listing's own photo
                  <img src={order.listing.cover_url} alt="" width={64} height={64} className="size-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <span className="size-16 shrink-0 rounded-xl bg-slate-100" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-navy-900">{order.listing.title}</strong>
                  <span className="block text-sm font-semibold text-slate-700">
                    {order.number}
                    {order.shelf ? ` · ${order.shelf.code}` : ""}
                  </span>
                  <span className="block text-sm text-slate-600">{counterStatus(order)}</span>
                  <span className="block text-xs text-slate-500">
                    {view === "expected" ? `From ${order.seller.name}${order.sent_at ? `, sent ${when(order.sent_at, country)}` : ""}` : `For ${order.buyer.name}${order.collect_by ? `, free to collect until ${when(order.collect_by, country)}` : ""}`}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-slate-100 bg-white p-4 text-slate-600">{view === "expected" ? "Nothing is on its way to your centre." : view === "at_centre" ? "Nothing is at your centre." : "Nothing collected yet."}</p>
      )}
    </div>
  );
}
