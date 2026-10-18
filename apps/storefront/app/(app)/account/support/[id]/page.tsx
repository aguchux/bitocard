import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { brand } from "@bitocard/ui/site";
import type { StoreTicket } from "@bitocard/api-client/storefront";
import { CloseTicketButton, TicketReplyForm } from "@/components/store/support-forms";
import { currentCustomer, customerApi } from "@/lib/customer";
import { ticketAuthor, ticketStatusLabel } from "@/lib/support";
import { currentStore } from "@/lib/store";

export const metadata: Metadata = { title: "Your question", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** One ticket: where it stands, the conversation, a reply (reopening it once resolved) and closing it. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/support/${id}`)}`);
  const result = await customerApi<StoreTicket>("GET", `/v1/store/support/tickets/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const ticket = result.data;
  const store = (await currentStore()).store?.name ?? brand.name;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Link href="/account/support" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Help & support
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight break-words text-navy-900 sm:text-3xl">{ticket.subject}</h1>
          <p className="mt-1 text-slate-600">
            {ticket.reference}
            {ticket.checkout_id ? (
              <>
                {" · "}
                <Link href={`/account/orders/${ticket.checkout_id}`} className="font-semibold text-brand-500 hover:underline">
                  View the order
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{ticketStatusLabel(ticket.status)}</span>
      </div>

      <ol className="space-y-3" aria-label="Messages">
        {ticket.messages.map(message => (
          <li key={message.id} className={`rounded-2xl p-4 ${message.author === "customer" ? "bg-navy-900 text-white" : message.author === "system" ? "border border-dashed border-slate-200 bg-slate-50" : "bg-white ring-1 ring-slate-100"}`}>
            <p className={`mb-1 text-xs ${message.author === "customer" ? "text-white/70" : "text-slate-500"}`}>
              <strong>{ticketAuthor(message, store)}</strong> · {date(message.created_at)}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </li>
        ))}
      </ol>

      <section className="space-y-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        {ticket.status === "resolved" ? <p className="text-sm text-slate-600">This question is resolved. Reply if you still need help: it reopens.</p> : null}
        <TicketReplyForm id={ticket.id} />
        {ticket.status !== "resolved" ? <CloseTicketButton id={ticket.id} /> : null}
      </section>
    </div>
  );
}
