import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryPath, type ShopSearch } from "@bitocard/api-client/classifieds";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CategoryHero, SubcategoryPills } from "@/components/category-hero";
import { JsonLd } from "@/components/json-ld";
import { Results } from "@/components/results";
import { marketFor, markets, shopApi } from "@/lib/api";
import { brandFilters, modelFilters } from "@/lib/brands";
import { siteOrigin } from "@/lib/customer";
import { findCategory } from "@/lib/places";
import { categoriesOf } from "@/lib/reference";
import { isFiltered, readFilters, searchQuery } from "@/lib/search";
import { breadcrumbJsonLd, itemListJsonLd, noindexFollow, regionalAlternates } from "@/lib/seo";

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
  const [result, brands, models] = await Promise.all([shopApi<ShopSearch>(searchQuery(cc, filters, { category: slug })), brandFilters(found.category, found.children, market.country), modelFilters(found.category, filters, market.country)]);
  const path = categoryPath(cc, slug);
  const trail = [
    { name: market.name, path: `/${cc}` },
    ...(found.top.slug !== slug ? [{ name: found.top.name, path: categoryPath(cc, found.top.slug) }] : []),
    { name: found.category.name, path },
  ];
  return (
    <>
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 sm:px-6 lg:px-8 pt-4">
        <Breadcrumbs trail={trail} />
        <CategoryHero category={found.category} top={found.top} place={market.name} listings={result.ok ? result.data.total : null} eyebrow={found.top.slug !== slug ? found.top.name : null} />
        <SubcategoryPills country={cc} items={found.top.children} current={slug} />
        {result.ok ? (
          <Results result={result.data} filters={filters} path={path} category={found.category} brands={brands} models={models} place={{ country: market.name }} currency={market.currency} />
        ) : (
          <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">{result.status === 400 ? "Those filters do not work here. Clear them and try again." : "Listings could not be loaded just now. Try again shortly."}</p>
        )}
      </div>
      <JsonLd data={breadcrumbJsonLd(trail, siteOrigin())} />
      {result.ok && result.data.data.length ? <JsonLd data={itemListJsonLd(`${found.category.name} for sale in ${market.name}`, result.data.data, siteOrigin(), cc)} /> : null}
    </>
  );
}
