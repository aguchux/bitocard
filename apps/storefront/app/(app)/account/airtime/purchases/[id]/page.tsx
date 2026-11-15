import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { airtimePurchaseStatus, ratePercent, type StoreAirtimePurchase } from "@bitocard/api-client/storefront";
import { RefreshWhile } from "@/components/store/order-status";
import { simulateAirtimePurchase } from "@/lib/airtime-actions";
import { timeLeft } from "@/lib/airtime-rules";
import { currentCustomer, customerApi } from "@/lib/customer";
import { money } from "@/lib/money";

export const metadata: Metadata = { title: "Airtime purchase", robots: { index: false, follow: false } };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

const tone: Record<StoreAirtimePurchase["status"], string> = {
  paid: "bg-amber-50 text-amber-900",
  delivering: "bg-sky-50 text-sky-900",
  delivered: "bg-green-50 text-green-800",
  refunded: "bg-slate-100 text-slate-700",
};

/** One airtime purchase from the pool: paid, being sent, sent, or refunded (refreshing until it settles). */
export default async function AirtimePurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/airtime/purchases/${id}`)}`);
  const result = await customerApi<StoreAirtimePurchase>("GET", `/v1/store/airtime/purchases/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const purchase = result.data;
  const open = purchase.status === "paid" || purchase.status === "delivering";
  const left = timeLeft(purchase.expires_at);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RefreshWhile active={open} everyMs={10_000} />
      <Link href="/account/airtime" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Airtime exchange
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {money(purchase.amount, purchase.currency)} of {purchase.network.toUpperCase()} airtime
          </h1>
          <p className="mt-1 text-slate-500">
            {purchase.number} · to {purchase.phone} · {when(purchase.created_at)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tone[purchase.status]}`}>{airtimePurchaseStatus[purchase.status]}</span>
      </div>

      <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="text-slate-700">
          {open
            ? `We are sending it to ${purchase.phone}${left ? ` (${left})` : ""}. If it cannot be sent within the hour, your money comes back to your wallet.`
            : purchase.status === "delivered"
              ? `Sent to ${purchase.phone}${purchase.delivered_at ? ` on ${when(purchase.delivered_at)}` : ""}.`
              : `${money(purchase.price, purchase.currency)} is back in your wallet.`}
        </p>
        {purchase.note ? <p className="text-sm text-slate-600">{purchase.note}</p> : null}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">Airtime</dt>
            <dd className="font-display text-lg font-bold">{money(purchase.amount, purchase.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">You paid</dt>
            <dd className="font-display text-lg font-bold">{money(purchase.price, purchase.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Rate</dt>
            <dd className="font-display text-lg font-bold">{ratePercent(purchase.rate_bps)}</dd>
          </div>
        </dl>
      </div>

      {purchase.mode === "test" && open ? (
        <div className="rounded-3xl bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">Sandbox: settle this purchase as our staff would.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["delivered", "refunded"] as const).map(outcome => (
              <form key={outcome} action={simulateAirtimePurchase.bind(null, purchase.id, outcome)}>
                <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-4 font-semibold hover:border-amber-400">
                  {outcome === "delivered" ? "Mark it sent" : "Refund it"}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
