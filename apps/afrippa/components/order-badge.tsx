import { statusText, type Order } from "@/lib/orders-types";

const tones = {
  act: "bg-brand-50 text-brand-700",
  wait: "bg-amber-50 text-amber-800",
  alert: "bg-red-50 text-red-800",
  done: "bg-emerald-50 text-emerald-800",
  closed: "bg-slate-100 text-slate-700",
};

/** An order's status from the viewer's side: what they must do now is in the accent colour. */
export function OrderBadge({ order }: { order: Pick<Order, "status" | "side" | "cancel_reason"> }) {
  const [label, tone] = statusText(order);
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>{label}</span>;
}
