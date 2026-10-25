import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { placePath, type ShopSearch } from "@bitocard/api-client/classifieds";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { Results } from "@/components/results";
import { SearchBar } from "@/components/search-bar";
import { marketFor, shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { findCategory, findPlace } from "@/lib/places";
import { areasOf, categoriesOf } from "@/lib/reference";
import { indexFrom, isFiltered, readFilters, searchQuery } from "@/lib/search";
import { breadcrumbJsonLd, noindexFollow } from "@/lib/seo";

type Props = { params: Promise<{ cc: string; state: string; rest?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * What a location address names: `/ng/lagos`, `/ng/lagos/ikeja`, `/ng/lagos/mobile-phones` or
 * `/ng/lagos/ikeja/mobile-phones`. A second part is an area of the state when there is one by that name, else a
 * category; anything else is not found.
 */
async function resolve(cc: string, state: string, rest: string[] = []) {
  if (rest.length > 2) return null;
  const [states, categories] = await Promise.all([areasOf(cc), categoriesOf(cc)]);
  const [first, second] = rest;
  const asArea = first ? findPlace(states, state, first) : findPlace(states, state);
  if (!asArea) {
    if (second || !first) return null;
    const place = findPlace(states, state);
    const category = findCategory(categories, first);
    return place && category ? { place, category } : null;
  }
  if (!second) return { place: asArea, category: null };
  const category = findCategory(categories, second);
  return asArea.area && category ? { place: asArea, category } : null;
}

const where = (place: NonNullable<Awaited<ReturnType<typeof resolve>>>["place"]) => (place.area ? `${place.area.name}, ${place.state.name}` : place.state.name);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc, state, rest } = await params;
  const [market, found] = await Promise.all([marketFor(cc), resolve(cc, state, rest)]);
  if (!market || !found) return {};
  const path = placePath(cc, { state, area: found.place.area?.slug, category: found.category?.category.slug });
  const what = found.category?.category.name ?? "Things";
  const title = `${what} for sale in ${where(found.place)}`;
  const description = `${what} for sale in ${where(found.place)} on BitoCard Shop: listings near you first, chat with sellers and pay with Safe pay.`;
  // Indexed once the place itself has enough live listings (not counting the rest of the country shown after them);
  // thin pages and filtered views stay out of the index.
  const filtered = isFiltered(readFilters(await searchParams));
  const result = await shopApi<ShopSearch>(searchQuery(cc, readFilters({}), { state, area: found.place.area?.slug, category: found.category?.category.slug }));
  const tiers = result.ok ? result.data.tiers : null;
  const local = tiers ? (found.place.area ? tiers.area : tiers.area + tiers.nearby + tiers.state) : 0;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { url: path, title, description },
    ...(filtered || local < indexFrom ? { robots: noindexFollow } : {}),
  };
}

/** Listings in a state or area (and a category there), local first: the place itself, nearby, the state, the country. */
export default async function PlacePage({ params, searchParams }: Props) {
  const { cc, state, rest } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const found = await resolve(cc, state, rest);
  if (!found) notFound();
  const filters = readFilters(await searchParams);
  const category = found.category?.category ?? null;
  const result = await shopApi<ShopSearch>(searchQuery(cc, filters, { state, area: found.place.area?.slug, category: category?.slug }));
  const path = placePath(cc, { state, area: found.place.area?.slug, category: category?.slug });
  const trail = [
    { name: market.name, path: `/${cc}` },
    { name: found.place.state.name, path: placePath(cc, { state }) },
    ...(found.place.area ? [{ name: found.place.area.name, path: placePath(cc, { state, area: found.place.area.slug }) }] : []),
    ...(category ? [{ name: category.name, path }] : []),
  ];
  const areas = found.place.area ? [] : found.place.state.areas;
  return (
    <>
      <section className="bg-navy-900 px-4 pb-4">
        <div className="mx-auto max-w-6xl">
          <SearchBar country={market.country} q={filters.q} area={found.place.area?.slug} state={state} />
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-4">
        <Breadcrumbs trail={trail} />
        <h1 className="text-2xl font-extrabold tracking-tight">
          {category ? category.name : "For sale"} <span className="text-navy-500">in {where(found.place)}</span>
        </h1>
        {areas.length ? (
          <nav aria-label={`Areas in ${found.place.state.name}`} className="-mx-4 overflow-x-auto px-4">
            <ul className="flex gap-2 whitespace-nowrap">
              {areas.map(area => (
                <li key={area.slug}>
                  <Link href={placePath(cc, { state, area: area.slug, category: category?.slug })} className="flex h-9 items-center rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                    {area.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {result.ok ? (
          <Results result={result.data} filters={filters} path={path} category={category} place={{ area: found.place.area?.name, state: found.place.state.name, country: market.name }} currency={market.currency} />
        ) : (
          <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">Listings could not be loaded just now. Try again shortly.</p>
        )}
      </div>
      <JsonLd data={breadcrumbJsonLd(trail, siteOrigin())} />
    </>
  );
}
