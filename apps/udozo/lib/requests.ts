import type { ShopCall, ShopContactRequest } from "@bitocard/api-client/classifieds";

/** A finished request in a few words. */
export function requestOutcome(request: Pick<ShopContactRequest, "kind" | "status">) {
  const words: Record<string, string> = { accepted: "You shared your contact", declined: "You declined", done: "You called them back", dismissed: "Dismissed", cancelled: "Cancelled by the buyer", pending: "Waiting for you" };
  return words[request.status] ?? request.status;
}

/** A call in the seller's list, from their side. */
export function callLine(call: Pick<ShopCall, "status" | "role">) {
  if (call.role === "callee") return call.status === "missed" ? "Missed call" : call.status === "declined" ? "You declined" : call.status === "cancelled" ? "They hung up before you answered" : "Answered";
  return call.status === "missed" ? "No answer" : call.status === "declined" ? "Declined" : call.status === "cancelled" ? "You cancelled" : "Answered";
}
