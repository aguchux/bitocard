import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { type GiftCardSale } from "@bitocard/api-client/storefront";
import { RefreshWhile } from "@/components/store/order-status";
import { currentCustomer, customerApi } from "@/lib/customer";
import { money } from "@/lib/money";
import { saleStatus } from "@/lib/gift-card-sales";
import { simulateSale } from "@/lib/sell-actions";

export const metadata: Metadata = { title: "Sold gift card", robots: { index: false, follow: false } };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

const next: Record<GiftCardSale["status"], string> = {
  pending: "Your card is being checked. This usually takes a few minutes and can take a few hours. The money goes into your wallet as soon as it is accepted; nothing is paid before.",
  completed: "Your card was accepted and the money is in your wallet.",
  rejected: "Your card was not accepted, so nothing was paid.",
  failed: "Your card was not sent, so nothing was paid. You can sell it again from its page.",
};

/** One gift card the customer sold: what it is, what they get, and where it stands (refreshing while it is checked). */
export default async function SoldCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/sold/${id}`)}`);
  const result = await customerApi<GiftCardSale>("GET", `/v1/store/gift-card-sales/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const sale = result.data;
  const status = saleStatus[sale.status] ?? saleStatus.pending;

  return (
    <div className="space-y-5">
      <RefreshWhile active={sale.status === "pending"} everyMs={10_000} />
      <Link href="/account/sold" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Sold gift cards
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{sale.card.name}</h1>
          <p className="mt-1 text-slate-500">
            {sale.number} · sold {when(sale.created_at)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${status.tone}`}>{status.label}</span>
      </div>

      <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="text-slate-700">{next[sale.status]}</p>
        {sale.reason && (sale.status === "rejected" || sale.status === "failed") ? <p className="mt-2 font-semibold text-red-800">{sale.reason}</p> : null}
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">The card’s value</dt>
            <dd className="font-display text-lg font-bold">{sale.amount}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">{sale.paid === null ? "You get" : "Paid to your wallet"}</dt>
            <dd className="font-display text-lg font-bold">{money(sale.paid ?? sale.quoted, sale.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Sent as</dt>
            <dd className="font-display text-lg font-bold">{sale.form === "ecode" ? `Code ending ${sale.code_hint ?? ""}` : `${sale.photos} photo${sale.photos === 1 ? "" : "s"}`}</dd>
          </div>
        </dl>
        {sale.status === "completed" ? (
          <Link href="/account/wallet" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
            Go to your wallet
          </Link>
        ) : null}
      </div>

      {sale.mode === "test" && sale.status === "pending" ? (
        <div className="rounded-3xl bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">Sandbox: decide this sale as the buyer would.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["approved", "rejected"] as const).map(outcome => (
              <form key={outcome} action={simulateSale.bind(null, sale.id, outcome)}>
                <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-4 font-semibold hover:border-amber-400">
                  {outcome === "approved" ? "Accept the card" : "Reject the card"}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
