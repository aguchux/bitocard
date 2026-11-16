import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { StoreBankDeposit, StoreList } from "@bitocard/api-client/storefront";
import { DepositRows } from "@/components/app/bank-deposit-status";
import { currentCustomer, customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Bank deposits", robots: { index: false, follow: false } };

const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/** The filters, as the API takes them (`show`). */
const filters = [
  { show: "", label: "All" },
  { show: "open", label: "In progress" },
  { show: "credited", label: "Added" },
  { show: "rejected", label: "Not credited" },
  { show: "done", label: "Ended" },
] as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const href = (show: string, after?: string) => {
  const query = new URLSearchParams({ ...(show ? { show } : {}), ...(after ? { after } : {}) }).toString();
  return `/account/wallet/deposits${query ? `?${query}` : ""}`;
};

/**
 * Every bank deposit the customer started (cash paid in or transferred to Golojan's account), newest first, with its
 * status, so they can follow each one until it is added to their wallet; filtered by status, a page at a time.
 */
export default async function BankDepositsPage({ searchParams }: { searchParams: Promise<{ show?: string; after?: string }> }) {
  const params = await searchParams;
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent("/account/wallet/deposits")}`);
  const show = filters.find(item => item.show === params.show)?.show ?? "";
  const after = params.after && uuid.test(params.after) ? params.after : undefined;
  const query = new URLSearchParams({ limit: "20", ...(show ? { show } : {}), ...(after ? { starting_after: after } : {}) }).toString();
  const result = await customerApi<StoreList<StoreBankDeposit>>("GET", `/v1/store/wallet/bank-deposits?${query}`);
  const items = result.ok ? result.data.data : [];
  const last = items.at(-1)?.id;
  const older = result.ok && result.data.has_more && last ? href(show, last) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        {/* On desktop the sub rail's heading leads back to the wallet. */}
        <Link href="/account/wallet" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900 lg:hidden">
          <ChevronLeft className="size-4" aria-hidden="true" /> Wallet
        </Link>
        <h1 className="text-2xl font-extrabold">Bank deposits</h1>
        <p className="mt-1 text-sm text-slate-600">Money you paid in at the bank or transferred to our account, and where each one is. Open one to see the account, the reference and what we found.</p>
      </div>

      <nav aria-label="Filter deposits" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {filters.map(item => (
          <Link
            key={item.label}
            href={href(item.show)}
            aria-current={item.show === show ? "page" : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${item.show === show ? "bg-navy-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section aria-label="Your bank deposits" className={card}>
        {!result.ok ? (
          <p className="text-slate-600" role="alert">
            Your bank deposits cannot be shown right now. Try again shortly.
          </p>
        ) : items.length ? (
          <DepositRows items={items} />
        ) : (
          <p className="text-slate-600">{after ? "Nothing older." : show ? "No bank deposits here." : "You have not made a bank deposit yet. Choose Bank deposit or transfer in Add funds on your wallet."}</p>
        )}

        {after || older ? (
          <nav aria-label="Pages of deposits" className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            {after ? (
              <Link href={href(show)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                <RotateCcw className="size-4" aria-hidden="true" /> Latest
              </Link>
            ) : (
              <span />
            )}
            {older ? (
              <Link href={older} className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                Older <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
