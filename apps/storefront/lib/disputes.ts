import type { StoreDispute } from "@bitocard/api-client/storefront";

/** Where a dispute stands, in the customer's words. */
export function disputeStatusLabel(dispute: Pick<StoreDispute, "status" | "outcome">) {
  if (dispute.status === "open") return "With the store";
  if (dispute.status === "escalated") return "With BitoCard";
  const outcomes: Record<string, string> = { refunded_customer: "Refunded", rejected: "Closed" };
  return outcomes[dispute.outcome ?? ""] ?? "Resolved";
}

/** Who wrote a message, as the customer sees it: never staff names. */
export function disputeAuthor(author: StoreDispute["messages"][number]["author"], store: string) {
  return { customer: "You", reseller: store, bitocard: "BitoCard", system: "Update" }[author];
}

/** Orders a customer can report a problem with: anything past the payment page. */
export const canDispute = (status: string) => status !== "awaiting_payment";
