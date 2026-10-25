import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import type { ShopSearch } from "@bitocard/api-client/classifieds";
import { Results } from "@/components/results";
import { SearchBar } from "@/components/search-bar";
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
  return { title: q ? `“${q}” in ${market?.name ?? "BitoCard Shop"}` : `Search ${market?.name ?? "BitoCard Shop"}`, robots: noindexFollow, alternates: { canonical: `/${cc}/search` } };
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
  const where = place ? (place.area ? `${place.area.name}, ${place.state.name}` : place.state.name) : null;
  return (
    <>
      <section className="bg-navy-900 px-4 pb-4">
        <div className="mx-auto grid max-w-6xl gap-2.5">
          <SearchBar country={market.country} q={filters.q} area={filters.area} state={filters.state} autoFocus={!filters.q} />
          <Link href={`/${cc}/areas?next=${encodeURIComponent(`/${cc}/search${filters.q ? `?q=${encodeURIComponent(filters.q)}` : ""}`)}`} className="flex h-10 items-center gap-2 rounded-xl border border-navy-700 bg-navy-800 px-3 text-sm font-semibold text-white sm:max-w-sm">
            <MapPin className="size-4.5 text-brand-300" aria-hidden="true" />
            <span className="flex-1">{where ?? "Choose your area"}</span>
            <span className="text-[13px] font-medium text-navy-200">{where ? "Change" : "Near you first"}</span>
          </Link>
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-4">
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
