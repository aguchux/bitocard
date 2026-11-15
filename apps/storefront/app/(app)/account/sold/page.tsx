import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { type GiftCardSale, type StoreList } from "@bitocard/api-client/storefront";
import { currentCustomer, customerApi } from "@/lib/customer";
import { money } from "@/lib/money";
import { saleStatus } from "@/lib/gift-card-sales";

export const metadata: Metadata = { title: "Sold gift cards", robots: { index: false, follow: false } };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** The gift cards the customer sold: each being checked, paid into their wallet, or not accepted. */
export default async function SoldPage() {
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent("/account/sold")}`);
  const result = await customerApi<StoreList<GiftCardSale>>("GET", "/v1/store/gift-card-sales");
  const sales = result.ok ? result.data.data : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Sold gift cards</h1>
        <p className="mt-1 text-slate-600">Cards you sold. The money goes into your wallet once a card is accepted.</p>
      </div>
      {!result.ok ? (
        <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">We could not load your sold cards. Try again shortly.</p>
      ) : sales.length ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70">
          {sales.map(sale => {
            const status = saleStatus[sale.status] ?? saleStatus.pending;
            return (
              <li key={sale.id}>
                <Link href={`/account/sold/${sale.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{sale.card.name}</span>
                    <span className="block text-sm text-slate-500">
                      {sale.number} · {date(sale.created_at)} · {money(sale.paid ?? sale.quoted, sale.currency)}
                    </span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">
          You have not sold a gift card yet. Open a gift card’s page and choose <span className="font-semibold">Sell</span>.{" "}
          <Link href="/account/catalog?group=gift-cards" className="font-semibold text-azure-500 hover:underline">
            Gift cards
          </Link>
        </p>
      )}
    </div>
  );
}
