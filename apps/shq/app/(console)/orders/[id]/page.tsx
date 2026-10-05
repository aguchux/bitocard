"use client";

import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useParams } from "next/navigation";
import { Check, CheckCircle2, Copy, Eye, EyeOff, Printer, ReceiptText, RefreshCw, XCircle } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  categoryName,
  Dialog,
  ErrorState,
  errorMessage,
  formatDateTime,
  formatMoney,
  humanise,
  KeyValue,
  Notice,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import { bitocardApi } from "@bitocard/api-client";
import { type OrderDelivery, type OrderDetail, useOrderReceiptQuery, useResellerOrderQuery, useSimulateOrderMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** How often a processing order is checked while its page is open. */
const orderPollMs = 5000;

const deliveryNames: Record<OrderDelivery["kind"], string> = { gift_card: "Gift card", licence_key: "Licence key", token: "Token", confirmation: "Confirmation", virtual_number: "Phone number" };

/** A secret (code, PIN, token): masked until revealed, with a copy button. */
function Secret({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShown(true);
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
        <p className="break-all font-mono text-sm text-ink">{shown ? value : "•".repeat(Math.min(Math.max(value.length, 6), 16))}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={() => setShown(value => !value)} aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`} icon={shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}>
          {shown ? "Hide" : "Show"}
        </Button>
        <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`} icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Delivery({ delivery, index, count }: { delivery: OrderDelivery; index: number; count: number }) {
  const title = `${deliveryNames[delivery.kind]}${count > 1 ? ` ${index + 1}` : ""}`;
  const number = delivery.kind === "virtual_number" ? (delivery.details.number ?? delivery.serial) : null;
  const details = Object.entries(delivery.details).filter(([key]) => !(delivery.kind === "virtual_number" && key === "number"));
  return (
    <li className="space-y-3 rounded-xl border border-line p-4">
      <p className="font-semibold">{title}</p>
      {number ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Number</p>
          <p className="font-mono text-base font-semibold">{number}</p>
        </div>
      ) : null}
      {delivery.code ? <Secret label={delivery.kind === "token" ? "Token" : "Code"} value={delivery.code} /> : null}
      {delivery.pin ? <Secret label="PIN" value={delivery.pin} /> : null}
      {delivery.serial && !number ? (
        <p className="text-sm">
          <span className="text-muted">Serial </span>
          <span className="font-mono">{delivery.serial}</span>
        </p>
      ) : null}
      {details.length ? <KeyValue items={details.map(([key, value]) => ({ label: humanise(key), value }))} /> : null}
      {delivery.kind === "confirmation" && !delivery.code && !details.length ? <p className="text-sm text-muted">Delivered to the recipient. There is no code to pass on.</p> : null}
    </li>
  );
}

function ReceiptDialog({ order, open, onClose }: { order: OrderDetail; open: boolean; onClose: () => void }) {
  const { data: receipt, error, isLoading, refetch } = useOrderReceiptQuery(order.id, { skip: !open });
  const money = (amount: number) => (receipt ? formatMoney(amount, receipt.currency) : "");
  const registration = receipt ? Object.entries(receipt.seller).filter(([key]) => key !== "name" && key !== "registered_address") : [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={receipt ? `Receipt ${receipt.number}` : "Receipt"}
      footer={
        receipt ? (
          <Button variant="secondary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
            Print
          </Button>
        ) : null
      }
    >
      {error ? (
        <ErrorState message={errorMessage(error, "Could not load the receipt.")} onRetry={refetch} />
      ) : isLoading || !receipt ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold">{receipt.sold_through}</p>
            <p className="text-muted">{`Issued ${formatDateTime(receipt.issued_at)}`}</p>
            {receipt.customer_reference ? <p className="text-muted">{`Customer reference: ${receipt.customer_reference}`}</p> : null}
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {receipt.items.map(item => (
              <li key={item.description} className="flex justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  {item.description}
                  {item.quantity > 1 ? <span className="block text-xs text-muted">{`${item.quantity} × ${money(item.unit_price)}`}</span> : null}
                </span>
                <span className="font-semibold">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Subtotal</dt>
              <dd>{money(receipt.subtotal)}</dd>
            </div>
            {receipt.tax ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{`${receipt.tax.name ?? "Tax"} (${receipt.tax.rate_percent}%)`}</dt>
                <dd>{money(receipt.tax.amount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Total</dt>
              <dd>{money(receipt.total)}</dd>
            </div>
          </dl>
          <div className="rounded-xl bg-canvas px-4 py-3 text-xs text-muted">
            <p>
              Sold by <span className="font-semibold text-ink">{receipt.seller.name}</span>
            </p>
            {registration.map(([key, value]) => (
              <p key={key}>{`${humanise(key)}: ${value}`}</p>
            ))}
            <p>{receipt.seller.registered_address}</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { membership, mode } = useReseller();
  // While the supplier has not confirmed, look again every few seconds (paused while the tab is in the background).
  const [polling, setPolling] = useState(true);
  const { data: order, error, isLoading, isFetching, refetch } = useResellerOrderQuery(id, { pollingInterval: polling ? orderPollMs : 0, skipPollingIfUnfocused: true });
  const dispatch = useDispatch();
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!order) return;
    if (lastStatus.current === "processing" && order.status !== "processing") {
      // It settled while open: the wallet (hold captured or released) and the order lists changed too.
      dispatch(bitocardApi.util.invalidateTags(["Wallet", { type: "Order", id: "LIST" }]));
    }
    lastStatus.current = order.status;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling follows the fetched status
    setPolling(order.status === "processing");
  }, [order, dispatch]);
  const [simulate, simulateState] = useSimulateOrderMutation();
  const [outcome, setOutcome] = useState<"completed" | "failed" | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const title = order ? (order.receipt_number ?? `Order #${order.id.slice(0, 8)}`) : "Order";
  const money = (amount: number) => (order ? formatMoney(amount, order.currency) : "");
  const canSimulate = mode === "test" && order?.mode === "test" && order.status === "processing" && can(membership, "admin", "developer");
  const run = (value: "completed" | "failed") => {
    if (!order) return;
    setOutcome(value);
    void simulate({ id: order.id, outcome: value });
  };
  const recipient = order?.recipient ? Object.entries(order.recipient).filter(([, value]) => value) : [];

  return (
    <ShqShell section="orders" current="/orders" crumbs={[{ label: "Orders", href: "/orders" }, { label: title }]}>
      {error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load this order.")} onRetry={refetch} />
        </Card>
      ) : isLoading || !order ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading order">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-3">
                <span className="break-all">{title}</span>
                <StatusBadge status={order.status} />
                {order.mode === "test" ? <StatusBadge status="draft" label="Sandbox" /> : null}
              </span>
            }
            description={`${order.product.name} · placed ${formatDateTime(order.created_at)}`}
            actions={
              <>
                {order.status === "processing" ? (
                  <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={isFetching} onClick={refetch}>
                    Refresh
                  </Button>
                ) : null}
                {order.receipt_number ? (
                  <Button variant="secondary" icon={<ReceiptText className="size-4" aria-hidden />} onClick={() => setReceiptOpen(true)}>
                    Receipt
                  </Button>
                ) : null}
              </>
            }
          />

          {order.status === "processing" ? (
            <Notice tone="blue" title="Waiting for confirmation">
              The order has been sent and is not confirmed yet. Its cost is held from your wallet and taken only when it completes; if it fails, the hold is released.
            </Notice>
          ) : null}
          {order.status === "failed" ? (
            <Notice tone="red" title="Order failed">
              {order.failure_reason ?? "The order could not be fulfilled."} Nothing was taken from your wallet.
            </Notice>
          ) : null}
          {order.status === "refunded" ? <Notice tone="grey">This order was refunded to your wallet.</Notice> : null}

          {canSimulate ? (
            <Card className="p-5 sm:p-6">
              <p className="font-semibold">Sandbox outcome</p>
              <p className="mt-0.5 text-sm text-muted">Choose how this test order ends, to try your webhooks and screens.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button icon={<CheckCircle2 className="size-4" aria-hidden />} loading={simulateState.isLoading && outcome === "completed"} disabled={simulateState.isLoading} onClick={() => run("completed")}>
                  Complete it
                </Button>
                <Button variant="danger" icon={<XCircle className="size-4" aria-hidden />} loading={simulateState.isLoading && outcome === "failed"} disabled={simulateState.isLoading} onClick={() => run("failed")}>
                  Fail it
                </Button>
              </div>
              {simulateState.error ? (
                <div className="mt-4">
                  <Notice tone="red">{errorMessage(simulateState.error)}</Notice>
                </div>
              ) : null}
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Order" />
              <div className="p-5 sm:p-6">
                <KeyValue
                  items={[
                    { label: "Product", value: `${order.product.name} (${categoryName(order.product.category)})` },
                    { label: "Face value", value: `${formatMoney(order.face_value, order.face_currency)}${order.quantity > 1 ? ` × ${order.quantity}` : ""}` },
                    { label: "Customer reference", value: order.customer_reference ?? "—" },
                    {
                      label: "Recipient",
                      value: recipient.length ? (
                        <span className="block space-y-0.5">
                          {recipient.map(([key, value]) => (
                            <span key={key} className="block">{`${humanise(key)}: ${key === "transaction_type" ? humanise(String(value)) : value}`}</span>
                          ))}
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    { label: "Order ID", value: <span className="break-all font-mono text-xs">{order.id}</span> },
                    { label: "Completed", value: formatDateTime(order.completed_at) },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Money" description={order.currency} />
              <dl className="space-y-2 p-5 text-sm sm:p-6">
                {(order.source === "own"
                  ? [
                      ["Fulfilled by", `Your ${order.integration?.name ?? "supplier"} account`],
                      ["Customer price", money(order.price)],
                      ["Your cost and BitoCard’s fee", money(order.wholesale)],
                      ["BitoCard fee from your wallet", money(order.charged)],
                      ["Your profit", money(order.reseller_profit)],
                    ]
                  : [
                      ["Customer price", money(order.price)],
                      ["Wholesale", money(order.wholesale)],
                      ["Tax", money(order.tax)],
                      ["Charged to your wallet", money(order.charged)],
                      ["Your profit", money(order.reseller_profit)],
                    ]
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <Card>
            <CardHeader title="Delivered" description="Codes, PINs and tokens are secret. Pass them only to your customer." />
            <div className="p-5 sm:p-6">
              {order.deliveries.length ? (
                <ul className="space-y-3">
                  {order.deliveries.map((delivery, index) => (
                    <Delivery key={index} delivery={delivery} index={index} count={order.deliveries.length} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{order.status === "processing" ? "Nothing yet. Codes and tokens appear here once the order completes." : "Nothing was delivered."}</p>
              )}
            </div>
          </Card>

          {order.receipt_number ? <ReceiptDialog order={order} open={receiptOpen} onClose={() => setReceiptOpen(false)} /> : null}
        </>
      )}
    </ShqShell>
  );
}
