"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { FileText } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, errorMessage, formatDateTime, formatMoney, KeyValue, Notice, PageHeader, QueryView, Skeleton, Textarea } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { apiFetch } from "@bitocard/api-client";
import { type AdminP2pOrder, type OrderRoomMessage, useDecideOrderMutation, useOrderRoomQuery, useP2pOrderQuery, useWriteInOrderRoomMutation } from "@bitocard/api-client/afrippa-admin";
import { OrderBadge } from "@/components/orders";
import { AfrippaShell } from "@/components/shell";

const who: Record<OrderRoomMessage["from"], string> = { buyer: "Buyer", seller: "Seller", afrippa: "Afrippa", system: "Order" };
const selectClass = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

/** Opens a file sent in the room: fetched with the admin's session (an `<a>` cannot), shown from memory. */
async function openFile(orderId: string, messageId: string) {
  const res = await apiFetch(`/v1/afrippa/admin/p2p/orders/${orderId}/files/${messageId}`);
  if (!res.ok) return;
  window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
}

/**
 * One order: both sides, the money, the seller's account while open, how the buyer says they paid, the room with its
 * evidence (Afrippa's team writes there as "Afrippa"), and, once appealed, the decision (operations, with step-up).
 */
export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const query = useP2pOrderQuery(id);
  return (
    <AfrippaShell section="orders" current="/orders" crumbs={[{ label: "Orders", href: "/orders" }, { label: query.data?.number ?? "Order" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {order => <OrderView order={order} />}
      </QueryView>
    </AfrippaShell>
  );
}

function OrderView({ order }: { order: AdminP2pOrder }) {
  const admin = useAdmin();
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState<"release" | "return">("release");
  const [fault, setFault] = useState<"buyer" | "seller" | "none">("seller");
  const [decide] = useDecideOrderMutation();
  const details = order.payment_method.details ? Object.entries(order.payment_method.details).filter(([key, value]) => key !== "kind" && value) : [];
  return (
    <>
      <PageHeader
        title={`${order.number}: ${order.amount} ${order.asset}`}
        description={`${order.seller.nickname} sells to ${order.buyer.nickname} for ${formatMoney(order.fiat, order.currency)} in ${order.market === "WW" ? "the global market" : order.market}.`}
        actions={order.status === "appealed" && can(admin, "operations") ? <Button onClick={() => setDeciding(true)}>Decide the appeal</Button> : null}
      />
      {order.mode === "test" ? <Notice tone="amber">Sandbox order: no real money or coins.</Notice> : null}
      {order.status === "appealed" ? (
        <Notice tone="red">
          The {order.appealed_by} appealed {order.appealed_at ? formatDateTime(order.appealed_at) : ""}: {order.appeal_reason}
        </Notice>
      ) : null}
      {order.warnings.includes("reversible_payment") ? <Notice tone="amber">The payment can be taken back by the payer after release (PayPal).</Notice> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="The order" actions={<OrderBadge order={order} />} />
          <div className="p-5 sm:p-6">
          <KeyValue
            items={[
              { label: "Price", value: `${formatMoney(order.price, order.currency)} per ${order.asset}` },
              { label: "Paid by the buyer", value: formatMoney(order.fiat, order.currency) },
              { label: "In escrow", value: `${order.escrow} ${order.asset} (seller's fee ${order.seller_fee})` },
              { label: "Buyer receives", value: `${order.received} ${order.asset} (buyer's fee ${order.buyer_fee})` },
              { label: "Pay by", value: formatDateTime(order.pay_by) },
              { label: "Paid", value: order.paid_at ? formatDateTime(order.paid_at) : "Not yet" },
              { label: "Payment must come from", value: order.payer_name },
              { label: "Buyer paid from", value: order.paid_from ? `${order.paid_from.label} ${order.paid_from.hint} (${order.paid_from.holder_name})` : "—" },
              ...(order.decision ? [{ label: "Decision", value: `Fault: ${order.decision.fault}. ${order.decision.note ?? ""}` }] : []),
              ...(order.closed_at ? [{ label: "Closed", value: `${formatDateTime(order.closed_at)}${order.cancel_reason ? ` (${order.cancel_reason})` : ""}` }] : []),
            ]}
          />
          </div>
        </Card>
        <Card>
          <CardHeader title="The seller's account" />
          <div className="p-5 sm:p-6">
          <KeyValue
            items={[
              { label: "Account", value: `${order.payment_method.label} ${order.payment_method.hint}` },
              { label: "In the name of", value: order.payment_method.holder_name },
              ...details.map(([key, value]) => ({ label: key.replace(/_/g, " "), value: String(value) })),
            ]}
          />
          {!details.length ? <p className="mt-3 text-xs text-muted">Its details are shown only while the order is open.</p> : null}
          </div>
        </Card>
      </div>
      <OrderRoom orderId={order.id} canWrite={can(admin, "operations", "support")} />
      <ActionDialog
        open={deciding}
        onClose={() => setDeciding(false)}
        title={`Decide ${order.number}`}
        description="Final: the coins go to the buyer (less their fee) or back to the seller. The side at fault gets a strike and a 24-hour cool-off. Both traders are told, with your note."
        confirmLabel={outcome === "release" ? "Release to the buyer" : "Return to the seller"}
        tone={outcome === "release" ? "primary" : "danger"}
        onConfirm={note => decide({ id: order.id, outcome, fault, note }).unwrap()}
      >
        <label className="block space-y-1 text-sm font-medium">
          The coins go
          <select
            className={selectClass}
            value={outcome}
            onChange={event => {
              const next = event.target.value as "release" | "return";
              setOutcome(next);
              // Releasing can only be the seller's fault, returning the buyer's (or nobody's either way).
              setFault(next === "release" ? "seller" : "buyer");
            }}
          >
            <option value="release">To the buyer: they paid</option>
            <option value="return">Back to the seller: the buyer did not pay</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Whose fault
          <select className={selectClass} value={fault} onChange={event => setFault(event.target.value as "buyer" | "seller" | "none")}>
            {outcome === "release" ? <option value="seller">The seller&apos;s (a strike for them)</option> : <option value="buyer">The buyer&apos;s (a strike for them)</option>}
            <option value="none">Nobody&apos;s</option>
          </select>
        </label>
      </ActionDialog>
    </>
  );
}

/** The order's room: every message and file, and (support and operations, open orders) writing as "Afrippa". */
function OrderRoom({ orderId, canWrite }: { orderId: string; canWrite: boolean }) {
  const room = useOrderRoomQuery(orderId, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
  const [write, writing] = useWriteInOrderRoomMutation();
  const [body, setBody] = useState("");
  return (
    <Card className="mt-4">
      <CardHeader title="Order room" />
      <QueryView query={room} loading={<Skeleton className="h-48" />}>
        {data => (
          <div className="space-y-3 p-5 sm:p-6">
            <ol className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl bg-canvas p-3">
              {data.data.map(message =>
                message.from === "system" ? (
                  <li key={message.id} className="text-center text-xs text-muted">
                    {message.body} · {formatDateTime(message.created_at)}
                  </li>
                ) : (
                  <li key={message.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${message.from === "afrippa" ? "ml-auto bg-navy-900 text-white" : "bg-white ring-1 ring-line"}`}>
                    <p className="text-xs font-semibold opacity-75">
                      {who[message.from]} · {formatDateTime(message.created_at)}
                    </p>
                    {message.file ? (
                      <button type="button" onClick={() => void openFile(orderId, message.id)} className="mt-1 inline-flex items-center gap-1.5 font-semibold underline">
                        <FileText className="size-4" aria-hidden /> {message.file.name}
                      </button>
                    ) : null}
                    {message.body ? <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p> : null}
                  </li>
                ),
              )}
            </ol>
            {canWrite && data.open ? (
              <form
                className="space-y-2"
                onSubmit={async event => {
                  event.preventDefault();
                  if (!body.trim()) return;
                  await write({ id: orderId, body: body.trim() }).unwrap();
                  setBody("");
                }}
              >
                {writing.error ? <Notice tone="red">{errorMessage(writing.error)}</Notice> : null}
                <Textarea aria-label="Write in the room as Afrippa" rows={2} value={body} onChange={event => setBody(event.target.value)} placeholder="Write to both traders as Afrippa" />
                <Button type="submit" loading={writing.isLoading}>
                  Send as Afrippa
                </Button>
              </form>
            ) : null}
            {!data.open ? <p className="text-xs text-muted">The order is closed: its room is read-only.</p> : null}
          </div>
        )}
      </QueryView>
    </Card>
  );
}
