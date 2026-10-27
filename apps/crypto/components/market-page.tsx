import { Suspense } from "react";
import type { Metadata } from "next";
import type { CryptoMarket } from "@bitocard/api-client/crypto";
import { globalMarket, marketState, type MarketState } from "@bitocard/crypto-ui/market";
import { MarketFilters } from "@bitocard/crypto-ui/market-view";
import { InstallPrompt } from "@bitocard/ui/install-ui";
import { BookSkeleton, MarketBook } from "@/components/book";
import { Header } from "@/components/header";
import { MarketsList, MarketsListSkeleton } from "@/components/markets-list";
import { marketPath } from "@/lib/api";

export type Search = Record<string, string | string[] | undefined>;

/** A market's title: "Global crypto market", or the country's. */
export const marketTitle = (market: CryptoMarket) => (market.market === globalMarket ? "Global crypto market" : `${market.name} crypto market`);

/** The market's filters from the address: on the market's own page (`/`, `/ng`), in its currencies. */
export const pageState = (market: CryptoMarket, assets: string[], search: Search): MarketState =>
  marketState({ ...search, market: undefined }, assets, market.currencies[0] ?? "USD", { path: marketPath(market.market), markets: [{ market: market.market, name: market.name, currencies: market.currencies, home: true }] });

/**
 * A market page's metadata: its own canonical address; filtered views (an amount, a trader, experienced, another
 * order or view) are `noindex, follow`, so search engines keep one page per market, coin, side and currency.
 */
export function marketMetadata(market: CryptoMarket, search: Search): Metadata {
  const title = marketTitle(market);
  const where = market.market === globalMarket ? "across countries, in US dollars" : `in ${market.name}, in ${market.currencies.join(" or ")}`;
  const description = `Buy and sell USDT, BTC and more with other people ${where}. Instant trades paid from BitoCard wallets, with nicknames only.`;
  const filtered = ["amount", "q", "experienced", "sort", "view"].some(key => search[key]);
  return {
    title,
    description,
    alternates: { canonical: marketPath(market.market) },
    openGraph: { title, description, url: marketPath(market.market) },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * A market's page, put together from small parts that each read their own cached data and stream in: the header's
 * market tabs, the book (under the filters, keyed by them, so a new filter shows its placeholder) and the other markets.
 */
export function MarketPage({ market, assets, search }: { market: CryptoMarket; assets: string[]; search: Search }) {
  const state = pageState(market, assets, search);
  return (
    <>
      <Header current={market.market} />
      <main id="main" className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-navy-900 sm:text-4xl">{marketTitle(market)}</h1>
          <p className="mt-1 text-slate-600">
            {market.market === globalMarket
              ? "Trade with people across BitoCard's countries, in US dollars."
              : `Trade with people in ${market.name}, in ${market.currencies.join(" or ")}.`}{" "}
            Instant trades, paid from BitoCard wallets.
          </p>
        </div>
        <MarketFilters state={state} assets={assets} currencies={market.currencies} />
        <Suspense key={`${state.asset}-${state.side}-${state.currency}-${state.amount}-${state.q}`} fallback={<BookSkeleton />}>
          <MarketBook market={market.market} name={market.market === globalMarket ? "the global market" : market.name} state={state} />
        </Suspense>
        <p className="text-xs text-slate-500">Prices are set by traders, not BitoCard. Trades settle at once from BitoCard wallets; BitoCard&apos;s fee comes out of the crypto received and is shown before you confirm.</p>
        <Suspense fallback={<MarketsListSkeleton />}>
          <MarketsList current={market.market} />
        </Suspense>
      </main>
      {/* Where an admin switched it on for this market (`crypto_install_prompt`). */}
      <InstallPrompt enabled={market.install_prompt} appName="BitoCard Crypto" />
    </>
  );
}
