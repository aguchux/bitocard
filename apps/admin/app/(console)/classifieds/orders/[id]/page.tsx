"use client";

import { useParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ActionDialog, amountToMinor, Badge, Button, Card, CardHeader, cn, errorMessage, Field, formatDateTime, formatMoney, Input, KeyValue, Notice, PageHeader, QueryView, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedOrderDetail, type ClassifiedDisputeDecision, disputeOutcome, useClassifiedOrderQuery, useDecideClassifiedDisputeMutation, useDecideClassifiedPayoutReviewMutation, useWriteClassifiedDisputeMutation } from "@bitocard/api-client/admin";
import { disputeReasonLabels, ListingCell, OrderStatus, PersonCell, PrivatePhoto, payoutReviewLabels, payoutReviewTones } from "@/components/classifieds";

const decisions: Array<{ value: ClassifiedDisputeDecision; title: string; detail: string }> = [
  { value: "refund", title: "Full refund", detail: "Price and buyer fee back to the buyer's wallet. No seller fee." },
  { value: "partial", title: "Part refund", detail: "Part of the price back; the rest to the seller less their fee on it. Buyer fee kept." },
  { value: "release", title: "Release to the seller", detail: "Seller paid less their fee. Both fees kept." },
];

const authorLabels = { buyer: "Buyer", seller: "Seller", reseller: "Store", bitocard: "BitoCard" } as const;

/** On a resale order, whose strike an upheld dispute is: the supplier's, or the store's when its note or claims misled the buyer. */
const faults = [
  { value: "supplier", title: "The supplier", detail: "The item or its delivery was not as the supplier’s listing said." },
  { value: "reseller", title: "The store", detail: "The store’s note, pages or messages misled the buyer." },
  { value: "none", title: "Nobody", detail: "No strike for either." },
] as const;

/**
 * One Safe pay order: the money each side sees, the people, the deadlines and what happened, and its dispute. Support,
 * operations and finance write on the dispute (both sides see it); operations or finance release, and finance refunds
 * (in full or in part), behind the step-up window. Finance approves a seller's payout held for review.
 */
export default function ClassifiedOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useClassifiedOrderQuery(id);
  return (
    <AdminShell section="classifieds" current="/classifieds/orders" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Safe pay orders", href: "/classifieds/orders" }, { label: order.data?.number ?? "Order" }]}>
      <QueryView query={order} loading={<Skeleton className="h-96 w-full" />}>
        {data => <Order order={data} />}
      </QueryView>
    </AdminShell>
  );
}

function Order({ order }: { order: AdminClassifiedOrderDetail }) {
  const admin = useAdmin();
  const [reviewing, setReviewing] = useState<"approve" | "reject" | null>(null);
  const [reviewPayout] = useDecideClassifiedPayoutReviewMutation();
  const money = (minor: number) => formatMoney(minor, order.currency);
  const decides = can(admin, "operations", "finance");
  const finance = can(admin, "finance");
  const reviewable = order.payout_review === "pending" || order.payout_review === "rejected";

  return (
    <>
      <PageHeader
        title={order.number}
        description={`${order.country} · ${order.fulfilment === "meet_up" ? "Meet-up" : "Delivery"}${order.quantity > 1 ? ` · ${order.quantity} units` : ""}${order.kind === "resale" && order.store ? ` · resale on ${order.store.name}` : ""}${order.mode === "test" ? " · test" : ""}`}
        actions={
          <span className="flex flex-wrap gap-2">
            {reviewable && finance ? (
              <>
                <Button onClick={() => setReviewing("approve")}>Approve the payout</Button>
                {order.payout_review === "pending" ? (
                  <Button variant="secondary" onClick={() => setReviewing("reject")}>
                    Keep it held
                  </Button>
                ) : null}
              </>
            ) : null}
          </span>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <OrderStatus status={order.status} />
        {order.payout_review ? <Badge tone={payoutReviewTones[order.payout_review]}>{payoutReviewLabels[order.payout_review]}</Badge> : null}
      </div>
      {order.payout_review === "pending" ? (
        <div className="mt-4">
          <Notice tone="amber" title="The seller's payout is held for review">
            The buyer topped up by card or mobile money in the 60 days before paying, which their bank can still reverse. {money(order.payout)} stays out of the seller&apos;s cash-out until finance approves it.
          </Notice>
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Money" />
            <div className="px-5 pb-5 sm:px-6">
              <KeyValue
                items={[
                  { label: order.resale ? "Store's price" : "Price", value: money(order.price) },
                  ...(order.delivery_fee ? [{ label: "Delivery (to the seller)", value: money(order.delivery_fee) }] : []),
                  { label: "Buyer's fee", value: money(order.buyer_fee) },
                  { label: "Buyer paid", value: money(order.total) },
                  ...(order.resale
                    ? [
                        { label: "Supplier's price", value: money(order.resale.supplier_price) },
                        { label: "Reseller's discount", value: `${order.resale.discount_bps / 100}%${order.resale.deal_id ? " (a deal)" : ""}` },
                        { label: "Supplier's net", value: money(order.resale.supplier_net) },
                        { label: "Reseller's margin", value: money(order.resale.margin) },
                        { label: "Reseller's fee", value: money(order.resale.reseller_fee) },
                        { label: "Reseller's earnings", value: money(order.resale.earnings) },
                      ]
                    : []),
                  { label: order.resale ? "Supplier's fee" : "Seller's fee", value: money(order.seller_fee) },
                  { label: order.resale ? "Supplier's payout" : "Seller's payout", value: money(order.payout) },
                  { label: "Refunded", value: order.refund === null ? "—" : money(order.refund) },
                ]}
              />
            </div>
          </Card>
          {order.dispute ? <Dispute order={order} /> : null}
          <Card>
            <CardHeader title="What happened" />
            <div className="grid gap-6 px-5 pb-5 sm:grid-cols-2 sm:px-6">
              <KeyValue
                items={[
                  { label: order.kind === "resale" ? "Bought (locked)" : "Asked", value: formatDateTime(order.timeline.requested_at) },
                  { label: "Accepted", value: formatDateTime(order.timeline.accepted_at) },
                  { label: "Paid", value: formatDateTime(order.timeline.paid_at) },
                  { label: "Sent", value: formatDateTime(order.timeline.sent_at) },
                  { label: "Released", value: formatDateTime(order.timeline.released_at) },
                  { label: "Refunded", value: formatDateTime(order.timeline.refunded_at) },
                  { label: "Closed", value: formatDateTime(order.timeline.closed_at) },
                ]}
              />
              <KeyValue
                items={[
                  { label: "Accept by", value: formatDateTime(order.deadlines.accept_by) },
                  { label: "Pay by", value: formatDateTime(order.deadlines.pay_by) },
                  { label: "Hand over by", value: formatDateTime(order.deadlines.handover_by) },
                  { label: "Confirm by", value: formatDateTime(order.deadlines.confirm_by) },
                  { label: "Ended by", value: order.ended_by ?? "—" },
                  { label: "Why", value: order.end_reason ?? "—" },
                ]}
              />
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          {order.dispute?.status === "open" && decides ? <Decision order={order} finance={finance} /> : null}
          <Card>
            <CardHeader title="The ad" />
            <div className="px-5 pb-5 sm:px-6">
              <ListingCell listing={order.listing} />
            </div>
          </Card>
          <Card>
            <CardHeader title="People" />
            <div className="space-y-3 px-5 pb-5 text-sm sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer</p>
                <PersonCell person={order.buyer} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{order.kind === "resale" ? "Supplier (the seller)" : "Seller"}</p>
                <PersonCell person={order.seller} />
              </div>
              {order.store ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Bought on</p>
                  <p className="font-semibold text-ink">{order.store.name}</p>
                  <p className="text-xs text-muted">{order.store.subdomain}.bitocard.com</p>
                </div>
              ) : null}
              {order.buyer_details ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer’s details (this view is logged)</p>
                  <p className="text-ink">{order.buyer_details.phone ?? "No phone"}</p>
                  {order.buyer_details.address ? <p className="text-muted">{order.buyer_details.address}</p> : null}
                </div>
              ) : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Hand-over" />
            <div className="px-5 pb-5 text-sm sm:px-6">
              <KeyValue
                items={[
                  { label: "Delivery address", value: order.delivery_address ?? order.buyer_details?.address ?? "—" },
                  { label: "Courier", value: order.shipment?.courier ? `${order.shipment.courier} ${order.shipment.tracking_number ?? ""}` : "—" },
                  { label: "Delivered", value: formatDateTime(order.shipment?.delivered_at ?? null) },
                  { label: "Note", value: order.tracking_note ?? "—" },
                  { label: "Release code tries left", value: order.release_tries_left === null ? "—" : String(order.release_tries_left) },
                ]}
              />
              {order.shipment?.tracking_url ? (
                <a href={order.shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
                  Track the parcel
                </a>
              ) : null}
              {order.shipment?.events.length ? (
                <ol className="mt-3 space-y-1 border-l border-line pl-3">
                  {order.shipment.events.map(event => (
                    <li key={`${event.status}-${event.at}`}>
                      <span className="font-semibold text-ink">{event.status.replace(/_/g, " ")}</span> <span className="text-muted">{formatDateTime(event.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {order.shipment?.dispatch_photos.length ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {order.shipment.dispatch_photos.map(photo => (
                    <PrivatePhoto key={photo.id} path={photo.url} alt="Dispatch photo" />
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
      {reviewing ? (
        <ActionDialog
          open
          onClose={() => setReviewing(null)}
          title={reviewing === "approve" ? `Approve ${money(order.payout)} for the seller?` : "Keep the payout held?"}
          description={
            reviewing === "approve"
              ? "The seller can withdraw it once the payout hold ends. Approve only once the buyer's card or mobile money payment can no longer be reversed, or you are satisfied it is genuine."
              : "The money stays out of the seller's cash-out. You can still approve it later."
          }
          confirmLabel={reviewing === "approve" ? "Approve" : "Keep held"}
          onConfirm={note => reviewPayout({ id: order.id, decision: reviewing, note }).unwrap()}
        />
      ) : null}
    </>
  );
}

function Dispute({ order }: { order: AdminClassifiedOrderDetail }) {
  const dispute = order.dispute!;
  const admin = useAdmin();
  const id = useId();
  const [body, setBody] = useState("");
  const [write, writing] = useWriteClassifiedDisputeMutation();
  const writes = can(admin, "support", "operations", "finance");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    await write({ id: order.id, body: body.trim() }).unwrap();
    setBody("");
  };

  return (
    <Card>
      <CardHeader
        title="Dispute"
        description={`${disputeReasonLabels[dispute.reason] ?? dispute.reason} · opened ${formatDateTime(dispute.created_at)}`}
        actions={<Badge tone={dispute.status === "open" ? "red" : "grey"}>{dispute.status === "open" ? "Open" : `Decided: ${dispute.decision}`}</Badge>}
      />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        {dispute.status === "decided" ? (
          <Notice tone="blue" title={`Decided ${formatDateTime(dispute.decided_at)}`}>
            {dispute.decision === "partial" && dispute.refund !== null ? `${formatMoney(dispute.refund, order.currency)} refunded. ` : ""}
            {dispute.note}
            {dispute.fault && dispute.fault !== "none" ? ` A strike for ${dispute.fault === "reseller" ? "the store" : "the seller"}.` : ""}
          </Notice>
        ) : null}
        <ol className="space-y-3">
          {dispute.messages.map(message => (
            <li key={message.id} className={cn("rounded-xl border px-4 py-3 text-sm", message.from === "bitocard" ? "border-brand-200 bg-brand-50" : "border-line bg-white")}>
              <p className="text-xs font-semibold text-muted">
                {authorLabels[message.from]}{message.name && message.from !== "bitocard" ? ` (${message.name})` : ""} · {formatDateTime(message.created_at)}
              </p>
              {message.body ? <p className="mt-1 whitespace-pre-line text-ink">{message.body}</p> : null}
              {message.photo ? (
                <div className="mt-2">
                  <PrivatePhoto path={message.photo.url} alt={`Photo from the ${message.from}`} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {dispute.status === "open" && writes ? (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Write to both sides" htmlFor={`${id}-body`} hint="The buyer and the seller both see this and are told.">
              <Textarea id={`${id}-body`} rows={3} maxLength={2000} value={body} onChange={event => setBody(event.target.value)} />
            </Field>
            {writing.error ? <Notice tone="red">{errorMessage(writing.error)}</Notice> : null}
            <Button type="submit" size="sm" loading={writing.isLoading} disabled={!body.trim()}>
              Send
            </Button>
          </form>
        ) : null}
        <p className="text-xs text-muted">
          Photos open from the private bucket, and each opening is recorded. The order&apos;s chat, if any, is private unless someone reports it (
          <AppLink href="/classifieds/reports" className="text-brand-600 hover:underline">
            Reports
          </AppLink>
          ).
        </p>
      </div>
    </Card>
  );
}

/**
 * The decision beside the dispute, as the canvas draws it: the three outcomes, the refund for a part refund, where the
 * money goes (worked out as the API settles it) and the reason both sides are told. Deciding asks once more, then the
 * money moves; refunds need finance, and the step-up code is asked for when the window is closed.
 */
function Decision({ order, finance }: { order: AdminClassifiedOrderDetail; finance: boolean }) {
  const id = useId();
  const [decision, setDecision] = useState<ClassifiedDisputeDecision>(finance ? "partial" : "release");
  const [refund, setRefund] = useState("");
  const [note, setNote] = useState("");
  const [fault, setFault] = useState<(typeof faults)[number]["value"]>("supplier");
  const [confirming, setConfirming] = useState(false);
  const [decide] = useDecideClassifiedDisputeMutation();
  const resale = order.kind === "resale";
  const money = (minor: number) => formatMoney(minor, order.currency);
  const refundMinor = amountToMinor(refund);
  const refundProblem = decision === "partial" && (refundMinor === null || refundMinor <= 0 || refundMinor >= order.price) ? `More than nothing and less than ${money(order.price)}.` : null;
  const outcome = disputeOutcome(order, decision, refundMinor ?? 0);
  const ready = !refundProblem && note.trim().length >= 5;

  return (
    <Card>
      <CardHeader title="Decision" description={finance ? "Refunds need finance and your authenticator code." : "Refunds are decided by finance; you can release."} />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <fieldset className="space-y-2">
          <legend className="sr-only">Decision</legend>
          {decisions.map(option => {
            const allowed = option.value === "release" || finance;
            return (
              <label key={option.value} className={cn("flex gap-3 rounded-xl border p-3", decision === option.value ? "border-2 border-ink" : "border-line", !allowed && "opacity-50")}>
                <input type="radio" name={`${id}-decision`} value={option.value} checked={decision === option.value} disabled={!allowed} onChange={() => setDecision(option.value)} className="mt-1 size-4 accent-ink" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{option.title}</span>
                  <span className="block text-xs text-muted">{option.detail}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {decision === "partial" ? (
          <Field label={`Refund to the buyer (${order.currency})`} htmlFor={`${id}-refund`} error={refund.trim() && refundProblem ? refundProblem : undefined}>
            <Input id={`${id}-refund`} inputMode="decimal" value={refund} onChange={event => setRefund(event.target.value)} placeholder="e.g. 120000" />
          </Field>
        ) : null}
        <dl className="space-y-1 rounded-xl bg-canvas p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt>Buyer gets back</dt>
            <dd className="font-semibold text-ink">{money(outcome.buyer_gets)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Seller is paid</dt>
            <dd className="font-semibold text-ink">{money(outcome.seller_gets)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-muted">
            <dt>Seller fee{decision === "partial" && refundMinor !== null ? ` on ${money(order.price - refundMinor)}` : ""}</dt>
            <dd>{money(outcome.seller_fee)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-muted">
            <dt>Buyer fee (kept)</dt>
            <dd>{money(outcome.buyer_fee_kept)}</dd>
          </div>
        </dl>
        {resale && decision !== "release" ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Whose strike is it?</legend>
            {faults.map(option => (
              <label key={option.value} className={cn("flex gap-3 rounded-xl border p-3", fault === option.value ? "border-2 border-ink" : "border-line")}>
                <input type="radio" name={`${id}-fault`} value={option.value} checked={fault === option.value} onChange={() => setFault(option.value)} className="mt-1 size-4 accent-ink" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{option.title}</span>
                  <span className="block text-xs text-muted">{option.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <Field label="Reason, shown to both" htmlFor={`${id}-note`} hint="At least 5 characters. Recorded in the activity log.">
          <Textarea id={`${id}-note`} rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
        <Button className="w-full" disabled={!ready} onClick={() => setConfirming(true)}>
          Decide
        </Button>
      </div>
      {confirming ? (
        <ActionDialog
          open
          requireReason={false}
          onClose={() => setConfirming(false)}
          title={`${decisions.find(option => option.value === decision)?.title} on ${order.number}?`}
          description={`The buyer gets back ${money(outcome.buyer_gets)} and the seller is paid ${money(outcome.seller_gets)}, at once. Both sides are told your reason.`}
          confirmLabel="Decide"
          tone={decision === "release" ? "primary" : "danger"}
          onConfirm={() => decide({ id: order.id, decision, note: note.trim(), ...(decision === "partial" && refundMinor !== null ? { refund: refundMinor } : {}), ...(resale && decision !== "release" ? { fault } : {}) }).unwrap()}
        />
      ) : null}
    </Card>
  );
}
