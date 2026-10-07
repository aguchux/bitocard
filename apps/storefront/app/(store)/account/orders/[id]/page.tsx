import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ExternalLink, KeyRound } from "lucide-react";
import { formatFace, formatPrice, type StoreCheckout } from "@bitocard/api-client/storefront";
import { RefreshWhile, StatusPill } from "@/components/store/order-status";
import { currentCustomer, customerApi } from "@/lib/customer";
import { simulateCheckout } from "../../actions";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

const detailLabels: Record<string, string> = { duration: "Licence term", expires_at: "Expires", redemption_url: "Redeem at", number: "Number" };

/** One order: its status, the codes once delivered, and the payment page while it is waiting for payment. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/orders/${id}`)}`);
  const result = await customerApi<StoreCheckout>("GET", `/v1/store/checkouts/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const order = result.data;
  const waiting = order.status === "awaiting_payment" || order.status === "paid" || order.status === "refund_pending";
  const deliveries = order.order?.deliveries ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-6 py-6 sm:py-10">
      <RefreshWhile active={waiting && !(order.mode === "test" && order.status === "awaiting_payment")} />
      <Link href="/account" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Your orders
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#070f4c] sm:text-3xl">
            {order.quantity > 1 ? `${order.quantity} × ` : ""}
            {order.product.name}
          </h1>
          <p className="mt-1 text-slate-600">
            {formatFace(order.face_value, order.face_currency)} each · {order.status === "awaiting_payment" || order.status === "failed" ? "price" : "paid"} {formatPrice(order.amount, order.currency)} with {order.method.label.toLowerCase()}
            {order.order?.receipt_number ? ` · Receipt ${order.order.receipt_number}` : ""}
          </p>
        </div>
        <StatusPill status={order.status} />
      </div>

      {order.mode === "test" ? (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">This is a test order: no money moves and the codes are not real.</p>
      ) : null}

      {order.status === "awaiting_payment" ? (
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          {order.mode === "test" ? (
            <>
              <p className="font-semibold">Simulate the payment</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {[
                  { outcome: "succeeded", order: "completed", label: "Pay: order delivered" },
                  { outcome: "succeeded", order: "failed", label: "Pay: order fails (refund)" },
                  { outcome: "failed", order: "", label: "Payment fails" },
                ].map(choice => (
                  <form key={choice.label} action={simulateCheckout}>
                    <input type="hidden" name="id" value={order.id} />
                    <input type="hidden" name="outcome" value={choice.outcome} />
                    <input type="hidden" name="order" value={choice.order} />
                    <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold hover:border-slate-300">
                      {choice.label}
                    </button>
                  </form>
                ))}
              </div>
            </>
          ) : order.checkout_url ? (
            <>
              <p className="text-slate-700">We have not received your payment yet. If you have paid, this page updates by itself.</p>
              <a href={order.checkout_url} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d]">
                Go to the payment page <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </>
          ) : null}
        </section>
      ) : null}

      {order.status === "paid" ? <p className="rounded-2xl bg-blue-50 p-4 text-blue-900">Payment received. We are preparing your order; this usually takes a few seconds.</p> : null}
      {order.failure_reason && order.status !== "completed" ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-700">{order.failure_reason}</p> : null}
      {order.status === "refunded" ? (
        <p className="rounded-2xl bg-slate-50 p-4 text-slate-700">
          {formatPrice(order.amount, order.currency)} was refunded to how you paid. Banks and mobile money providers can take a few days to show it.
        </p>
      ) : null}

      {deliveries.length ? (
        <section aria-labelledby="codes" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 id="codes" className="font-display flex items-center gap-2 text-xl font-bold">
            <KeyRound className="size-5 text-[#ff2382]" aria-hidden="true" /> Your {deliveries.length > 1 ? "codes" : "code"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">Keep these safe: anyone with a code can use it.</p>
          <ul className="mt-4 space-y-3">
            {deliveries.map((delivery, index) => (
              <li key={index} className="rounded-2xl border border-slate-200 p-4">
                {delivery.code ? <p className="font-mono text-lg font-bold break-all">{delivery.code}</p> : null}
                {delivery.pin ? <p className="mt-1 text-sm">PIN: <strong className="font-mono">{delivery.pin}</strong></p> : null}
                {delivery.serial ? <p className="mt-1 text-sm text-slate-600">Serial: {delivery.serial}</p> : null}
                {Object.entries(delivery.details)
                  .filter(([key]) => detailLabels[key])
                  .map(([key, value]) => (
                    <p key={key} className="mt-1 text-sm text-slate-600">
                      {detailLabels[key]}: {value}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
          {order.order?.redeem_instructions ? <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{order.order.redeem_instructions}</p> : null}
        </section>
      ) : order.status === "completed" ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">Delivered{order.recipient?.phone ? ` to ${order.recipient.phone}` : order.recipient?.account_number ? ` to ${order.recipient.account_number}` : ""}.</p>
      ) : null}
    </div>
  );
}
