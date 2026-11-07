import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageTitle } from "@/components/account/nav";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { type WantedForYou, type WantedRequest, wantedScreen, type WantedTab, wantedTabs, wantedWhen } from "@/lib/wanted";

export const metadata: Metadata = { title: "Wanted requests" };

const tabLabels: Record<WantedTab, string> = { mine: "Requests I made", "for-you": "Requests for you" };

/**
 * Account > Wanted requests: the buyer's own requests (with their answers), and requests Udozo told them about as a
 * seller, which they answer with one of their listings.
 */
export default async function WantedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const customer = await requireCustomer(wantedScreen);
  const query = await searchParams;
  const tab: WantedTab = (wantedTabs as readonly string[]).includes(query.tab ?? "") ? (query.tab as WantedTab) : "mine";
  const result = tab === "mine" ? await customerApi<{ data: WantedRequest[] }>("GET", "/v1/classifieds/me/wanted?limit=50") : await customerApi<{ data: WantedForYou[] }>("GET", "/v1/classifieds/me/wanted-for-you?limit=50");
  const rows = result.ok ? result.data.data : null;
  const cc = (customer.country ?? "ng").toLowerCase();
  return (
    <div className="grid max-w-3xl gap-5">
      <PageTitle title="Wanted requests" note="Tell sellers what you need, or answer buyers looking for what you sell." post={false} />
      <nav aria-label="Requests" className="flex gap-5 border-b border-navy-200">
        {wantedTabs.map(item => (
          <Link key={item} href={`${wantedScreen}?tab=${item}`} aria-current={item === tab ? "page" : undefined} className={`-mb-px border-b-2 pb-2 text-sm font-semibold ${item === tab ? "border-brand-600 text-navy-900" : "border-transparent text-navy-500 hover:text-navy-800"}`}>
            {tabLabels[item]}
          </Link>
        ))}
      </nav>
      {tab === "mine" ? (
        <Link href={`/${cc}/wanted/new`} className="inline-flex h-10 w-fit items-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-600">
          <Plus className="size-4" strokeWidth={2.6} aria-hidden="true" /> Post a request
        </Link>
      ) : null}
      {!rows ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Requests could not be loaded just now. Try again shortly.</p>
      ) : !rows.length ? (
        <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">
          {tab === "mine" ? "No requests yet. Can't find something? Post a request and sellers who have it answer." : "No requests for you yet. When a buyer asks for something you sell, it shows here."}
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {rows.map(row => (
            <li key={row.id}>
              <Link href={`${wantedScreen}/${row.id}`} className="grid gap-1 rounded-2xl border border-navy-200 bg-white p-4 hover:border-navy-400">
                <span className="flex items-baseline justify-between gap-3">
                  <strong className="min-w-0 truncate">{row.words}</strong>
                  <span className="shrink-0 text-xs font-semibold text-navy-500">{row.number}</span>
                </span>
                <span className="text-sm text-navy-600">
                  {[row.category.name, row.place, row.budget.text].filter(Boolean).join(" · ")}
                </span>
                <span className="text-xs text-navy-500">
                  {wantedWhen(row)}
                  {tab === "mine" ? ` · ${row.responses} answer${row.responses === 1 ? "" : "s"}` : "answered" in row && row.answered ? " · You answered" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
