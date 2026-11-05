import { shopMoney, type ShopBuyOrder, type ShopBuyOrderAction, type ShopBuyOrderStatus } from "@bitocard/api-client/classifieds";
import type { ConfirmOptions } from "@/components/confirm-dialog";

/**
 * Buy orders on udozo.com (docs/UDOZO_RATINGS_PLAN.md phase 0), kept apart from React so they are tested: each status's
 * colour, what to do next, and the question asked before each step.
 */

export function buyOrderTone(status: ShopBuyOrderStatus) {
  if (status === "accepted" || status === "completed") return "bg-emerald-50 text-emerald-800";
  if (status === "requested" || status === "countered") return "bg-amber-50 text-amber-800";
  if (status === "voided" || status === "no_show") return "bg-red-50 text-red-800";
  return "bg-slate-100 text-slate-700";
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: "Africa/Lagos" });

/** One line under an order in the lists: what happens next, and by when. */
export function buyOrderNext(order: Pick<ShopBuyOrder, "status" | "role" | "respond_by" | "meet_by" | "bought_at" | "completes_at" | "void_until" | "with">) {
  const seller = order.role === "seller";
  switch (order.status) {
    case "requested":
      return seller ? `Accept, offer another price or decline${order.respond_by ? ` by ${date(order.respond_by)}` : ""}.` : `Waiting for ${order.with.name} to answer.`;
    case "countered":
      return seller ? `Waiting for ${order.with.name} to answer your price.` : `Accept their price or cancel${order.respond_by ? ` by ${date(order.respond_by)}` : ""}.`;
    case "accepted":
      if (order.bought_at) return seller ? `${order.with.name} says they bought it: mark it sold to confirm.` : `Waiting for ${order.with.name} to confirm${order.completes_at ? `, or recorded by itself on ${date(order.completes_at)}` : ""}.`;
      return `Meet${order.meet_by ? ` by ${date(order.meet_by)}` : ""}: inspect it, then pay in person.${seller ? " Mark it sold once they have bought it." : ""}`;
    case "completed":
      return order.void_until && !seller ? `Recorded. Did not buy it? Say so by ${date(order.void_until)}.` : "Recorded on Udozo.";
    default:
      return "Ended.";
  }
}

/** The question asked before a step, in Udozo's own dialog (with a reason box where one is asked). */
export function buyQuestion(action: ShopBuyOrderAction, order: Pick<ShopBuyOrder, "price" | "counter" | "currency" | "with" | "listing">, price?: number): ConfirmOptions {
  const money = (minor: number) => shopMoney(minor, order.currency);
  const name = order.with.name;
  const title = order.listing.title ?? "this";
  switch (action) {
    case "accept":
      return { title: `Accept ${money(order.price)}?`, body: `It is held for ${name} while you meet. Meet in a busy public place; they inspect it and pay you in person.`, action: `Accept ${money(order.price)}`, tone: "money" };
    case "accept_counter":
      return { title: `Accept ${money(order.counter ?? order.price)}?`, body: `${name} holds it for you while you meet. Inspect it before you pay, and never pay in advance.`, action: `Accept ${money(order.counter ?? order.price)}`, tone: "money" };
    case "counter":
      return { title: `Offer ${money(price ?? 0)}?`, body: `${name} can accept it or cancel.`, action: `Offer ${money(price ?? 0)}` };
    case "decline":
      return { title: "Decline this buy order?", body: `${name} is told.`, action: "Decline", tone: "danger", reason: { label: "Why (optional)", maxLength: 300 } };
    case "cancel":
      return { title: "Cancel the buy order?", body: `${name} is told, and ${title} is no longer held.`, action: "Cancel the buy order", dismiss: "Keep it", tone: "danger", reason: { label: "Why (optional)", maxLength: 300 } };
    case "no_show":
      return { title: "Say the sale did not happen?", body: "The buy order ends. Udozo keeps a record when people do not turn up.", action: "It did not happen", dismiss: "Keep it", tone: "danger", reason: { label: "What happened (optional)", maxLength: 300 } };
    case "extend":
      return { title: `Give ${name} more time?`, body: "The buy order stays open, and the item held, for more days. You can do this once.", action: "Give more time" };
    case "bought":
      return { title: `Did you buy ${title}?`, body: `${name} is asked to confirm. If they say nothing, it is recorded as bought in 3 days.`, action: "Yes, I bought it", tone: "money" };
    case "complete":
      return { title: `Mark ${title} sold to ${name}?`, body: "Only once they have paid you and have the item. The sale is recorded on Udozo, and your stock goes down.", action: "Mark sold", tone: "money" };
    case "confirm":
      return { title: `You bought ${title}?`, body: `Thanks. The sale stands, and you can rate ${name}. If something is wrong, you can still say you did not buy it within 7 days.`, action: "Yes, I bought it", tone: "money" };
    case "void":
      return { title: "You did not buy this?", body: `Udozo removes the sale from your record and tells ${name}. Marking sales that did not happen breaks Udozo's terms.`, action: "I did not buy this", tone: "danger", reason: { label: "What happened", required: true, maxLength: 300 } };
  }
}
