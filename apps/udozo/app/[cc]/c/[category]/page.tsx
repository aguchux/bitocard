import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryPath, type ShopSearch } from "@bitocard/api-client/classifieds";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { Results } from "@/components/results";
import { SearchBar } from "@/components/search-bar";
import { marketFor, markets, shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { findCategory } from "@/lib/places";
import { categoriesOf } from "@/lib/reference";
import { isFiltered, readFilters, searchQuery } from "@/lib/search";
import { breadcrumbJsonLd, noindexFollow, regionalAlternates } from "@/lib/seo";

type Props = { params: Promise<{ cc: string; category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc, category: slug } = await params;
  const [market, all, categories] = await Promise.all([marketFor(cc), markets(), categoriesOf(cc)]);
  const found = findCategory(categories, slug);
  if (!market || !found) return {};
  const title = `${found.category.name} for sale in ${market.name}`;
  const description = `${found.category.name} for sale across ${market.name} on Udozo: chat with sellers near you and pay with Safe pay.`;
  return {
    title,
    description,
    alternates: { canonical: categoryPath(cc, slug), languages: regionalAlternates(all.data, all.showcase, code => categoryPath(code, slug), found.top.slug === slug ? `/c/${slug}` : null) },
    openGraph: { url: categoryPath(cc, slug), title, description },
    ...(isFiltered(readFilters(await searchParams)) ? { robots: noindexFollow } : {}),
  };
}

/** A category's listings in the country, with its subcategories, filters and the category's feature filters. */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { cc, category: slug } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const found = findCategory(await categoriesOf(cc), slug);
  if (!found) notFound();
  const filters = readFilters(await searchParams);
  const result = await shopApi<ShopSearch>(searchQuery(cc, filters, { category: slug }));
  const path = categoryPath(cc, slug);
  const trail = [
    { name: market.name, path: `/${cc}` },
    ...(found.top.slug !== slug ? [{ name: found.top.name, path: categoryPath(cc, found.top.slug) }] : []),
    { name: found.category.name, path },
  ];
  return (
    <>
      <section className="bg-navy-900 pt-5 pb-4">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <SearchBar country={market.country} q={filters.q} area={filters.area} state={filters.state} />
        </div>
      </section>
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 sm:px-6 lg:px-8 pt-4">
        <Breadcrumbs trail={trail} />
        <h1 className="text-2xl font-extrabold tracking-tight">
          {found.category.name} <span className="text-navy-500">in {market.name}</span>
        </h1>
        {found.children.length ? (
          <nav aria-label="Subcategories" className="-mx-4 overflow-x-auto px-4">
            <ul className="flex gap-2 whitespace-nowrap">
              {found.children.map(child => (
                <li key={child.slug}>
                  <Link href={categoryPath(cc, child.slug)} className="flex h-9 items-center rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {result.ok ? (
          <Results result={result.data} filters={filters} path={path} category={found.category} place={{ country: market.name }} currency={market.currency} />
        ) : (
          <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">{result.status === 400 ? "Those filters do not work here. Clear them and try again." : "Listings could not be loaded just now. Try again shortly."}</p>
        )}
      </div>
      <JsonLd data={breadcrumbJsonLd(trail, siteOrigin())} />
    </>
  );
}
