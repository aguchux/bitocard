import type { StoreTicket } from "@bitocard/api-client/storefront";

/** Where a ticket stands, in the customer's words. */
export function ticketStatusLabel(status: StoreTicket["status"]) {
  return { open: "Waiting for the store", pending: "Waiting for you", resolved: "Resolved" }[status];
}

/** Who wrote a message, as the customer sees it: never staff names, an assistant by its name. */
export function ticketAuthor(message: Pick<StoreTicket["messages"][number], "author" | "author_name">, store: string) {
  if (message.author === "bot") return message.author_name ? `${message.author_name} (assistant)` : "Assistant";
  return { customer: "You", reseller: store, bitocard: "BitoCard", system: "Update" }[message.author];
}

export const ticketCategories: Array<{ value: StoreTicket["category"]; label: string }> = [
  { value: "order", label: "An order" },
  { value: "payment", label: "A payment" },
  { value: "account", label: "My account" },
  { value: "product", label: "A product" },
  { value: "technical", label: "Something not working" },
  { value: "other", label: "Something else" },
];
