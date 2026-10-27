import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketPage, marketMetadata, type Search } from "@/components/market-page";
import { marketAt, markets } from "@/lib/api";

type Props = { params: Promise<{ market: string }>; searchParams: Promise<Search> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const market = await marketAt((await params).market);
  return market ? marketMetadata(market, await searchParams) : {};
}

/** A country's market (`/ng`, `/gh`, `/ke`): only countries BitoCard Crypto shows, at their lower-case code. */
export default async function CountryMarketPage({ params, searchParams }: Props) {
  const [market, search, { assets }] = await Promise.all([params.then(value => marketAt(value.market)), searchParams, markets()]);
  if (!market) notFound();
  return <MarketPage market={market} assets={assets} search={search} />;
}
