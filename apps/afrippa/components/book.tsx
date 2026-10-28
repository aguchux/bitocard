import Link from "next/link";
import { amountMinor, marketHref, shownAds, type MarketState } from "@afrippa/ui/market";
import { MarketAds, type AdAction } from "@afrippa/ui/market-view";
import { book, bookQuery } from "@/lib/api";

/**
 * Taking an ad opens an escrow order on its own page (`/take/<ad>`): signed in, past two-step, with the amount and the
 * account the money goes to. The book itself stays public and cached, so the button is a plain link.
 */
export const takeAd: AdAction = (ad, side) => (
  <Link href={`/take/${ad.id}`} prefetch={false} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
    {side === "buy" ? "Buy" : "Sell"} {ad.asset}
  </Link>
);

/**
 * A market's book for the filters chosen: its own small part, reading the cached book (one per market, coin, side,
 * currency and amount) and streaming in under the filters. An unreachable API says so here alone.
 */
export async function MarketBook({ market, name, state }: { market: string; name: string; state: MarketState }) {
  const result = await book(market, bookQuery({ asset: state.asset, side: state.side, currency: state.currency, q: state.q, fiat: amountMinor(state.amount) }));
  if (!result.ok) return <p className="rounded-3xl bg-white p-5 text-sm text-slate-600 ring-1 ring-slate-200/70">This market cannot be shown right now. Try again shortly.</p>;
  const ads = shownAds(result.data.data, state);
  const filtered = Boolean(state.q || state.amount || state.experienced);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600" role="status">
        {ads.length} {ads.length === 1 ? "ad" : "ads"} {state.side === "buy" ? `selling ${state.asset}` : `buying ${state.asset}`} for {state.currency} in {name}
      </p>
      {ads.length ? (
        <MarketAds ads={ads} state={state} action={takeAd} />
      ) : (
        <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
          <p className="font-semibold">{filtered ? "No ads match your filters" : `Nobody is ${state.side === "buy" ? "selling" : "buying"} ${state.asset} for ${state.currency} here right now`}</p>
          <p className="mt-1 text-sm text-slate-600">{filtered ? "Try another amount or trader, or clear the filters." : "Post your own ad and other traders can come to you."}</p>
          {filtered ? (
            <Link href={marketHref(state, { q: "", amount: "", experienced: false })} className="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-slate-300">
              Clear filters
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The book's shape while it loads: a few empty cards, so the page does not jump. */
export function BookSkeleton() {
  return (
    <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {[0, 1, 2, 3].map(item => (
        <li key={item} className="h-56 animate-pulse rounded-3xl bg-white ring-1 ring-slate-200/70 motion-reduce:animate-none" />
      ))}
    </ul>
  );
}
