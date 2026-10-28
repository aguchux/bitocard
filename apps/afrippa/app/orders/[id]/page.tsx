import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatCrypto, formatFace } from "@bitocard/api-client/storefront";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { OrderBadge } from "@/components/order-badge";
import { AppealForm, AutoRefresh, CancelForm, MarkPaidForm, OrderRoom, ReleaseForm, TimeLeft } from "@/components/orders";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { openStatuses, type Order, type OrderMessages, type PaymentMethod, shownDetails } from "@/lib/orders-types";

export const metadata: Metadata = { title: "Order", robots: { index: false, follow: false } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One order, from the viewer's side: what to do now (pay and mark paid, or check and release; cancel or appeal), the
 * seller's account while the order is open (the only place its details are ever shown), and the order room.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCustomer(`/orders/${id}`);
  const result = uuid.test(id) ? await customerApi<Order>("GET", `/v1/afrippa/p2p/orders/${id}`) : null;
  if (!result?.ok)
    return (
      <AccountShell title="Order" current="/orders">
        <p className={cardClass}>
          {result && result.status !== 404 ? result.message : "No such order."}{" "}
          <Link href="/orders" className="font-semibold text-brand-700 underline">
            Your orders
          </Link>
        </p>
      </AccountShell>
    );
  const order = result.data;
  const open = openStatuses.includes(order.status);
  const buyer = order.side === "buy";
  const [room, own] = await Promise.all([
    customerApi<OrderMessages>("GET", `/v1/afrippa/p2p/orders/${id}/messages`),
    buyer && order.status === "pending_payment" ? customerApi<{ data: PaymentMethod[] }>("GET", "/v1/afrippa/p2p/payment-methods") : null,
  ]);
  // The buyer pays from their own account in the order's currency, of the same kind as the seller's.
  const payFrom = (own?.ok ? own.data.data : []).filter(method => method.usable && method.currency === order.currency && method.kind === order.payment_method.kind);
  const counterparty = buyer ? order.seller.nickname : order.buyer.nickname;

  return (
    <AccountShell title={`Order ${order.number}`} current="/orders">
      {open ? <AutoRefresh /> : null}
      <section className={`${cardClass} space-y-3`} aria-label="The order">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">
            {buyer ? "Buying" : "Selling"} {formatCrypto(order.amount, order.asset)} {buyer ? "from" : "to"}{" "}
            <Link href={`/trader/${counterparty}`} className="text-brand-700 hover:underline">
              {counterparty}
            </Link>
          </p>
          <OrderBadge order={order} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{buyer ? "You pay" : "You are paid"}</dt>
          <dd className="text-right font-semibold">{formatFace(order.fiat, order.currency)}</dd>
          <dt className="text-slate-500">Price</dt>
          <dd className="text-right">
            {formatFace(order.price, order.currency)} per {order.asset}
          </dd>
          <dt className="text-slate-500">{buyer ? "You receive" : "In escrow (with Afrippa’s fee)"}</dt>
          <dd className="text-right font-semibold">{formatCrypto(buyer ? order.received : order.escrow, order.asset)}</dd>
          <dt className="text-slate-500">Opened</dt>
          <dd className="text-right">{tradeDate(order.created_at)}</dd>
        </dl>
        {order.mode === "test" ? <p className="text-xs font-semibold text-amber-700">Sandbox order: no real money or coins.</p> : null}
      </section>

      <Step order={order} payFrom={payFrom} />

      {open && order.status !== "pending_payment" && order.status !== "appealed" ? (
        <AppealForm id={order.id} />
      ) : null}

      {room.ok ? <OrderRoom orderId={order.id} initial={room.data.data} open={room.data.open} /> : <p className={cardClass}>The order room cannot be shown right now.</p>}
    </AccountShell>
  );
}

/** What the viewer does now, by side and status. */
function Step({ order, payFrom }: { order: Order; payFrom: PaymentMethod[] }) {
  const buyer = order.side === "buy";
  const details = order.payment_method.details ? shownDetails(order.payment_method.details) : [];
  const account = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-slate-50 p-4 text-sm">
      {details.map(([name, value]) => (
        <Row key={name} name={name} value={value} />
      ))}
      <Row name="Account name" value={order.payment_method.holder_name} />
      <Row name="Amount" value={formatFace(order.fiat, order.currency)} />
    </dl>
  );
  switch (order.status) {
    case "pending_payment":
      return buyer ? (
        <Card title="Pay the seller">
          <p className="text-sm text-slate-600">
            Send exactly {formatFace(order.fiat, order.currency)} to this account from an account in your own name, <strong>{order.payer_name}</strong>. Time left: <TimeLeft until={order.pay_by} />.
          </p>
          {account}
          <p className="text-sm text-slate-600">Then tell the seller you paid. Never mark it paid before the money has left your account.</p>
          <MarkPaidForm id={order.id} methods={payFrom.map(method => ({ id: method.id, label: method.label, hint: method.hint }))} />
          <CancelForm id={order.id} />
        </Card>
      ) : (
        <Card title="Waiting for the buyer to pay">
          <p className="text-sm text-slate-600">
            {order.buyer.nickname} pays {formatFace(order.fiat, order.currency)} into your {order.payment_method.label} {order.payment_method.hint} from an account named <strong>{order.payer_name}</strong>. Time left: <TimeLeft until={order.pay_by} />. Unpaid, the order ends and your coins come back.
          </p>
        </Card>
      );
    case "paid":
      return buyer ? (
        <Card title="Waiting for the seller to release">
          <p className="text-sm text-slate-600">You marked it paid. The seller checks their account and releases the coins to you. If they do not, appeal and Afrippa&apos;s team decides.</p>
        </Card>
      ) : (
        <Card title="Check your account, then release">
          <p className="text-sm text-slate-600">
            {order.buyer.nickname} says they paid {formatFace(order.fiat, order.currency)}
            {order.paid_from ? ` from ${order.paid_from.label} ${order.paid_from.hint} in the name ${order.paid_from.holder_name}` : ""}. Open your own banking app: a screenshot or a message is not proof.
          </p>
          <ReleaseForm id={order.id} payerName={order.payer_name} warning={order.warnings.includes("reversible_payment")} />
        </Card>
      );
    case "appealed":
      return (
        <Card title="Afrippa’s team is deciding">
          <p className="text-sm text-slate-600">
            {order.appealed_by === (buyer ? "buyer" : "seller") ? "You" : "The other trader"} appealed: {order.appeal_reason}. The coins stay in escrow. Send any proof in the order room.
          </p>
        </Card>
      );
    case "released":
      return (
        <Card title="Completed">
          <p className="text-sm text-slate-600">
            {buyer ? `${formatCrypto(order.received, order.asset)} is in your wallet.` : "The coins were released to the buyer."}
            {order.decision ? " Afrippa’s team decided the appeal." : ""}
          </p>
        </Card>
      );
    case "returned":
      return (
        <Card title="Returned to the seller">
          <p className="text-sm text-slate-600">Afrippa&apos;s team decided the appeal: the coins went back to the seller.</p>
        </Card>
      );
    default:
      return (
        <Card title={order.cancel_reason === "expired" ? "Expired" : "Cancelled"}>
          <p className="text-sm text-slate-600">{order.cancel_reason === "expired" ? "The order was not paid in time." : "The buyer cancelled the order."} The coins went back to the seller.</p>
        </Card>
      );
  }
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} space-y-3`} aria-label={title}>
      <h2 className="font-display text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{name}</dt>
      <dd className="font-semibold break-all select-all">{value}</dd>
    </>
  );
}
