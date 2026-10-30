/* eslint-disable @next/next/no-img-element -- dispatch photos are private: read through this site with the customer's session. */
import Link from "next/link";
import { ChevronLeft, ExternalLink, Mail, MapPin, Phone, Store } from "lucide-react";
import { buyerOrderLabels, sellerOrderLabels, shipmentLabels, shopMoney, type ShopCourier, type ShopDispute, type ShopOrder, type ShopReadiness } from "@bitocard/api-client/classifieds";
import { localPhotoUrl, type OrderAction, orderSteps, orderTone } from "@/lib/shop";
import { DisputeThread, OrderPanel } from "./order-panel";
import { OrderThread } from "./order-thread";
import { ReportStore } from "./report-store";
import { Thumb } from "./thumb";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

type Line = { label: string; value: number; strong?: boolean };

/** Each side's own money: the buyer what they paid; a seller their price, the reseller's discount on a resale order, the fee and payout. */
function moneyLines(order: ShopOrder): Line[] {
  const buyer = order.role === "buyer";
  const delivery = order.delivery_fee ? [{ label: buyer ? "Delivery" : "Delivery charge (yours)", value: order.delivery_fee }] : [];
  if (buyer) {
    return [
      { label: order.quantity > 1 ? `Item × ${order.quantity}` : "Item", value: order.price },
      ...delivery,
      { label: "Safe pay fee", value: order.buyer_fee ?? 0 },
      { label: ["requested", "awaiting_payment"].includes(order.status) ? "Total to pay" : order.status === "locked" ? "Paid: locked in your wallet" : "Paid from wallet", value: order.total ?? order.price, strong: true },
    ];
  }
  const settled = order.status === "released" || order.status === "partly_refunded";
  return [
    { label: order.resale ? (order.quantity > 1 ? `Your price × ${order.quantity}` : "Your price") : "Price agreed", value: order.price },
    ...(order.resale ? [{ label: "Reseller’s discount", value: -(order.resale.supplier_price - order.resale.supplier_net) }] : []),
    ...delivery,
    { label: "Your Safe pay fee", value: -(order.seller_fee ?? 0) },
    { label: settled ? "Paid to you" : "You will be paid", value: order.payout ?? order.price, strong: true },
  ];
}

/**
 * A Safe pay order, from the reader's side: its status, what to do now, a resale order's buyer details (for the
 * supplier) and its threads, the shipment with its tracking and dispatch photos, the dispute, progress and money.
 * Shared by the account (`/account/orders/<id>`) and a Resale shop's buyer (`/account/purchases/<id>`).
 */
export function OrderDetail({
  order,
  actions,
  readiness,
  balance,
  addFundsHref,
  chatHref,
  couriers,
  dispute,
  back,
}: {
  order: ShopOrder;
  actions: OrderAction[];
  readiness: ShopReadiness | null;
  balance: number | null;
  addFundsHref: string;
  chatHref: string | null;
  couriers: ShopCourier[];
  dispute: ShopDispute | null;
  back: { href: string; label: string };
}) {
  const buyer = order.role === "buyer";
  const resale = order.kind === "resale";
  const steps = orderSteps(order);
  const shipment = order.shipment;
  return (
    <div className="grid max-w-2xl gap-5">
      <header className="flex items-start gap-2">
        <Link href={back.href} aria-label={back.label} className="-ml-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-slate-100">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <h1 className="truncate text-xl font-extrabold">{order.listing.title ?? "Order"}</h1>
          <span className="text-sm text-slate-600">
            {order.number} · {buyer ? "from" : "to"} {order.with.name} · {order.fulfilment === "meet_up" ? "in person" : "delivery"}
            {order.quantity > 1 ? ` · ${order.quantity} units` : ""}
          </span>
        </span>
        <Thumb url={order.listing.cover_url} size="size-12" />
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <p className={`rounded-full px-3 py-1 text-sm font-bold ${orderTone(order.status)}`}>{(buyer ? buyerOrderLabels : sellerOrderLabels)[order.status]}</p>
        {resale && !buyer && order.store ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-800">
            <Store className="size-4" aria-hidden="true" /> Resale through {order.store.name}
          </p>
        ) : null}
      </div>
      {resale && buyer && order.supplier ? <p className="text-sm text-slate-600">Sold by {order.with.name}; supplied by {order.supplier.name}, who hands it over or ships it.</p> : null}
      {order.payout_review === "pending" ? <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">Udozo is checking this payment before it can be cashed out. Nothing is needed from you.</p> : null}

      <OrderPanel order={order} actions={actions} readiness={readiness} balance={balance} addFundsHref={addFundsHref} chatHref={chatHref} couriers={couriers} />

      {!buyer && order.buyer_details ? (
        <section aria-labelledby="buyer" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h2 id="buyer" className="font-bold">
            The buyer
          </h2>
          <p className="text-xs text-slate-600">To deliver this order only: never contact them for anything else. Every time these are opened is recorded.</p>
          <p className="font-semibold">{order.buyer_details.name}</p>
          {order.buyer_details.phone ? (
            <a href={`tel:${order.buyer_details.phone}`} className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline">
              <Phone className="size-4" aria-hidden="true" /> {order.buyer_details.phone}
            </a>
          ) : null}
          <span className="inline-flex items-center gap-2 text-slate-600">
            <Mail className="size-4" aria-hidden="true" /> {order.buyer_details.email}
          </span>
          {order.buyer_details.address ? (
            <span className="flex items-start gap-2 text-slate-600">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {order.buyer_details.address}
            </span>
          ) : null}
        </section>
      ) : null}

      {resale ? <OrderThread orderId={order.id} side={buyer ? "buyer" : "supplier"} storeName={order.store?.name ?? "the store"} /> : null}

      {dispute ? <DisputeThread dispute={dispute} /> : null}

      {shipment && (shipment.courier || shipment.dispatch_photos.length) ? (
        <section aria-labelledby="shipment" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h2 id="shipment" className="font-bold">
            Delivery
          </h2>
          {shipment.courier ? (
            <p>
              {shipment.courier}, tracking <strong>{shipment.tracking_number}</strong>
              {shipment.tracking_url ? (
                <a href={shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                  Track <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </p>
          ) : null}
          {shipment.events.length ? (
            <ol className="grid gap-1 border-l-2 border-slate-200 pl-3">
              {shipment.events.map(event => (
                <li key={`${event.status}-${event.at}`}>
                  <strong>{shipmentLabels[event.status]}</strong> <span className="text-slate-500">{when(event.at)}</span>
                  {event.note && event.status !== "shipped" ? <span className="block text-slate-600">{event.note}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {shipment.dispatch_photos.length && order.status !== "paid" ? (
            <div className="grid gap-1.5">
              <span className="text-xs text-slate-500">Photos taken before it was sent</span>
              <ul className="flex flex-wrap gap-2">
                {shipment.dispatch_photos.map(photo =>
                  localPhotoUrl(photo.url) ? (
                    <li key={photo.id}>
                      <a href={localPhotoUrl(photo.url)!} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-xl bg-slate-100">
                        <img src={localPhotoUrl(photo.url)!} alt="Dispatch photo" className="size-full object-cover" loading="lazy" />
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="progress" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 id="progress" className="font-bold">
          Progress
        </h2>
        <ol className="grid">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${step.state === "done" ? "bg-emerald-700 text-white" : step.state === "now" ? "border-[3px] border-emerald-700 bg-white" : "border-2 border-slate-300 bg-white"}`}>
                  {step.state === "done" ? "✓" : ""}
                </span>
                {index < steps.length - 1 ? <span className={`w-0.5 flex-1 ${step.state === "done" ? "bg-emerald-700" : "bg-slate-200"}`} /> : null}
              </span>
              <span className="grid pb-4">
                <strong className={`text-sm ${step.state === "later" ? "font-medium text-slate-500" : ""}`}>{step.title}</strong>
                <span className="text-xs text-slate-500">{when(step.at)}</span>
              </span>
            </li>
          ))}
        </ol>
        {order.end_reason ? <p className="text-sm text-slate-600">{order.end_reason.replace(/_/g, " ")}</p> : null}
      </section>

      <section aria-label="The money" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        {moneyLines(order).map(line => (
          <div key={line.label} className={`flex justify-between gap-3 ${line.strong ? "border-t border-slate-100 pt-2 text-base font-bold" : ""}`}>
            <span>{line.label}</span>
            <span className={line.strong ? "" : "font-semibold"}>{line.value < 0 ? `− ${shopMoney(-line.value, order.currency)}` : shopMoney(line.value, order.currency)}</span>
          </div>
        ))}
        {order.refund ? <p className="text-emerald-800">Refunded to your wallet: {shopMoney(order.refund, order.currency)}</p> : null}
        {order.deadlines.handover_by && order.status === "paid" ? (
          <p className="text-xs text-slate-600">{buyer ? `Hand-over or shipping by ${when(order.deadlines.handover_by)}, or you are refunded in full automatically.` : `Hand it over or ship it by ${when(order.deadlines.handover_by)}, or the buyer is refunded.`}</p>
        ) : null}
        {!buyer ? <p className="text-xs text-slate-600">Paid to your Udozo balance once the buyer has it, then withdrawable after the payout hold. No fee if the sale does not go ahead.</p> : null}
        {order.tracking_note ? (
          <p className="text-xs text-slate-600">
            <strong>Note:</strong> {order.tracking_note}
          </p>
        ) : null}
      </section>

      {resale && buyer && order.store ? <ReportStore target={{ kind: "order", orderId: order.id, storeName: order.store.name }} /> : null}

      {chatHref ? (
        <Link href={chatHref} className="flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white font-bold hover:border-slate-400">
          Message {order.with.name}
        </Link>
      ) : null}
    </div>
  );
}
