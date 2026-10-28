import type { Metadata } from "next";
import { Suspense } from "react";
import { globalMarket } from "@afrippa/ui/market";
import { Header } from "@/components/header";
import { MarketPage, marketMetadata, type Search } from "@/components/market-page";
import { MarketsList, MarketsListSkeleton } from "@/components/markets-list";
import { marketAt, markets } from "@/lib/api";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const market = await marketAt(null);
  return market ? marketMetadata(market, await searchParams) : { alternates: { canonical: "/" } };
}

/**
 * The root: the global market (US dollars, across countries) while it is open; until then, the country markets shown.
 * The market itself is read first (cached), so a market that is not open never streams a page that turns into a 404.
 */
export default async function GlobalMarketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [market, search, { assets }] = await Promise.all([marketAt(null), searchParams, markets()]);
  if (market) return <MarketPage market={market} assets={assets} search={search} />;
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-navy-900 sm:text-4xl">Buy and sell crypto with people</h1>
          <p className="mt-1 text-slate-600">Choose a market. You pay each other directly; the coins are held until the seller is paid.</p>
        </div>
        <Suspense fallback={<MarketsListSkeleton />}>
          <MarketsList title="Markets" />
        </Suspense>
      </main>
    </>
  );
}
