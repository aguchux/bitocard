import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { brand } from "@bitocard/ui/site";
import type { StoreDispute } from "@bitocard/api-client/storefront";
import { DisputeReplyForm } from "@/components/store/dispute-forms";
import { currentCustomer, customerApi } from "@/lib/customer";
import { disputeAuthor, disputeStatusLabel } from "@/lib/disputes";
import { currentStore } from "@/lib/store";

export const metadata: Metadata = { title: "Your dispute", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** One dispute: where it stands, the conversation, and a reply while it is open. */
export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/disputes/${id}`)}`);
  const result = await customerApi<StoreDispute>("GET", `/v1/store/account/disputes/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const dispute = result.data;
  const store = (await currentStore()).store?.name ?? brand.name;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Link href="/account/disputes" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Your disputes
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight break-words text-[#070f4c] sm:text-3xl">{dispute.subject}</h1>
          <p className="mt-1 text-slate-600">
            {dispute.reference}
            {dispute.checkout_id ? (
              <>
                {" · "}
                <Link href={`/account/orders/${dispute.checkout_id}`} className="font-semibold text-[#ff2382] hover:underline">
                  View the order
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{disputeStatusLabel(dispute)}</span>
      </div>

      {dispute.status === "escalated" ? (
        <p className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-900">{store} has passed this to BitoCard to decide. We will tell you as soon as there is an answer.</p>
      ) : null}
      {dispute.outcome === "refunded_customer" ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">You were refunded to how you paid. Banks and mobile money providers can take a few days to show it.</p>
      ) : null}

      <ol className="space-y-3" aria-label="Messages">
        {dispute.messages.map(message => (
          <li key={message.id} className={`rounded-2xl p-4 ${message.author === "customer" ? "bg-[#070f4c] text-white" : message.author === "system" ? "border border-dashed border-slate-200 bg-slate-50" : "bg-white ring-1 ring-slate-100"}`}>
            <p className={`mb-1 text-xs ${message.author === "customer" ? "text-white/70" : "text-slate-500"}`}>
              <strong>{disputeAuthor(message.author, store)}</strong> · {date(message.created_at)}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </li>
        ))}
      </ol>

      {dispute.status !== "resolved" ? (
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <DisputeReplyForm id={dispute.id} />
        </section>
      ) : (
        <p className="text-sm text-slate-600">This dispute is closed. If you still need help, report a new problem from the order.</p>
      )}
    </div>
  );
}
