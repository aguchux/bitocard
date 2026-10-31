import type { AdminLinkSent, AdminRole } from "@bitocard/api-client/admin";

/** What each role opens, in the words the team page uses. */
export const roleInfo: Record<AdminRole, { label: string; description: string }> = {
  super_admin: { label: "Super admin", description: "Everything, including the team, integrations and plans." },
  operations: { label: "Operations", description: "Sellers, stores, listings, orders, verifications, settings." },
  finance: { label: "Finance", description: "Money: refunds, top-ups, fees, payouts and reports." },
  support: { label: "Support", description: "Help desk: tickets, chats and reading accounts." },
};

/** What happened to the emailed link, for the notice above the team. */
export function linkNotice(sent: AdminLinkSent, email: string) {
  if (sent === "sent") return { tone: "green" as const, text: `We emailed ${email} a link to set their password. It works once.` };
  if (sent === "outbox") return { tone: "amber" as const, text: "No email provider is set up, so the link was not sent. Set up Email under Settings > Integrations, then send a new link." };
  if (sent === "skipped") return { tone: "amber" as const, text: "A link was sent less than a minute ago. Wait a minute before sending another." };
  return { tone: "red" as const, text: "The email could not be sent. Try again shortly." };
}
