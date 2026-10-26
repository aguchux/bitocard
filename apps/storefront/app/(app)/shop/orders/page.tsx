import type { Metadata } from "next";
import Link from "next/link";
import { buyerOrderLabels, sellerOrderLabels, shopMoney, type ShopOrders } from "@bitocard/api-client/classifieds";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { orderNext, orderTone } from "@/lib/shop";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Safe pay orders" };

type Props = { searchParams: Promise<{ role?: string }> };

/**
 * Safe pay orders, buying and selling (the design canvas's Orders board), each with what to do next. Store orders
 * (gift cards, airtime) stay in the Orders tab.
 */
export default async function ShopOrdersPage({ searchParams }: Props) {
  const { role: asked } = await searchParams;
  const { shop } = await requireShop("/shop/orders");
  const role = asked === "selling" ? "selling" : "buying";
  const [result, selling] = await Promise.all([
    customerApi<ShopOrders>("GET", `/v1/classifieds/orders?role=${role}&limit=50`),
    role === "buying" ? customerApi<ShopOrders>("GET", "/v1/classifieds/orders?role=selling&limit=50") : null,
  ]);
  const orders = result.ok ? result.data.data : [];
  // Requests waiting for the seller's answer, or paid orders to hand over: shown on the Selling tab.
  const sellerWaiting = (role === "selling" ? orders : selling?.ok ? selling.data.data : []).filter(order => order.status === "requested" || order.status === "locked" || order.status === "paid").length;
  return (
    <div className="grid gap-5">
      <ShopTitle title="Safe pay orders" note="Your gift card and airtime orders are in the Orders tab." />
      <ShopPills shop={shop} active="/shop/orders" />
      <nav aria-label="Orders by role">
        <ul className="flex gap-2">
          {(["buying", "selling"] as const).map(item => (
            <li key={item}>
              <Link
                href={item === "buying" ? "/shop/orders" : "/shop/orders?role=selling"}
                aria-current={item === role ? "page" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${item === role ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
              >
                {item === "buying" ? "Buying" : "Selling"}
                {item === "selling" && sellerWaiting ? <span className={item === role ? "text-brand-300" : "text-brand-700"}>• {sellerWaiting}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!result.ok ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your orders could not be loaded just now. Try again shortly.</p>
      ) : orders.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {orders.map(order => (
            <li key={order.id}>
              <Link href={`/shop/orders/${order.id}`} className="grid h-full gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-300">
                <span className="flex gap-3">
                  <Thumb url={order.listing.cover_url} size="size-16" />
                  <span className="grid min-w-0 flex-1 content-start gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="truncate text-sm">{order.listing.title ?? "A listing"}</strong>
                      <span className="shrink-0 text-xs text-slate-500">{order.number}</span>
                    </span>
                    <span className="text-sm font-bold">{shopMoney(order.role === "buyer" ? (order.total ?? order.price) : (order.payout ?? order.price), order.currency)}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${orderTone(order.status)}`}>{(order.role === "buyer" ? buyerOrderLabels : sellerOrderLabels)[order.status]}</span>
                      {order.kind === "resale" && order.store ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Resale through {order.store.name}</span> : null}
                    </span>
                  </span>
                </span>
                <span className="text-[13px] text-slate-600">{orderNext(order)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          {role === "buying" ? "When you buy with Safe pay, your orders show here. BitoCard holds the money until you have the item." : "When a buyer asks to pay with Safe pay, or buys your listing on a reseller’s store, the order shows here for you to accept."}
        </p>
      )}
    </div>
  );
}
