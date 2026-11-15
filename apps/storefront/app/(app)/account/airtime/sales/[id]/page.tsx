import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { airtimeSaleStatus, ratePercent, type StoreAirtimeSale } from "@bitocard/api-client/storefront";
import { SendFromWarning } from "@/components/app/airtime/trade-forms";
import { RefreshWhile } from "@/components/store/order-status";
import { CopyValue } from "@/components/store/vpn-access";
import { cancelAirtimeSale, markAirtimeSent, simulateAirtimeSale } from "@/lib/airtime-actions";
import { timeLeft } from "@/lib/airtime-rules";
import { currentCustomer, customerApi } from "@/lib/customer";
import { money } from "@/lib/money";

export const metadata: Metadata = { title: "Airtime sale", robots: { index: false, follow: false } };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

const tone: Record<StoreAirtimeSale["status"], string> = {
  awaiting_transfer: "bg-amber-50 text-amber-900",
  sent: "bg-sky-50 text-sky-900",
  received: "bg-green-50 text-green-800",
  credited: "bg-green-50 text-green-800",
  expired: "bg-slate-100 text-slate-700",
  cancelled: "bg-slate-100 text-slate-700",
  not_received: "bg-red-50 text-red-800",
  reversed: "bg-red-50 text-red-800",
};

function explain(sale: StoreAirtimeSale) {
  switch (sale.status) {
    case "awaiting_transfer":
      return "Send exactly this amount from your own line to the number below, then tell us you sent it.";
    case "sent":
      return "We are checking that your airtime arrived. This usually takes a few minutes.";
    case "received":
      return `Your airtime arrived. ${money(sale.payout, sale.currency)} reaches your wallet ${sale.credit_at ? `on ${when(sale.credit_at)}` : "soon"}, once the hold has passed.`;
    case "credited":
      return `${money(sale.payout, sale.currency)} is in your wallet.`;
    case "expired":
      return "You did not send the airtime within the hour, so this sale ended. If you did send it, contact us.";
    case "cancelled":
      return "You cancelled this sale.";
    case "not_received":
      return "We did not receive your airtime, so nothing is paid.";
    case "reversed":
      return "The network took the airtime back, so nothing is paid.";
  }
}

/** One airtime sale: where and how to send it while the seller still has to, then its progress (refreshing while it moves). */
export default async function AirtimeSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(`/account/airtime/sales/${id}`)}`);
  const result = await customerApi<StoreAirtimeSale>("GET", `/v1/store/airtime/sales/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const sale = result.data;
  const left = timeLeft(sale.expires_at);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RefreshWhile active={["awaiting_transfer", "sent", "received"].includes(sale.status)} everyMs={10_000} />
      <Link href="/account/airtime" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Airtime exchange
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {money(sale.amount, sale.currency)} of {sale.network.toUpperCase()} airtime
          </h1>
          <p className="mt-1 text-slate-500">
            {sale.number} · started {when(sale.created_at)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tone[sale.status]}`}>{airtimeSaleStatus[sale.status]}</span>
      </div>

      <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="text-slate-700">{explain(sale)}</p>
        {sale.note ? <p className="font-semibold text-red-800">{sale.note}</p> : null}
        {sale.status === "awaiting_transfer" && sale.collector_number ? (
          <>
            <div className="rounded-2xl bg-slate-50 p-4">
              <CopyValue label="Send it to" value={sale.collector_number} />
            </div>
            <SendFromWarning phone={sale.from_phone} />
            <ol className="list-decimal space-y-1.5 rounded-2xl bg-slate-50 p-4 pl-9 text-sm">
              <li>
                Use the phone with the SIM for <span className="font-semibold">{sale.from_phone}</span> in it.
              </li>
              <li className="break-words">{sale.transfer_steps ?? <>Transfer {money(sale.amount, sale.currency)} of airtime to {sale.collector_number}.</>}</li>
              <li>Check the text from your network says {money(sale.amount, sale.currency)} went to {sale.collector_number}.</li>
              <li>Come back here and press <span className="font-semibold">I’ve sent it</span>{left ? ` (${left})` : ""}.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <form action={markAirtimeSent.bind(null, sale.id)}>
                <button type="submit" className="inline-flex min-h-12 items-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600">
                  I’ve sent it
                </button>
              </form>
              <form action={cancelAirtimeSale.bind(null, sale.id)}>
                <button type="submit" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300">
                  Cancel
                </button>
              </form>
            </div>
          </>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">Airtime</dt>
            <dd className="font-display text-lg font-bold">{money(sale.amount, sale.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">{sale.status === "credited" ? "Paid to your wallet" : "You get"}</dt>
            <dd className="font-display text-lg font-bold">{money(sale.payout, sale.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Rate</dt>
            <dd className="font-display text-lg font-bold">{ratePercent(sale.rate_bps)}</dd>
          </div>
        </dl>
      </div>

      {sale.mode === "test" && ["awaiting_transfer", "sent"].includes(sale.status) ? (
        <div className="rounded-3xl bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">Sandbox: settle this sale as our staff would.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["received", "not_received"] as const).map(outcome => (
              <form key={outcome} action={simulateAirtimeSale.bind(null, sale.id, outcome)}>
                <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-4 font-semibold hover:border-amber-400">
                  {outcome === "received" ? "It arrived" : "Nothing arrived"}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
