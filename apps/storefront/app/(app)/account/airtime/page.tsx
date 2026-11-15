import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight } from "lucide-react";
import { airtimePurchaseStatus, airtimeSaleStatus } from "@bitocard/api-client/storefront";
import { AirtimePoolBoard } from "@/components/app/airtime/pool-board";
import { airtimePool, myAirtime } from "@/lib/airtime";
import { currentCustomer } from "@/lib/customer";
import { money } from "@/lib/money";

export const metadata: Metadata = { title: "Airtime exchange", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** The airtime exchange: the live pool, Sell and Buy, and the customer's own trades. */
export default async function AirtimePage() {
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent("/account/airtime")}`);
  const [pool, mine] = await Promise.all([airtimePool(), myAirtime()]);
  const trades = [
    ...mine.sales.map(sale => ({ id: sale.id, href: `/account/airtime/sales/${sale.id}`, kind: "Sold" as const, label: `${sale.network.toUpperCase()} ${money(sale.amount, sale.currency)}`, status: airtimeSaleStatus[sale.status], number: sale.number, at: sale.created_at })),
    ...mine.purchases.map(purchase => ({ id: purchase.id, href: `/account/airtime/purchases/${purchase.id}`, kind: "Bought" as const, label: `${purchase.network.toUpperCase()} ${money(purchase.amount, purchase.currency)} to ${purchase.phone}`, status: airtimePurchaseStatus[purchase.status], number: purchase.number, at: purchase.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Airtime exchange</h1>
          <p className="mt-1 max-w-2xl text-slate-600">Sell airtime you will not use, or buy airtime for less. Everyone sees the same pool.</p>
        </div>
        {pool?.open ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/account/airtime/sell" className="inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
              <ArrowUpFromLine className="size-5" aria-hidden="true" /> Sell airtime
            </Link>
            <Link href="/account/airtime/buy" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
              <ArrowDownToLine className="size-5" aria-hidden="true" /> Buy airtime
            </Link>
          </div>
        ) : null}
      </div>

      {pool ? <AirtimePoolBoard pool={pool} signedIn /> : <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">We could not load the pool. Try again shortly.</p>}

      <section aria-labelledby="my-trades">
        <h2 id="my-trades" className="mb-3 text-xl font-extrabold tracking-tight">
          Your trades
        </h2>
        {trades.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70">
            {trades.map(trade => (
              <li key={trade.id}>
                <Link href={trade.href} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {trade.kind}: {trade.label}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {trade.number} · {date(trade.at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-slate-600">{trade.status}</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">No trades yet.</p>
        )}
      </section>
    </div>
  );
}
