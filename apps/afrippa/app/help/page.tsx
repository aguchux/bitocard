import type { Metadata } from "next";
import Link from "next/link";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { NewTicketForm } from "@/components/help";
import { HelpChat } from "@/components/help-chat";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import type { Chat } from "@/lib/help";

export const metadata: Metadata = { title: "Help", robots: { index: false, follow: false } };

type Ticket = { id: string; reference: string; status: "open" | "pending" | "resolved"; subject: string; updated_at: string };

const ticketStatus: Record<Ticket["status"], [string, string]> = {
  open: ["With Afrippa", "bg-amber-50 text-amber-800"],
  pending: ["Afrippa replied", "bg-brand-50 text-brand-700"],
  resolved: ["Resolved", "bg-slate-100 text-slate-700"],
};

/** Live chat with Afrippa's team, then the trader's questions (tickets) and a new one. */
export default async function HelpPage() {
  await requireCustomer("/help");
  const [result, chat] = await Promise.all([customerApi<{ data: Ticket[] }>("GET", "/v1/afrippa/account/support/tickets"), customerApi<Chat | null>("GET", "/v1/afrippa/account/support/chat")]);
  const tickets = result.ok ? result.data.data : [];
  return (
    <AccountShell title="Help" current="/help">
      <HelpChat initial={chat.ok ? chat.data : null} />
      {tickets.length ? (
        <ul className="space-y-2" aria-label="Your questions">
          {tickets.map(ticket => {
            const [label, tone] = ticketStatus[ticket.status];
            return (
              <li key={ticket.id}>
                <Link href={`/help/${ticket.id}`} className={`${cardClass} flex flex-wrap items-center justify-between gap-2 hover:ring-slate-300`}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{ticket.subject}</span>
                    <span className="block text-sm text-slate-500">
                      {ticket.reference} · {tradeDate(ticket.updated_at)}
                    </span>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <section className={`${cardClass} space-y-3`} aria-labelledby="ask">
        <h2 id="ask" className="font-display text-lg font-extrabold">
          Ask Afrippa&apos;s team
        </h2>
        <NewTicketForm nonce={crypto.randomUUID()} />
      </section>
    </AccountShell>
  );
}
