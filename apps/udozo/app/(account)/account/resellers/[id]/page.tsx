import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink, Phone } from "lucide-react";
import { shopMoney, type ShopReseller, type ShopResaleMessage } from "@bitocard/api-client/classifieds";
import { NoteDecision, ResellerChat, ResellerDeals, StopReselling } from "@/components/account/resellers";
import { ReportStore } from "@/components/account/report-store";
import { customerApi } from "@/lib/customer";
import { uuidPattern } from "@/lib/shop";
import { requireSeller } from "@/lib/account";

export const metadata: Metadata = { title: "Reseller" };

type Props = { params: Promise<{ id: string }> };

/** One reseller: who they are and their phone, their stores, notes to approve, deals, the chat, and stopping them. */
export default async function ResellerPage({ params }: Props) {
  const { id } = await params;
  await requireSeller(`/account/resellers/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const [result, messages] = await Promise.all([
    customerApi<ShopReseller>("GET", `/v1/classifieds/me/resellers/${id}`),
    customerApi<{ data: ShopResaleMessage[]; closed: boolean }>("GET", `/v1/classifieds/me/resellers/${id}/messages`),
  ]);
  if (!result.ok) notFound();
  const reseller = result.data;
  const withNotes = (reseller.listings ?? []).filter(item => item.note && item.status !== "removed");
  const pending = withNotes.filter(item => item.note!.status === "pending");
  const others = withNotes.filter(item => item.note!.status !== "pending");

  return (
    <div className="grid max-w-3xl gap-4">
      <header className="flex items-center gap-2">
        <Link href="/account/resellers" aria-label="Back to My Resellers" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-slate-100">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold">{reseller.reseller.name}</h1>
        {reseller.reseller.verified ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Verified</span> : null}
      </header>

      {reseller.stopped ? <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">You stopped this reseller selling your listings. Their stores no longer show them.</p> : null}

      <section className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        {reseller.reseller.phone ? (
          <a href={`tel:${reseller.reseller.phone}`} className="flex w-fit items-center gap-2 text-sm font-semibold text-navy-900 hover:underline">
            <Phone className="size-4" aria-hidden="true" />
            {reseller.reseller.phone}
          </a>
        ) : (
          <p className="text-sm text-slate-500">Their phone number shows while you work together.</p>
        )}
        {reseller.stores.length ? (
          <ul className="grid gap-1 text-sm">
            {reseller.stores.map(store => (
              <li key={store.id}>
                <a href={store.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline">
                  {store.name}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm text-slate-600">
          {reseller.listings_carried} of your {reseller.listings_carried === 1 ? "listing" : "listings"} on their stores.
        </p>
        {reseller.sales.completed + reseller.sales.open + reseller.sales.refunded ? (
          <p className="text-sm text-slate-600">
            {reseller.sales.completed} sold, {reseller.sales.open} on the way, {reseller.sales.refunded} refunded
            {reseller.sales.paid_to_you ? `; ${shopMoney(reseller.sales.paid_to_you.amount, reseller.sales.paid_to_you.currency)} paid to you` : ""}.
          </p>
        ) : null}
      </section>

      {pending.length ? (
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">Notes to approve</h2>
          <p className="text-sm text-slate-600">A note shows on their store only once you approve its exact words. Refuse anything you did not say about your item.</p>
          {pending.map(item => (
            <NoteDecision key={item.id} relationshipId={reseller.id} item={item} />
          ))}
        </section>
      ) : null}

      <section className="grid gap-2">
        <h2 className="text-lg font-extrabold">Deals</h2>
        <ResellerDeals reseller={reseller} />
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-extrabold">Chat</h2>
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">Keep it here. Payments for your items go through Udozo: never let a reseller or their buyer pay you directly.</p>
        <ResellerChat relationshipId={reseller.id} initial={messages.ok ? messages.data.data : []} closed={messages.ok ? messages.data.closed : true} resellerName={reseller.reseller.name} />
      </section>

      {others.length ? (
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">Their notes</h2>
          {others.map(item => (
            <NoteDecision key={item.id} relationshipId={reseller.id} item={item} />
          ))}
        </section>
      ) : null}

      <section className="grid gap-2 border-t border-slate-200 pt-4">
        <StopReselling reseller={reseller} />
        {reseller.stores.length ? <ReportStore target={{ kind: "reseller", relationshipId: reseller.id, stores: reseller.stores }} /> : null}
      </section>
    </div>
  );
}
