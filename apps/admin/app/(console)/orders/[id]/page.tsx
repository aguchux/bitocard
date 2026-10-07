"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Plus, RefreshCw, Trash2, Undo2, XCircle } from "lucide-react";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
  categoryName,
  DataTable,
  ErrorState,
  errorMessage,
  Field,
  formatDateTime,
  formatMoney,
  formatRelative,
  humanise,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  RefreshFailed,
  Select,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useOrderQuery, useRefundOrderMutation, useRequeryOrderMutation, useResolveOrderMutation } from "@bitocard/api-client/admin";

type Delivery = { kind: "gift_card" | "licence_key" | "token" | "confirmation" | "virtual_number"; code: string; pin: string; serial: string };
const emptyDelivery = (): Delivery => ({ kind: "gift_card", code: "", pin: "", serial: "" });

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const { data: order, error, isFetching, refetch } = useOrderQuery(id);
  const [requery, requeryState] = useRequeryOrderMutation();
  const [resolve] = useResolveOrderMutation();
  const [refund] = useRefundOrderMutation();
  const [dialog, setDialog] = useState<"complete" | "fail" | "refund" | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [supplierRefunded, setSupplierRefunded] = useState(false);

  const title = order ? (order.receipt_number ?? `Order #${order.id.slice(0, 8)}`) : "Order";
  const money = (amount: number) => (order ? formatMoney(amount, order.currency) : "");
  const setDelivery = (index: number, change: Partial<Delivery>) => setDeliveries(rows => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <AdminShell section="orders" current={order?.needs_review ? "/orders/review" : "/orders"} crumbs={[{ label: "Orders", href: "/orders" }, { label: title }]}>
      {!order && error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load this order.")} onRetry={refetch} />
        </Card>
      ) : !order ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          {error && !isFetching ? <RefreshFailed message={errorMessage(error, "Could not refresh this order.")} onRetry={refetch} /> : null}
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-3">
                {title}
                <StatusBadge status={order.needs_review ? "needs_review" : order.status} />
                {order.mode === "test" ? <StatusBadge status="draft" label="Sandbox" /> : null}
              </span>
            }
            description={`${order.product.name} · placed ${formatDateTime(order.created_at)}`}
            actions={
              <>
                {order.status === "processing" && can(admin, "operations", "support") ? (
                  <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={requeryState.isLoading} onClick={() => requery(order.id)}>
                    Check with supplier
                  </Button>
                ) : null}
                {order.status === "processing" && can(admin, "operations") ? (
                  <>
                    <Button
                      icon={<CheckCircle2 className="size-4" aria-hidden />}
                      onClick={() => {
                        setDeliveries(order.product.category === "gift_cards" ? [emptyDelivery()] : []);
                        setDialog("complete");
                      }}
                    >
                      Mark delivered
                    </Button>
                    <Button variant="danger" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setDialog("fail")}>
                      Mark failed
                    </Button>
                  </>
                ) : null}
                {order.status === "completed" && can(admin, "finance") ? (
                  <Button variant="secondary" icon={<Undo2 className="size-4" aria-hidden />} onClick={() => setDialog("refund")}>
                    Refund
                  </Button>
                ) : null}
              </>
            }
          />
          {requeryState.error ? <Notice tone="red">{errorMessage(requeryState.error)}</Notice> : null}
          {order.needs_review ? (
            <Notice tone="amber" title="In the exception queue">
              The supplier has not confirmed this order after every scheduled check. Confirm the outcome with {order.supplier.code} directly, then mark it delivered or
              failed. It is still checked every 6 hours.
            </Notice>
          ) : null}
          {order.failure_reason ? <Notice tone="red">{order.failure_reason}</Notice> : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Order" />
              <div className="p-5 sm:p-6">
                <KeyValue
                  items={[
                    { label: "Product", value: `${order.product.name} (${categoryName(order.product.category)})` },
                    { label: "Face value", value: `${formatMoney(order.face_value, order.face_currency)}${order.quantity > 1 ? ` × ${order.quantity}` : ""}` },
                    {
                      label: "Reseller",
                      value: (
                        <AppLink href={`/resellers/${order.reseller_id}`} className="font-medium text-blue-600 hover:underline">
                          View reseller
                        </AppLink>
                      ),
                    },
                    { label: "Customer reference", value: order.customer_reference ?? "—" },
                    ...(order.checkout
                      ? [
                          {
                            label: "Store checkout",
                            value: `${humanise(order.checkout.status)}: ${formatMoney(order.checkout.amount, order.checkout.currency)} through ${order.checkout.own_gateway ? `the reseller's own ${order.checkout.gateway}` : order.checkout.gateway}${order.checkout.refund_attempts ? ` (${order.checkout.refund_attempts} refund attempts)` : ""}`,
                          },
                        ]
                      : []),
                    { label: "Recipient", value: order.recipient ? Object.entries(order.recipient).map(([key, value]) => `${humanise(key)}: ${value}`).join(", ") : "—" },
                    { label: "Completed", value: formatDateTime(order.completed_at) },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Money" description={order.currency} />
              <dl className="space-y-2 p-5 text-sm sm:p-6">
                {[
                  ["Customer price", money(order.price)],
                  ["Wholesale (reseller pays)", money(order.wholesale)],
                  ["Tax", money(order.tax)],
                  ["Charged to wallet", money(order.charged)],
                  ["Reseller profit", money(order.reseller_profit)],
                  ["Supplier cost", formatMoney(order.supplier.cost, order.supplier.currency)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Supplier attempts"
              description={`${order.supplier.code} · reference ${order.supplier.reference}${order.next_check_at ? ` · next check ${formatRelative(order.next_check_at)}` : ""}`}
            />
            <div className="mt-4">
              <DataTable
                caption="Supplier attempts"
                rows={order.attempts}
                rowKey={attempt => `${attempt.reference}-${attempt.at}`}
                empty="No supplier calls yet."
                columns={[
                  { key: "when", header: "When", cell: attempt => formatDateTime(attempt.at) },
                  { key: "supplier", header: "Supplier", cell: attempt => attempt.supplier },
                  { key: "action", header: "Call", cell: attempt => (attempt.action === "place" ? "Place order" : "Status check") },
                  { key: "outcome", header: "Outcome", cell: attempt => <StatusBadge status={attempt.outcome === "pending" ? "processing" : attempt.outcome} /> },
                  { key: "detail", header: "Detail", cell: attempt => <span className="text-sm text-muted">{attempt.detail ?? "—"}</span>, hideOnMobile: true },
                ]}
              />
            </div>
          </Card>

          {order.notifications.length ? (
            <Card>
              <CardHeader title="Supplier notifications" description="What the supplier told us about this order. Each one made BitoCard re-check the order with the supplier." />
              <div className="mt-4">
                <DataTable
                  caption="Supplier notifications"
                  rows={order.notifications}
                  rowKey={item => item.id}
                  empty="No notifications."
                  columns={[
                    { key: "when", header: "Received", cell: item => formatDateTime(item.received_at) },
                    { key: "supplier", header: "Supplier", cell: item => item.supplier },
                    { key: "event", header: "Event", cell: item => <span className="font-mono text-xs">{item.event_type ?? "—"}</span>, hideOnMobile: true },
                    { key: "status", header: "Status", cell: item => <StatusBadge status={item.status} /> },
                  ]}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Ledger" description="Every money movement for this order (amounts in minor units; positive is a debit)." />
            <div className="space-y-4 p-5 sm:p-6">
              {order.ledger.length ? (
                order.ledger.map(entry => (
                  <div key={entry.reference} className="rounded-xl border border-line">
                    <p className="flex flex-wrap justify-between gap-2 border-b border-line bg-canvas px-4 py-2 text-sm">
                      <span className="font-semibold">{humanise(entry.type)}</span>
                      <span className="text-muted">{formatDateTime(entry.at)}</span>
                    </p>
                    <ul className="divide-y divide-line text-sm">
                      {entry.postings.map((posting, index) => (
                        <li key={index} className="flex justify-between gap-3 px-4 py-2">
                          <span className="min-w-0 truncate">
                            {humanise(posting.account)} <span className="text-xs text-muted">{posting.owner}</span>
                          </span>
                          <span className={posting.amount < 0 ? "text-red-600" : "text-emerald-700"}>{`${posting.amount} ${posting.currency}`}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">No ledger entries.</p>
              )}
            </div>
          </Card>

          <ActionDialog
            open={dialog === "complete"}
            onClose={() => setDialog(null)}
            title="Mark this order delivered?"
            description="Only after the supplier confirmed delivery. The held amount is taken from the reseller wallet and a receipt is issued."
            confirmLabel="Mark delivered"
            onConfirm={reason =>
              resolve({
                id: order.id,
                outcome: "completed",
                reason,
                deliveries: deliveries
                  .filter(row => row.code || row.pin || row.serial || row.kind === "confirmation")
                  .map(row => ({ kind: row.kind, ...(row.code ? { code: row.code } : {}), ...(row.pin ? { pin: row.pin } : {}), ...(row.serial ? { serial: row.serial } : {}) })),
              }).unwrap()
            }
          >
            <div className="space-y-3">
              <p className="text-sm font-semibold">What the supplier delivered</p>
              {deliveries.map((row, index) => (
                <div key={index} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
                  <Field label="Kind" htmlFor={`kind-${index}`}>
                    <Select id={`kind-${index}`} value={row.kind} onChange={event => setDelivery(index, { kind: event.target.value as Delivery["kind"] })}>
                      <option value="gift_card">Gift card</option>
                      <option value="licence_key">Licence key</option>
                      <option value="token">Token</option>
                      <option value="virtual_number">Phone number</option>
                      <option value="confirmation">Confirmation only</option>
                    </Select>
                  </Field>
                  <Field label="Code or token" htmlFor={`code-${index}`}>
                    <Input id={`code-${index}`} value={row.code} onChange={event => setDelivery(index, { code: event.target.value })} autoComplete="off" />
                  </Field>
                  <Field label="PIN" htmlFor={`pin-${index}`}>
                    <Input id={`pin-${index}`} value={row.pin} onChange={event => setDelivery(index, { pin: event.target.value })} autoComplete="off" />
                  </Field>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={row.kind === "virtual_number" ? "Phone number" : "Serial"} htmlFor={`serial-${index}`}>
                        <Input id={`serial-${index}`} value={row.serial} onChange={event => setDelivery(index, { serial: event.target.value })} autoComplete="off" />
                      </Field>
                    </div>
                    <Button variant="ghost" aria-label="Remove this item" onClick={() => setDeliveries(rows => rows.filter((_, i) => i !== index))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setDeliveries(rows => [...rows, emptyDelivery()])}>
                Add an item
              </Button>
              <p className="text-xs text-muted">Codes are encrypted and shown only to the reseller on this order.</p>
            </div>
          </ActionDialog>

          <ActionDialog
            open={dialog === "fail"}
            onClose={() => setDialog(null)}
            title="Mark this order failed?"
            description="Only after the supplier confirmed it was not delivered. The held amount goes back to the reseller wallet. No other supplier is tried."
            confirmLabel="Mark failed"
            tone="danger"
            onConfirm={reason => resolve({ id: order.id, outcome: "failed", reason }).unwrap()}
          />

          <ActionDialog
            open={dialog === "refund"}
            onClose={() => setDialog(null)}
            title="Refund this order?"
            description={
              order.checkout?.own_gateway
                ? `${money(order.charged)} goes back to the reseller wallet, and the customer is refunded ${formatMoney(order.checkout.amount, order.checkout.currency)} in full from the reseller's own ${order.checkout.gateway} account.`
                : order.checkout
                  ? `The sale is reversed (the store's margin taken back from its earnings) and the customer is refunded ${formatMoney(order.checkout.amount, order.checkout.currency)} in full through ${order.checkout.gateway}.`
                  : `${money(order.charged)} goes back to the reseller wallet as topped-up funds.`
            }
            confirmLabel="Refund"
            tone="danger"
            onConfirm={reason => refund({ id: order.id, reason, supplier_refunded: supplierRefunded }).unwrap()}
          >
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-brand-500" checked={supplierRefunded} onChange={event => setSupplierRefunded(event.target.checked)} />
              <span>
                The supplier refunded BitoCard too
                <span className="block text-xs text-muted">The supplier cost is reversed in the ledger as well.</span>
              </span>
            </label>
          </ActionDialog>
        </>
      )}
    </AdminShell>
  );
}
