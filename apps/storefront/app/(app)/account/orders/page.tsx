import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatPrice, type StoreCheckout, type StoreList } from "@bitocard/api-client/storefront";
import { StatusPill } from "@/components/store/order-status";
import { query } from "@/lib/api";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Orders" };

/** The groups are the API's (`?show=`), so every page of a filter is full and "Older orders" pages within it. */
const filters = {
  all: { label: "All" },
  progress: { label: "On the way" },
  delivered: { label: "Delivered" },
  refunded: { label: "Refunded" },
} as const;
type Filter = keyof typeof filters;

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** The customer's orders, newest first, 50 a page, filtered by where they are. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string; after?: string }> }) {
  const { show, after } = await searchParams;
  const filter: Filter = show && show in filters ? (show as Filter) : "all";
  const group = filter === "all" ? undefined : filter;
  const result = await customerApi<StoreList<StoreCheckout>>("GET", `/v1/store/checkouts${query({ limit: 50, starting_after: after, show: group })}`);
  const orders = result.ok ? result.data.data : [];
  const last = orders.at(-1);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-extrabold tracking-tight">Orders</h1>
      <nav aria-label="Show" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {(Object.keys(filters) as Filter[]).map(key => (
          <Link
            key={key}
            href={`/account/orders${key === "all" ? "" : `?show=${key}`}`}
            aria-current={filter === key ? "true" : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${filter === key ? "bg-[#070f4c] text-white" : "bg-white text-[#070f4c] ring-1 ring-slate-200 hover:ring-slate-300"}`}
          >
            {filters[key].label}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <p className="rounded-3xl bg-red-50 p-5 text-red-800">{result.message}</p>
      ) : orders.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-slate-600 ring-1 ring-slate-200/70">
          {filter === "all" ? "No orders yet." : "No orders here."}{" "}
          <Link href="/account/catalog" className="font-semibold text-[#2477ff] hover:underline">
            Browse the catalog
          </Link>
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {orders.map(order => (
            <li key={order.id}>
              <Link href={`/account/orders/${order.id}`} className="flex items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/70 transition hover:shadow-md">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">
                    {order.quantity > 1 ? `${order.quantity} × ` : ""}
                    {order.product.name}
                  </span>
                  <span className="block text-sm text-slate-500">{date(order.created_at)}</span>
                  <span className="mt-1 block font-extrabold">
                    {formatPrice(order.amount, order.currency)}
                    {order.mode === "test" ? <span className="ml-2 text-xs font-semibold text-amber-700">Test</span> : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-2">
                  <StatusPill status={order.status} />
                  <ChevronRight className="size-4 text-slate-400" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.ok && result.data.has_more && last ? (
        <Link href={`/account/orders${query({ show: group, after: last.id })}`} className="mx-auto flex min-h-12 w-fit items-center rounded-xl border border-slate-200 bg-white px-5 font-semibold hover:border-slate-300">
          Older orders
        </Link>
      ) : null}
    </div>
  );
}
