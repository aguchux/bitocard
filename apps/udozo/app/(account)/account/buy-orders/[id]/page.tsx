import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { shopMoney, type ShopBuyOrder } from "@bitocard/api-client/classifieds";
import { BuyOrderControls, BuyOrderStatus } from "@/components/buy-order";
import { Thumb } from "@/components/account/thumb";
import { PurchaseReview } from "@/components/reviews/purchase-review";
import { requireSeller } from "@/lib/account";
import { buyOrderNext } from "@/lib/buy-orders";
import { customerApi } from "@/lib/customer";
import { uuidPattern } from "@/lib/shop";

export const metadata: Metadata = { title: "Buy order" };

type Props = { params: Promise<{ id: string }> };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** One buy order from the reader's side: the item, the price, what happened so far and the steps they can take. */
export default async function BuyOrderPage({ params }: Props) {
  const { id } = await params;
  await requireSeller(`/account/buy-orders/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopBuyOrder>("GET", `/v1/classifieds/buy-orders/${id}`);
  if (!result.ok) notFound();
  const order = result.data;
  const seller = order.role === "seller";
  const history = [
    { label: seller ? `${order.with.name} asked to buy` : "You asked to buy", at: order.created_at },
    order.accepted_at ? { label: "Accepted", at: order.accepted_at } : null,
    order.bought_at ? { label: seller ? `${order.with.name} said they bought it` : "You said you bought it", at: order.bought_at } : null,
    order.completed_at ? { label: order.completed_by === "auto" ? "Recorded as sold by itself" : "Marked sold", at: order.completed_at } : null,
  ].filter((item): item is { label: string; at: string } => Boolean(item));
  return (
    <div className="grid max-w-2xl gap-5">
      <Link href={`/account/buy-orders${seller ? "?role=selling" : ""}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to buy orders
      </Link>
      <header className="grid gap-1">
        <span className="text-xs font-semibold text-slate-500">Buy order {order.number}</span>
        <h1 className="text-xl font-extrabold">{seller ? `${order.with.name} wants to buy` : `Buying from ${order.with.name}`}</h1>
      </header>
      <section className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <Thumb url={order.listing.cover_url} size="size-20" />
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <Link href={order.listing.path} className="truncate font-bold hover:underline">
            {order.listing.title ?? "A listing"}
          </Link>
          <span className="text-lg font-extrabold">
            {shopMoney(order.price, order.currency)}
            {order.quantity > 1 ? <span className="text-sm font-normal text-slate-500"> for {order.quantity}</span> : null}
          </span>
          {order.counter !== null ? (
            <span className="text-sm">
              {seller ? "You offered" : `${order.with.name} offered`} <strong>{shopMoney(order.counter, order.currency)}</strong>
            </span>
          ) : null}
          {order.listing.price.amount !== null ? <span className="text-xs text-slate-500">Listed at {shopMoney(order.listing.price.amount, order.listing.price.currency)}</span> : null}
          <span>
            <BuyOrderStatus order={order} />
          </span>
        </div>
      </section>
      <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-800">{buyOrderNext(order)}</p>
      <BuyOrderControls order={order} />
      {!seller && order.status === "completed" ? <PurchaseReview buyOrderId={order.id} /> : null}
      {order.meet_note || order.note ? (
        <dl className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          {order.meet_note ? (
            <div className="grid gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">Where and when to meet</dt>
              <dd>{order.meet_note}</dd>
            </div>
          ) : null}
          {order.note ? (
            <div className="grid gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">{seller ? "Their note" : "Your note"}</dt>
              <dd className="whitespace-pre-wrap">{order.note}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {order.conversation_id ? (
        <Link href={`/account/messages/${order.conversation_id}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-navy-900 font-bold hover:bg-navy-50">
          <MessageCircle className="size-5" aria-hidden="true" /> Chat with {order.with.name}
        </Link>
      ) : null}
      <section aria-labelledby="history" className="grid gap-2">
        <h2 id="history" className="text-sm font-bold">
          What happened
        </h2>
        <ol className="grid gap-1.5 text-sm">
          {history.map(item => (
            <li key={item.label} className="flex justify-between gap-3 border-b border-slate-100 pb-1.5">
              <span>{item.label}</span>
              <span className="shrink-0 text-slate-500">{when(item.at)}</span>
            </li>
          ))}
          {order.end_reason && order.end_reason !== "listing_closed" ? <li className="text-slate-600">Why: {order.end_reason}</li> : null}
          {order.end_reason === "listing_closed" ? <li className="text-slate-600">The listing is no longer for sale.</li> : null}
        </ol>
      </section>
      <p className="text-xs text-slate-500">Udozo does not hold the money for buy orders: pay only once you have seen the item, in a busy public place. Never share codes sent to your phone.</p>
    </div>
  );
}
