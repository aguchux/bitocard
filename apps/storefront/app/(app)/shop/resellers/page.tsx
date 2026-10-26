import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import type { ShopReseller } from "@bitocard/api-client/classifieds";
import { AutoAccept } from "@/components/app/shop/resellers";
import { customerApi } from "@/lib/customer";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "My Resellers" };

/**
 * My Resellers (B2B reselling): every reseller selling the supplier's listings on their stores, with what waits for the
 * supplier (messages, notes to approve, deals to answer). Open one for its stores, notes, deals, chat and phone.
 */
export default async function ResellersPage() {
  await requireShop("/shop/resellers");
  const [result, auto] = await Promise.all([customerApi<{ data: ShopReseller[] }>("GET", "/v1/classifieds/me/resellers"), customerApi<{ enabled: boolean }>("GET", "/v1/classifieds/me/resale/auto-accept")]);
  const rows = result.ok ? result.data.data : [];

  return (
    <div className="grid max-w-3xl gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-extrabold">My Resellers</h1>
        <p className="text-sm text-slate-600">Resellers selling your listings on their stores. Their stores show your listing exactly as you wrote it, with your name; you approve anything they add.</p>
      </header>
      {!result.ok ? <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{result.message}</p> : null}
      {auto.ok ? <AutoAccept enabled={auto.data.enabled} /> : null}
      {rows.length ? (
        <ul className="grid gap-2">
          {rows.map(row => {
            const waiting = row.unread + row.notes_pending;
            return (
              <li key={row.id}>
                <Link href={`/shop/resellers/${row.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-300">
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-900 text-white">
                    <Store className="size-5" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="truncate">{row.reseller.name}</strong>
                      {row.reseller.verified ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Verified</span> : null}
                      {row.stopped ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">Stopped</span> : null}
                    </span>
                    <span className="truncate text-sm text-slate-600">
                      {row.listings_carried} {row.listings_carried === 1 ? "listing" : "listings"}
                      {row.stores.length ? ` on ${row.stores.map(store => store.name).join(", ")}` : ""}
                      {row.sales.completed ? ` · ${row.sales.completed} sold` : ""}
                    </span>
                    <span className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                      {row.notes_pending ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-900">{row.notes_pending} {row.notes_pending === 1 ? "note" : "notes"} to approve</span> : null}
                      {row.deals.some(deal => deal.status === "active") ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">Deal running</span> : null}
                      {row.deals.some(deal => deal.status === "offered") ? <span className="rounded-full bg-pink-50 px-2 py-0.5 text-brand-700">Deal offered</span> : null}
                    </span>
                  </span>
                  {waiting ? (
                    <span className="grid min-w-6 place-items-center rounded-full bg-brand-500 px-1.5 text-xs font-bold text-white">
                      {waiting}
                      <span className="sr-only"> waiting</span>
                    </span>
                  ) : null}
                  <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : result.ok ? (
        <div className="grid gap-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <strong>No resellers yet</strong>
          <p className="text-sm text-slate-600">
            Open a listing to resellers in{" "}
            <Link href="/shop/post" className="font-semibold text-brand-700 underline">
              Post an ad
            </Link>{" "}
            (Where to sell). Resellers who add it to their stores show up here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
