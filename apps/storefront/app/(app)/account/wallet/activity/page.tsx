import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { StoreCryptoTransaction, StoreCryptoWallets, StoreList, StoreWalletTransaction } from "@bitocard/api-client/storefront";
import { card, hasP2pMoney, heldAssets } from "@/components/app/crypto";
import { ActivityHeading, CryptoActivityList, MoneyActivityList } from "@/components/app/wallet-activity";
import { activityCursor, activityHref, activityShow, cryptoMoves, type ActivityShow } from "@/lib/activity";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Activity" };

/** Items asked for a page: the coins' list leaves out lock moves, so it asks for more. */
const pageSize: Record<ActivityShow, number> = { money: 25, crypto: 50 };

type Search = { show?: string; after?: string };

/**
 * Everything that went in and out of the customer's wallets, newest first, a page at a time: the money wallets (both
 * currencies) or, where the store offers crypto or the customer holds some, the coins. Older pages follow the API's
 * cursor (`starting_after`); Latest goes back to the start.
 */
export default async function WalletActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const asked = activityShow(params.show);
  const after = activityCursor(params.after);
  const overview = await customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto");
  const hasCrypto = overview.ok && (overview.data.enabled || heldAssets(overview.data).length > 0 || hasP2pMoney(overview.data));
  const show: ActivityShow = asked === "crypto" && hasCrypto ? "crypto" : "money";
  const query = `limit=${pageSize[show]}${after ? `&starting_after=${after}` : ""}`;
  const result =
    show === "crypto"
      ? await customerApi<StoreList<StoreCryptoTransaction>>("GET", `/v1/store/crypto/transactions?${query}`)
      : await customerApi<StoreList<StoreWalletTransaction>>("GET", `/v1/store/wallet/transactions?${query}`);
  // The next page starts after the last item the API sent (not the last shown: lock moves are left out of the coins').
  const last = result.ok ? result.data.data.at(-1)?.id : undefined;
  const older = result.ok && result.data.has_more && last ? activityHref(show, last) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        {/* On desktop the sub rail's heading leads back to the wallet. */}
        <Link href={show === "crypto" ? "/account/wallet?wallet=crypto" : "/account/wallet"} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900 lg:hidden">
          <ChevronLeft className="size-4" aria-hidden="true" /> Wallet
        </Link>
        <h1 className="text-2xl font-extrabold">Activity</h1>
        <p className="mt-1 text-sm text-slate-600">Everything that went in and out of your wallets, newest first.</p>
      </div>

      {hasCrypto ? (
        <nav aria-label="Activity of" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 sm:max-w-sm">
          {(["money", "crypto"] as const).map(item => (
            <Link
              key={item}
              href={activityHref(item)}
              aria-current={item === show ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold ${item === show ? "bg-white text-navy-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-navy-900"}`}
            >
              {item === "money" ? "Money" : "Crypto"}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="all-activity" className={card}>
        <ActivityHeading id="all-activity" note={after ? "Older activity" : undefined}>
          {show === "crypto" ? "Crypto activity" : "Money activity"}
        </ActivityHeading>
        {!result.ok ? (
          <p className="text-slate-600" role="alert">
            Your activity cannot be shown right now. Try again shortly.
          </p>
        ) : show === "crypto" ? (
          (() => {
            const moves = cryptoMoves(result.data.data as StoreCryptoTransaction[]);
            return moves.length ? <CryptoActivityList items={moves} /> : <p className="text-slate-600">{after ? "Nothing more on this page." : "Deposits and trades show here."}</p>;
          })()
        ) : result.data.data.length ? (
          <MoneyActivityList items={result.data.data as StoreWalletTransaction[]} />
        ) : (
          <p className="text-slate-600">{after ? "Nothing older." : "Top-ups and purchases show here."}</p>
        )}

        {after || older ? (
          <nav aria-label="Pages of activity" className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            {after ? (
              <Link href={activityHref(show)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
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
