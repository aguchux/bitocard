"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, ChatPanel, Notice, PageHeader, QueryView, Skeleton, Tabs, errorMessage, formatDate, formatDateTime, formatMoney } from "@bitocard/admin-ui";
import {
  type ResaleOrderDetail,
  type ResaleOrderThread,
  useCancelResaleOrderMutation,
  useResaleOrderDisputeQuery,
  useResaleOrderMessagesQuery,
  useResaleOrderQuery,
  useSendResaleOrderMessageMutation,
  useWriteResaleDisputeMutation,
} from "@bitocard/api-client/reseller";
import { shipmentLabels } from "@bitocard/api-client/classifieds";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { ResaleOrderBadge } from "@/components/resale";

/** Who wrote each message, for the chat panel: your team on your side, the buyer, the supplier and Udozo opposite. */
const authorOf = { me: "reseller", buyer: "customer", supplier: "supplier", reseller: "reseller", bitocard: "bitocard" } as const;

function Money({ order }: { order: ResaleOrderDetail }) {
  const rows: Array<[string, string]> = [
    ["Your price", formatMoney(order.price, order.currency)],
    ...(order.delivery_fee ? ([["Delivery (to the supplier)", formatMoney(order.delivery_fee, order.currency)]] as Array<[string, string]>) : []),
    ["Buyer paid in all", formatMoney(order.total, order.currency)],
    ["Supplier’s net", formatMoney(order.supplier_net, order.currency)],
    ["Your margin", formatMoney(order.margin, order.currency)],
    ...(order.reseller_fee !== null ? ([["Udozo’s fee", `− ${formatMoney(order.reseller_fee, order.currency)}`]] as Array<[string, string]>) : []),
    ...(order.earnings !== null ? ([["Added to your earnings", formatMoney(order.earnings, order.currency)]] as Array<[string, string]>) : []),
    ...(order.refund !== null ? ([["Refunded to the buyer", formatMoney(order.refund, order.currency)]] as Array<[string, string]>) : []),
  ];
  return (
    <dl className="divide-y divide-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-2 text-sm">
          <dt className="text-muted">{label}</dt>
          <dd className="font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Thread({ order, thread, canWrite }: { order: ResaleOrderDetail; thread: ResaleOrderThread; canWrite: boolean }) {
  const messages = useResaleOrderMessagesQuery({ id: order.id, thread }, { pollingInterval: 5000, skipPollingIfUnfocused: true });
  const [send, sending] = useSendResaleOrderMessageMutation();
  return (
    <ChatPanel
      side="reseller"
      messages={(messages.data?.data ?? []).map(message => ({ id: message.id, author: authorOf[message.from], author_name: message.name, body: message.body, created_at: message.created_at }))}
      disabled={!canWrite}
      error={sending.error ? errorMessage(sending.error) : null}
      placeholder={thread === "order" ? "Write to the buyer (they see your store’s name)" : "Write to the supplier"}
      onSend={async body => "data" in (await send({ id: order.id, thread, body }))}
    />
  );
}

const faultText = { supplier: "the supplier", reseller: "your store", none: "nobody" } as const;

/** The buyer's dispute: the buyer, the supplier and your team all write to Udozo here, which decides. */
function Dispute({ order, canWrite }: { order: ResaleOrderDetail; canWrite: boolean }) {
  const dispute = useResaleOrderDisputeQuery(order.id, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
  const [write, writing] = useWriteResaleDisputeMutation();
  const decided = dispute.data?.status === "decided";
  return (
    <Card>
      <CardHeader
        title="Dispute"
        description={
          decided && dispute.data
            ? `Udozo decided: ${dispute.data.note ?? ""}${dispute.data.fault ? ` It counted against ${faultText[dispute.data.fault]}.` : ""}`
            : "Tell Udozo what you know: what your store’s note and pages said, and anything the buyer was told. A dispute lost because of your store counts towards your strikes."
        }
      />
      <div className="p-5">
        <QueryView query={dispute} loading={<Skeleton className="h-48" />}>
          {data => (
            <ChatPanel
              side="reseller"
              messages={data.messages.map(message => ({
                id: message.id,
                author: message.from === "me" ? "reseller" : message.from === "bitocard" ? "bitocard" : "customer",
                author_name: message.name,
                body: message.body || (message.photo ? "(sent a photo)" : ""),
                created_at: message.created_at,
              }))}
              disabled={!canWrite || decided}
              error={writing.error ? errorMessage(writing.error) : null}
              placeholder="Write to Udozo (the buyer and the supplier see it too)"
              onSend={async body => "data" in (await write({ id: order.id, body }))}
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}

/** One resale order: where it is, the buyer’s details once accepted, the shipment, the money, and both threads. */
export default function ResaleOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useReseller();
  const query = useResaleOrderQuery(id, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const [cancel] = useCancelResaleOrderMutation();
  const [cancelling, setCancelling] = useState(false);
  const [thread, setThread] = useState<ResaleOrderThread>("order");
  const canWrite = can(membership, "admin", "support");

  return (
    <ShqShell section="resale" current="/resale/orders" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Orders", href: "/resale/orders" }, { label: query.data?.number ?? "Order" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {order => (
          <>
            <PageHeader
              title={order.listing.title}
              description={`${order.number} · bought ${formatDateTime(order.created_at)}${order.quantity > 1 ? ` · ${order.quantity} units` : ""} · supplied by ${order.supplier.name}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ResaleOrderBadge status={order.status} />
                  {can(membership, "admin") && (order.status === "locked" || order.status === "paid") ? (
                    <Button variant="secondary" onClick={() => setCancelling(true)}>Cancel order</Button>
                  ) : null}
                </div>
              }
            />
            {order.status === "locked" ? (
              <Notice tone="amber" title="Waiting for the supplier">
                The buyer’s money is locked until the supplier accepts, by {formatDateTime(order.accept_by)}. If they do not, it goes back to the buyer.
              </Notice>
            ) : null}
            {order.dispute?.status === "open" ? <Notice tone="red" title="In dispute">Udozo is deciding. The money stays held until then.</Notice> : null}
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Conversation" description="In the order chat the buyer sees everything from your side, yours and the supplier’s, as your store’s. The trade thread is between you and the supplier only. Never ask for payment outside Udozo." />
                  <div className="space-y-4 p-5">
                    <Tabs<ResaleOrderThread>
                      label="Thread"
                      value={thread}
                      onChange={setThread}
                      items={[
                        { value: "order", label: "With the buyer" },
                        { value: "trade", label: "With the supplier" },
                      ]}
                    />
                    <Thread key={thread} order={order} thread={thread} canWrite={canWrite} />
                  </div>
                </Card>
                {order.dispute ? <Dispute order={order} canWrite={canWrite} /> : null}
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Buyer" description={order.buyer ? "Use these only for this order. Every view is recorded." : "Shown once the supplier accepts the order."} />
                  {order.buyer ? (
                    <ul className="space-y-2 p-5 text-sm">
                      <li className="font-semibold text-ink">{order.buyer.name}</li>
                      {order.buyer.phone ? (
                        <li>
                          <a href={`tel:${order.buyer.phone}`} className="inline-flex items-center gap-2 text-brand-600 hover:underline"><Phone className="size-4" aria-hidden /> {order.buyer.phone}</a>
                        </li>
                      ) : null}
                      <li className="inline-flex items-center gap-2 text-muted"><Mail className="size-4" aria-hidden /> {order.buyer.email}</li>
                      {order.buyer.address ? (
                        <li className="flex items-start gap-2 text-muted"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {order.buyer.address}</li>
                      ) : null}
                    </ul>
                  ) : null}
                </Card>
                <Card>
                  <CardHeader title="Money" />
                  <div className="px-5 pb-5">
                    <Money order={order} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title={order.fulfilment === "delivery" ? "Delivery" : "Hand-over in person"} description={order.fulfilment === "delivery" ? "The supplier ships it with tracking." : "The supplier meets the buyer; the buyer gives their release code once they have checked the item."} />
                  <div className="space-y-3 px-5 pb-5 text-sm">
                    {order.deadlines.handover_by && ["paid"].includes(order.status) ? <p className="text-muted">To hand over or ship by {formatDate(order.deadlines.handover_by)}.</p> : null}
                    {order.shipment?.courier ? (
                      <p>
                        {order.shipment.courier}, tracking <span className="font-semibold text-ink">{order.shipment.tracking_number}</span>
                        {order.shipment.tracking_url ? (
                          <a href={order.shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline">Track <ExternalLink className="size-3.5" aria-hidden /></a>
                        ) : null}
                      </p>
                    ) : null}
                    {order.shipment?.events.length ? (
                      <ol className="space-y-1 border-l border-line pl-4">
                        {order.shipment.events.map(event => (
                          <li key={`${event.status}-${event.at}`}>
                            <span className="font-semibold text-ink">{shipmentLabels[event.status]}</span> <span className="text-muted">{formatDateTime(event.at)}</span>
                            {event.note ? <p className="text-muted">{event.note}</p> : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {order.shipment?.dispatch_photos.length ? <p className="text-muted">{order.shipment.dispatch_photos.length} dispatch photos from the supplier.</p> : null}
                    {order.note_shown ? <p className="text-muted">Your note the buyer saw: “{order.note_shown}”</p> : null}
                  </div>
                </Card>
              </div>
            </div>
            <ActionDialog
              open={cancelling}
              onClose={() => setCancelling(false)}
              title="Cancel this order?"
              description="The buyer gets all their money back, and your reason is told to them and the supplier. Each cancellation counts towards your strikes; too many pause your Resale shops’ checkout until Udozo reviews it."
              confirmLabel="Cancel order"
              tone="danger"
              onConfirm={async reason => {
                await cancel({ id: order.id, reason }).unwrap();
              }}
            />
          </>
        )}
      </QueryView>
    </ShqShell>
  );
}
