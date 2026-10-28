import type { Metadata } from "next";
import Link from "next/link";
import { formatCrypto, formatFace } from "@bitocard/api-client/storefront";
import { CoinBadge } from "@afrippa/ui/coins";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { OrderBadge } from "@/components/order-badge";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import type { Order } from "@/lib/orders-types";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

/** The trader's orders: open ones first (what to do now), then the latest closed. */
export default async function OrdersPage() {
  await requireCustomer("/orders");
  const [open, closed] = await Promise.all([customerApi<{ data: Order[] }>("GET", "/v1/afrippa/p2p/orders?status=open"), customerApi<{ data: Order[] }>("GET", "/v1/afrippa/p2p/orders?status=closed&limit=30")]);
  return (
    <AccountShell title="Orders" current="/orders">
      <Section title="Open" orders={open.ok ? open.data.data : null} empty="No open orders. Take an ad on the market to start one." />
      <Section title="Closed" orders={closed.ok ? closed.data.data : null} empty="Your completed, cancelled and returned orders show here." />
    </AccountShell>
  );
}

function Section({ title, orders, empty }: { title: string; orders: Order[] | null; empty: string }) {
  return (
    <section className="space-y-3" aria-label={`${title} orders`}>
      <h2 className="font-display text-lg font-extrabold">{title}</h2>
      {orders === null ? (
        <p className={cardClass}>Your orders cannot be shown right now. Try again shortly.</p>
      ) : orders.length ? (
        <ul className="space-y-3">
          {orders.map(order => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className={`${cardClass} flex flex-wrap items-center justify-between gap-3 hover:ring-slate-300`}>
                <span className="flex min-w-0 items-center gap-3">
                  <CoinBadge asset={order.asset} />
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {order.side === "buy" ? "Buying" : "Selling"} {formatCrypto(order.amount, order.asset)} · {formatFace(order.fiat, order.currency)}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {order.number} · with {order.side === "buy" ? order.seller.nickname : order.buyer.nickname} · {tradeDate(order.created_at)}
                    </span>
                  </span>
                </span>
                <OrderBadge order={order} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cardClass}>{empty}</p>
      )}
    </section>
  );
}
