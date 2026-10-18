import { ticketStatusLabel } from "@bitocard/admin-ui";
import type { TicketSummary } from "@bitocard/api-client/reseller";

/** A customer's ticket the store must answer now. */
export const needsAnswer = (row: TicketSummary) => row.requester === "customer" && row.queue === "reseller" && row.status === "open";

/** Whose turn it is, from the store's side: it answers its customers, and asks BitoCard its own questions. */
export function shqTicketStatus(row: TicketSummary) {
  if (row.requester === "customer" && row.queue === "bitocard" && row.status !== "resolved") return "With BitoCard";
  return ticketStatusLabel(row.status, row.requester === "customer");
}

/** The badge colour: open when it is the store's turn, pending while it waits on someone else. */
export const ticketTone = (row: TicketSummary) => (row.status === "resolved" ? "resolved" : needsAnswer(row) || (row.requester === "reseller" && row.status === "pending") ? "open" : "pending");
