import type { Metadata } from "next";
import Link from "next/link";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { TicketReplyForm } from "@/components/help";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { closeTicket } from "@/lib/help";

export const metadata: Metadata = { title: "Your question", robots: { index: false, follow: false } };

type Message = { id: string; author: string; body: string; created_at: string };
type TicketDetail = { id: string; reference: string; status: "open" | "pending" | "resolved"; subject: string; messages: Message[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statusText = { open: "Afrippa's team will reply here.", pending: "Afrippa replied. Reply if you need more, or close it if you are done.", resolved: "Resolved. Reply to open it again." };

/** One question to Afrippa's team: the thread (the team writes as "Afrippa"), reply, and close when done. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCustomer(`/help/${id}`);
  const result = uuid.test(id) ? await customerApi<TicketDetail>("GET", `/v1/afrippa/account/support/tickets/${id}`) : null;
  if (!result?.ok)
    return (
      <AccountShell title="Help" current="/help">
        <p className={cardClass}>
          No such question.{" "}
          <Link href="/help" className="font-semibold text-brand-700 underline">
            Your questions
          </Link>
        </p>
      </AccountShell>
    );
  const ticket = result.data;
  return (
    <AccountShell title={ticket.subject} current="/help">
      <p className="text-sm text-slate-600">
        {ticket.reference} · {statusText[ticket.status]}
      </p>
      <ol className="space-y-2" aria-label="Messages">
        {ticket.messages.map(message =>
          message.author === "system" ? (
            <li key={message.id} className="text-center text-xs text-slate-500">
              {message.body}
            </li>
          ) : (
            <li key={message.id} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${message.author === "customer" ? "ml-auto bg-navy-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>
              <p className="text-xs font-semibold opacity-75">
                {message.author === "customer" ? "You" : "Afrippa"} · {tradeDate(message.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
            </li>
          ),
        )}
      </ol>
      <section className={cardClass}>
        <TicketReplyForm id={ticket.id} />
      </section>
      {ticket.status !== "resolved" ? (
        <form action={closeTicket}>
          <input type="hidden" name="id" value={ticket.id} />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-slate-300 hover:ring-slate-400">
            My question is answered: close it
          </button>
        </form>
      ) : null}
    </AccountShell>
  );
}
