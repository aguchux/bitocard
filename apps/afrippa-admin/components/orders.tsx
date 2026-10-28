"use client";

import { Badge, DataTable, formatDateTime, formatMoney, type Column, type Tone } from "@bitocard/admin-ui";
import type { AdminP2pOrder, P2pOrderStatus } from "@bitocard/api-client/afrippa-admin";

export const orderStatus: Record<P2pOrderStatus, [string, Tone]> = {
  pending_payment: ["Waiting for payment", "amber"],
  paid: ["Paid, waiting for release", "blue"],
  appealed: ["Appealed", "red"],
  released: ["Released", "green"],
  cancelled: ["Cancelled", "grey"],
  returned: ["Returned to the seller", "grey"],
};

/** An order's status, an expired one told apart from one the buyer cancelled. */
export function OrderBadge({ order }: { order: Pick<AdminP2pOrder, "status" | "cancel_reason"> }) {
  const [label, tone] = order.status === "cancelled" && order.cancel_reason === "expired" ? ["Expired", "grey" as Tone] : orderStatus[order.status];
  return <Badge tone={tone}>{label}</Badge>;
}

const columns: Array<Column<AdminP2pOrder>> = [
  {
    key: "order",
    header: "Order",
    cell: order => (
      <span className="block min-w-0">
        <span className="block font-semibold text-ink">{order.number}</span>
        <span className="block text-xs text-muted">
          {order.amount} {order.asset} · {formatMoney(order.fiat, order.currency)}
        </span>
      </span>
    ),
  },
  {
    key: "parties",
    header: "Seller → buyer",
    cell: order => (
      <span className="text-sm">
        {order.seller.nickname} → {order.buyer.nickname}
      </span>
    ),
    hideOnMobile: true,
  },
  { key: "market", header: "Market", cell: order => (order.market === "WW" ? "Global" : order.market), hideOnMobile: true },
  { key: "status", header: "Status", cell: order => <OrderBadge order={order} /> },
  { key: "when", header: "Opened", cell: order => formatDateTime(order.created_at), hideOnMobile: true },
];

/** A list of orders, each opening its own page (with its room and, once appealed, the decision). */
export function OrdersTable({ orders, empty, onOpen }: { orders: AdminP2pOrder[]; empty: string; onOpen: (order: AdminP2pOrder) => void }) {
  return <DataTable columns={columns} rows={orders} rowKey={order => order.id} empty={empty} onRowClick={onOpen} />;
}
