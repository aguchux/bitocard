import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { StoreList, StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { ActivityHeading, MoneyActivityList } from "@/components/account/wallet-activity";
import { activityCursor, activityHref } from "@/lib/activity";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Transactions" };

const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/**
 * Everything that went in and out of the customer's wallets (both currencies), newest first, a page at a time. Older
 * pages follow the API's cursor (`starting_after`); Latest goes back to the start.
 */
export default async function WalletTransactionsPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  await requireCustomer("/account/wallet/transactions");
  const after = activityCursor((await searchParams).after);
  const result = await customerApi<StoreList<StoreWalletTransaction>>("GET", `/v1/store/wallet/transactions?limit=25${after ? `&starting_after=${after}` : ""}`);
  const last = result.ok ? result.data.data.at(-1)?.id : undefined;
  const older = result.ok && result.data.has_more && last ? activityHref(last) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        {/* On desktop the sub rail's heading leads back to the wallet. */}
        <Link href="/account/wallet" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900 lg:hidden">
          <ChevronLeft className="size-4" aria-hidden="true" /> Wallet
        </Link>
        <h1 className="text-2xl font-extrabold">Transactions</h1>
        <p className="mt-1 text-sm text-slate-600">Everything that went in and out of your wallets, newest first.</p>
      </div>

      <section aria-labelledby="all-activity" className={card}>
        <ActivityHeading id="all-activity" note={after ? "Older transactions" : undefined}>
          Money activity
        </ActivityHeading>
        {!result.ok ? (
          <p className="text-slate-600" role="alert">
            Your activity cannot be shown right now. Try again shortly.
          </p>
        ) : result.data.data.length ? (
          <MoneyActivityList items={result.data.data} />
        ) : (
          <p className="text-slate-600">{after ? "Nothing older." : "Top-ups and purchases show here."}</p>
        )}

        {after || older ? (
          <nav aria-label="Pages of activity" className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            {after ? (
              <Link href={activityHref()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
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
