import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ShopSearch } from "@bitocard/api-client/classifieds";
import { Results } from "@/components/results";
import { marketFor, shopApi } from "@/lib/api";
import { findPlace } from "@/lib/places";
import { areasOf } from "@/lib/reference";
import { readFilters, searchQuery } from "@/lib/search";
import { noindexFollow } from "@/lib/seo";

type Props = { params: Promise<{ cc: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc } = await params;
  const market = await marketFor(cc);
  const { q } = readFilters(await searchParams);
  return { title: q ? `“${q}” in ${market?.name ?? "Udozo"}` : `Search ${market?.name ?? "Udozo"}`, robots: noindexFollow, alternates: { canonical: `/${cc}/search` } };
}

/** Search results in the country, local first when the buyer chose an area. Never indexed. */
export default async function SearchPage({ params, searchParams }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const filters = readFilters(await searchParams);
  const [result, states] = await Promise.all([shopApi<ShopSearch>(searchQuery(cc, filters)), areasOf(cc)]);
  const place = filters.state ? findPlace(states, filters.state, filters.area) : null;
  // The area is chosen with Near me in the header's search bar.
  return (
    <>
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 sm:px-6 lg:px-8 pt-4">
        <h1 className="text-2xl font-extrabold tracking-tight">{filters.q ? `Results for “${filters.q}”` : `Everything in ${market.name}`}</h1>
        {result.ok ? (
          <Results result={result.data} filters={filters} path={`/${cc}/search`} category={null} place={{ area: place?.area?.name, state: place?.state.name, country: market.name }} currency={market.currency} />
        ) : (
          <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">Listings could not be loaded just now. Try again shortly.</p>
        )}
      </div>
    </>
  );
}
