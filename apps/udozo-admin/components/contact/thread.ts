import type { ContactMessage } from "@bitocard/api-client/admin";

/** The sender's message first, then the team's replies (emailed) and notes (never sent), as the ticket thread draws them. */
export function contactThread(message: ContactMessage) {
  return [
    { id: message.id, author: "customer", author_name: message.name, visibility: "all" as const, body: message.body, created_at: message.created_at },
    ...(message.entries ?? []).map(entry => ({ id: entry.id, author: "bitocard", author_name: entry.author_name, visibility: entry.kind === "note" ? ("staff" as const) : ("all" as const), body: entry.body, created_at: entry.created_at })),
  ];
}
