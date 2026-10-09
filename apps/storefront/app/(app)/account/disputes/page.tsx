import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { StoreDispute, StoreList } from "@bitocard/api-client/storefront";
import { currentCustomer, customerApi } from "@/lib/customer";
import { disputeStatusLabel } from "@/lib/disputes";

export const metadata: Metadata = { title: "Your disputes", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** The customer's disputes, newest first. A new one starts from an order ("Report a problem"). */
export default async function DisputesPage() {
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent("/account/disputes")}`);
  const result = await customerApi<StoreList<StoreDispute>>("GET", "/v1/store/account/disputes?limit=50");
  const disputes = result.ok ? result.data.data : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Your disputes</h1>
        <p className="mt-1 text-slate-600">Problems you reported with an order. The store answers first and can pass them to BitoCard.</p>
      </div>
      {!result.ok ? <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{result.message}</p> : null}
      {result.ok && !disputes.length ? (
        <p className="rounded-2xl bg-white p-6 text-slate-600 ring-1 ring-slate-100">
          No disputes. To report a problem, open the order from <Link href="/account/orders" className="font-semibold text-[#ff2382] hover:underline">your orders</Link>.
        </p>
      ) : null}
      <ul className="space-y-3">
        {disputes.map(dispute => (
          <li key={dispute.id}>
            <Link href={`/account/disputes/${dispute.id}`} className="flex min-h-16 items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-100 hover:ring-slate-300">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[#070f4c]">{dispute.subject}</p>
                <p className="text-sm text-slate-500">
                  {dispute.reference} · {date(dispute.created_at)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{disputeStatusLabel(dispute)}</span>
              <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
