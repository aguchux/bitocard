import Link from "next/link";
import { amountMinor, marketHref, shownAds, type MarketState } from "@bitocard/crypto-ui/market";
import { MarketAds, type AdAction } from "@bitocard/crypto-ui/market-view";
import { book, bookQuery } from "@/lib/api";
import { currentCustomer, signInPath } from "@/lib/customer";
import { tradeHref } from "@/lib/handoff";

/**
 * Taking an ad from the public pages: trading happens signed in, on the customer's BitoCard account, in the same market
 * and book: `hrefFor` gives the Crypto tab's address with the market and filters (`/account/crypto?market=…`), turned
 * into a link that signs the customer in there (`tradeHref`) or asks them to sign in here first.
 */
export function tradeOnBitoCard(market: string, hrefFor: (path: string) => string): AdAction {
  return function TradeOnBitoCard(ad, side) {
    // The store reads `market` as the customer's own market when it is theirs, else the market they may trade in.
    const params = new URLSearchParams({ market, side, asset: ad.asset, currency: ad.currency });
    return (
      <a
        href={hrefFor(`/account/crypto?${params}`)}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-900 px-4 text-sm font-bold text-white hover:bg-navy-800"
      >
        {side === "buy" ? `Buy ${ad.asset}` : `Sell ${ad.asset}`}
      </a>
    );
  };
}

/**
 * A market's book for the filters chosen: its own small part, reading the cached book (one per market, coin, side,
 * currency and amount) and streaming in under the filters. An unreachable API says so here alone.
 */
export async function MarketBook({ market, name, state }: { market: string; name: string; state: MarketState }) {
  const [result, customer] = await Promise.all([book(market, bookQuery({ asset: state.asset, side: state.side, currency: state.currency, q: state.q, fiat: amountMinor(state.amount) })), currentCustomer()]);
  // Signed in: straight to trading. Signed out: sign in here first, then back to this very view.
  const hrefFor = (path: string) => (customer ? tradeHref(customer.country, path) : signInPath(marketHref(state), "trade"));
  if (!result.ok) return <p className="rounded-3xl bg-white p-5 text-sm text-slate-600 ring-1 ring-slate-200/70">This market cannot be shown right now. Try again shortly.</p>;
  const ads = shownAds(result.data.data, state);
  const filtered = Boolean(state.q || state.amount || state.experienced);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600" role="status">
        {ads.length} {ads.length === 1 ? "ad" : "ads"} {state.side === "buy" ? `selling ${state.asset}` : `buying ${state.asset}`} for {state.currency} in {name}
      </p>
      {ads.length ? (
        <MarketAds ads={ads} state={state} action={tradeOnBitoCard(market, hrefFor)} />
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
