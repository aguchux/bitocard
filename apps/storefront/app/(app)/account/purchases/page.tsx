import type { Metadata } from "next";
import Link from "next/link";
import { buyerOrderLabels, shopMoney, type ShopOrders } from "@bitocard/api-client/classifieds";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { orderNext, orderTone } from "@/lib/shop";

export const metadata: Metadata = { title: "Your orders" };

/** A Resale shop's orders for its customer (B2B reselling), newest first, each with what happens next. */
export default async function PurchasesPage() {
  const result = await customerApi<ShopOrders>("GET", "/v1/store/resale/orders?limit=50");
  const orders = result.ok ? result.data.data : [];
  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-extrabold tracking-tight">Your orders</h1>
      {!result.ok ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your orders could not be loaded just now. Try again shortly.</p>
      ) : orders.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {orders.map(order => (
            <li key={order.id}>
              <Link href={`/account/purchases/${order.id}`} className="grid h-full gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-300">
                <span className="flex gap-3">
                  <Thumb url={order.listing.cover_url} size="size-16" />
                  <span className="grid min-w-0 flex-1 content-start gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="truncate text-sm">{order.listing.title ?? "Your order"}</strong>
                      <span className="shrink-0 text-xs text-slate-500">{order.number}</span>
                    </span>
                    <span className="text-sm font-bold">{shopMoney(order.total ?? order.price, order.currency)}</span>
                    <span className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] font-bold ${orderTone(order.status)}`}>{buyerOrderLabels[order.status]}</span>
                  </span>
                </span>
                <span className="text-[13px] text-slate-600">{orderNext(order)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          Nothing yet. When you buy here, your payment is held safely until you have the item.{" "}
          <Link href="/listings" className="font-semibold text-brand-700 hover:underline">
            Shop now
          </Link>
        </p>
      )}
    </div>
  );
}
