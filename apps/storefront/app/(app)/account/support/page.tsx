import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import type { StoreList, StoreTicket } from "@bitocard/api-client/storefront";
import { currentCustomer, customerApi } from "@/lib/customer";
import { ticketStatusLabel } from "@/lib/support";

export const metadata: Metadata = { title: "Help & support", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
const tone = { open: "bg-slate-100 text-slate-700", pending: "bg-amber-50 text-amber-900", resolved: "bg-emerald-50 text-emerald-800" } as const;

/** The customer's support tickets, most recently active first, and a way to ask a new question. */
export default async function SupportPage() {
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent("/account/support")}`);
  const result = await customerApi<StoreList<StoreTicket>>("GET", "/v1/store/support/tickets?limit=50");
  const tickets = result.ok ? result.data.data : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Help & support</h1>
          <p className="mt-1 text-slate-600">Ask the store a question and follow its answers here. For a problem with an order’s money, report it from the order.</p>
        </div>
        <Link href="/account/support/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
          <Plus className="size-4" aria-hidden="true" /> New question
        </Link>
      </div>
      {!result.ok ? <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{result.message}</p> : null}
      {result.ok && !tickets.length ? <p className="rounded-2xl bg-white p-6 text-slate-600 ring-1 ring-slate-100">No questions yet.</p> : null}
      <ul className="space-y-3">
        {tickets.map(ticket => (
          <li key={ticket.id}>
            <Link href={`/account/support/${ticket.id}`} className="flex min-h-16 items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-100 hover:ring-slate-300">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy-900">{ticket.subject}</p>
                <p className="text-sm text-slate-500">
                  {ticket.reference} · {date(ticket.updated_at)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${tone[ticket.status]}`}>{ticketStatusLabel(ticket.status)}</span>
              <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
