"use client";

import { useParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ActionDialog, amountToMinor, Badge, Button, Card, CardHeader, cn, errorMessage, Field, formatDateTime, formatMoney, Input, KeyValue, Notice, PageHeader, QueryView, Select, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedOrderDetail, type ClassifiedDisputeDecision, useClassifiedOrderQuery, useDecideClassifiedDisputeMutation, useDecideClassifiedPayoutReviewMutation, useWriteClassifiedDisputeMutation } from "@bitocard/api-client/admin";
import { disputeReasonLabels, ListingCell, OrderStatus, PersonCell, PrivatePhoto, payoutReviewLabels, payoutReviewTones } from "@/components/classifieds";

const decisionLabels: Record<ClassifiedDisputeDecision, string> = {
  release: "Release to the seller (both fees kept)",
  refund: "Refund the buyer in full (price and their fee)",
  partial: "Part refund (the rest to the seller, less their fee on it)",
};

const authorLabels = { buyer: "Buyer", seller: "Seller", bitocard: "BitoCard" } as const;

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
  const [deciding, setDeciding] = useState(false);
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
        description={`${order.country} · ${order.fulfilment === "meet_up" ? "Meet-up" : "Delivery"}${order.mode === "test" ? " · test" : ""}`}
        actions={
          <span className="flex flex-wrap gap-2">
            {order.dispute?.status === "open" && decides ? <Button onClick={() => setDeciding(true)}>Decide the dispute</Button> : null}
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
                  { label: "Price", value: money(order.price) },
                  { label: "Buyer's fee", value: money(order.buyer_fee) },
                  { label: "Buyer paid", value: money(order.total) },
                  { label: "Seller's fee", value: money(order.seller_fee) },
                  { label: "Seller's payout", value: money(order.payout) },
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
                  { label: "Asked", value: formatDateTime(order.timeline.requested_at) },
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
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Seller</p>
                <PersonCell person={order.seller} />
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Hand-over" />
            <div className="px-5 pb-5 text-sm sm:px-6">
              <KeyValue
                items={[
                  { label: "Delivery address", value: order.delivery_address ?? "—" },
                  { label: "Tracking", value: order.tracking_note ?? "—" },
                  { label: "Release code tries left", value: order.release_tries_left === null ? "—" : String(order.release_tries_left) },
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
      {deciding && order.dispute ? <DecideDialog order={order} finance={finance} onClose={() => setDeciding(false)} /> : null}
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
          </Notice>
        ) : null}
        <ol className="space-y-3">
          {dispute.messages.map(message => (
            <li key={message.id} className={cn("rounded-xl border px-4 py-3 text-sm", message.from === "bitocard" ? "border-brand-200 bg-brand-50" : "border-line bg-white")}>
              <p className="text-xs font-semibold text-muted">
                {authorLabels[message.from]} · {formatDateTime(message.created_at)}
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

function DecideDialog({ order, finance, onClose }: { order: AdminClassifiedOrderDetail; finance: boolean; onClose: () => void }) {
  const id = useId();
  const [decision, setDecision] = useState<ClassifiedDisputeDecision>("release");
  const [refund, setRefund] = useState("");
  const [decide] = useDecideClassifiedDisputeMutation();
  const refundMinor = amountToMinor(refund);
  const options = (["release", "refund", "partial"] as const).filter(value => value === "release" || finance);

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Decide the dispute on ${order.number}`}
      description={`The price is ${formatMoney(order.price, order.currency)}. The money moves at once and both sides are told your note. ${finance ? "" : "Refunds are decided by finance."}`}
      confirmLabel="Decide"
      tone={decision === "release" ? "primary" : "danger"}
      onConfirm={note => {
        if (decision === "partial" && (refundMinor === null || refundMinor <= 0 || refundMinor >= order.price)) return Promise.reject(new Error(`A part refund is more than nothing and less than ${formatMoney(order.price, order.currency)}.`));
        return decide({ id: order.id, decision, note, ...(decision === "partial" && refundMinor !== null ? { refund: refundMinor } : {}) }).unwrap();
      }}
    >
      <Field label="Decision" htmlFor={`${id}-decision`}>
        <Select id={`${id}-decision`} value={decision} onChange={event => setDecision(event.target.value as ClassifiedDisputeDecision)}>
          {options.map(value => (
            <option key={value} value={value}>
              {decisionLabels[value]}
            </option>
          ))}
        </Select>
      </Field>
      {decision === "partial" ? (
        <Field label={`Refund to the buyer (${order.currency})`} htmlFor={`${id}-refund`} hint="Less than the price. The buyer's fee is not refunded on a part refund.">
          <Input id={`${id}-refund`} inputMode="decimal" value={refund} onChange={event => setRefund(event.target.value)} placeholder="e.g. 25000" />
        </Field>
      ) : null}
    </ActionDialog>
  );
}
