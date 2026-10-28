import type { Metadata } from "next";
import Link from "next/link";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { NewTicketForm } from "@/components/help";
import { Header } from "@/components/header";
import { HelpChat } from "@/components/help-chat";
import type { Chat, ChatActions } from "@/lib/chat-types";
import { currentCustomer, customerApi, signInPath } from "@/lib/customer";
import { chatSince, endChat, sendChat } from "@/lib/help";
import { globalMarket } from "@afrippa/ui/market";
import { endVisitorChat, sendVisitorChat, visitorChat, visitorChatSince } from "@/lib/visitor-chat";

export const metadata: Metadata = { title: "Help", robots: { index: false, follow: false } };

type Ticket = { id: string; reference: string; status: "open" | "pending" | "resolved"; subject: string; updated_at: string };

const ticketStatus: Record<Ticket["status"], [string, string]> = {
  open: ["With Afrippa", "bg-amber-50 text-amber-800"],
  pending: ["Afrippa replied", "bg-brand-50 text-brand-700"],
  resolved: ["Resolved", "bg-slate-100 text-slate-700"],
};

const traderChat: ChatActions = { send: sendChat, since: chatSince, end: endChat, files: "/help/chat/files" };
const visitorActions: ChatActions = { send: sendVisitorChat, since: visitorChatSince, end: endVisitorChat, files: "/help/chat/visitor-files" };

/**
 * Live chat with Afrippa's team (or its assistant), then the trader's questions (tickets) and a new one. Signed out,
 * anyone can chat with their name and email; questions that need following up need an account.
 */
export default async function HelpPage() {
  if (!(await currentCustomer())) return <VisitorHelp />;
  const [result, chat] = await Promise.all([customerApi<{ data: Ticket[] }>("GET", "/v1/afrippa/account/support/tickets"), customerApi<Chat | null>("GET", "/v1/afrippa/account/support/chat")]);
  const tickets = result.ok ? result.data.data : [];
  return (
    <AccountShell title="Help" current="/help">
      <HelpChat initial={chat.ok ? chat.data : null} actions={traderChat} />
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

/** Signed out: chat with Afrippa by name and email, or sign in to ask a question that is followed up. */
async function VisitorHelp() {
  const { chat } = await visitorChat();
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="font-display text-2xl font-extrabold text-navy-900 sm:text-3xl">Help</h1>
        <HelpChat initial={chat} actions={visitorActions} introduce />
        <p className="text-sm text-slate-600">
          Have an account?{" "}
          <Link href={signInPath("/help")} className="font-semibold text-brand-600 underline">
            Sign in
          </Link>{" "}
          to chat as yourself, follow your questions and ask about your orders.
        </p>
      </main>
    </>
  );
}
