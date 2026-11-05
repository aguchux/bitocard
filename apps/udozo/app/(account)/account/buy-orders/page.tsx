import type { Metadata } from "next";
import Link from "next/link";
import { shopMoney, type ShopBuyOrders } from "@bitocard/api-client/classifieds";
import { BuyOrderStatus } from "@/components/buy-order";
import { PageTitle } from "@/components/account/nav";
import { Thumb } from "@/components/account/thumb";
import { requireSeller } from "@/lib/account";
import { buyOrderNext } from "@/lib/buy-orders";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Buy orders" };

type Props = { searchParams: Promise<{ role?: string }> };

/**
 * Buy orders, buying and selling: asked at a price, accepted before meeting, paid in person, then marked sold. Each with
 * what to do next; the tabs say how many wait on the reader.
 */
export default async function BuyOrdersPage({ searchParams }: Props) {
  const { role: asked } = await searchParams;
  await requireSeller("/account/buy-orders");
  const role = asked === "selling" ? "selling" : "buying";
  const [buying, selling] = await Promise.all([customerApi<ShopBuyOrders>("GET", "/v1/classifieds/me/buy-orders?role=buying&limit=50"), customerApi<ShopBuyOrders>("GET", "/v1/classifieds/me/buy-orders?role=selling&limit=50")]);
  const result = role === "buying" ? buying : selling;
  const orders = result.ok ? result.data.data : [];
  const waiting = {
    buying: buying.ok ? buying.data.data.filter(order => order.role === "buyer" && order.status === "countered").length : 0,
    selling: selling.ok ? selling.data.data.filter(order => order.role === "seller" && (order.status === "requested" || (order.status === "accepted" && order.bought_at))).length : 0,
  };
  return (
    <div className="grid gap-5">
      <PageTitle title="Buy orders" />
      <p className="-mt-2 text-sm text-slate-600">
        Ask to buy at your price; once the seller accepts, it is held for you while you meet and pay in person. Paying with Safe pay instead? Those are in{" "}
        <Link href="/account/orders" className="font-semibold underline">
          Safe pay orders
        </Link>
        .
      </p>
      <nav aria-label="Buy orders by role">
        <ul className="flex gap-2">
          {(["buying", "selling"] as const).map(item => (
            <li key={item}>
              <Link
                href={item === "buying" ? "/account/buy-orders" : "/account/buy-orders?role=selling"}
                aria-current={item === role ? "page" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${item === role ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
              >
                {item === "buying" ? "Buying" : "Selling"}
                {waiting[item] ? <span className={item === role ? "text-brand-300" : "text-brand-700"}>• {waiting[item]}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!result.ok ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your buy orders could not be loaded just now. Try again shortly.</p>
      ) : orders.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {orders.map(order => (
            <li key={order.id}>
              <Link href={`/account/buy-orders/${order.id}`} className="grid h-full gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-300">
                <span className="flex gap-3">
                  <Thumb url={order.listing.cover_url} size="size-16" />
                  <span className="grid min-w-0 flex-1 content-start gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="truncate text-sm">{order.listing.title ?? "A listing"}</strong>
                      <span className="shrink-0 text-xs text-slate-500">{order.number}</span>
                    </span>
                    <span className="text-sm font-bold">
                      {shopMoney(order.counter ?? order.price, order.currency)}
                      {order.quantity > 1 ? <span className="font-normal text-slate-500"> for {order.quantity}</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <BuyOrderStatus order={order} />
                      <span className="text-xs text-slate-500">with {order.with.name}</span>
                    </span>
                  </span>
                </span>
                <span className="text-[13px] text-slate-600">{buyOrderNext(order)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          {role === "buying" ? "When you ask a seller to buy something, your buy orders show here. Look for Buy this on a listing." : "When a buyer asks to buy one of your listings, the buy order shows here for you to answer."}
        </p>
      )}
    </div>
  );
}
