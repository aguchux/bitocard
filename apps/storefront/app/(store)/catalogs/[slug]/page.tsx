import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryLabels, type ProductCategory, type ProductCountry, type StoreList } from "@bitocard/api-client/storefront";
import { CatalogueView, loadCatalogue, readParams } from "@/components/store/catalogue";
import { storeNavigation } from "@/lib/navigation";
import { storeApi } from "@/lib/api";
import { inMarket } from "@/lib/market";

const isCategory = (slug: string): slug is ProductCategory => slug in categoryLabels;

/** A category (/catalogs/software) or a menu group (/catalogs/mobile). */
async function resolve(slug: string) {
  if (isCategory(slug)) return { base: { category: slug }, title: categoryLabels[slug], active: slug };
  const { groups } = await storeNavigation();
  const group = groups.find(item => item.key === slug);
  return group ? { base: { group: group.key }, title: group.label, active: group.categories[0]?.category } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await resolve(slug);
  if (!found) return {};
  return { title: found.title, description: `Shop ${found.title.toLowerCase()}, delivered digitally.`, alternates: { canonical: `/catalogs/${slug}` } };
}

export default async function CataloguePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const found = await resolve(slug);
  if (!found) notFound();
  const filters = readParams(await searchParams);
  const [{ groups, countries: marketCountries }, { page, result }, cardCountries] = await Promise.all([
    storeNavigation(),
    loadCatalogue(found.base, filters),
    slug === 'gift_cards' ? storeApi<StoreList<ProductCountry>>(await inMarket('/v1/store/gift-card-countries')).then(response => response.ok ? response.data.data : []) : Promise.resolve([]),
  ]);
  const countries = slug === 'gift_cards' ? cardCountries.map(item => ({ ...item, currency: '', products: 0 })) : marketCountries;
  return (
    <CatalogueView
      path={`/catalogs/${slug}`}
      title={found.title}
      description={`Every ${found.title.toLowerCase()} product in store.`}
      params={filters}
      groups={groups}
      countries={countries}
      active={found.active}
      banner={(isCategory(slug) ? groups.flatMap(group => group.categories).filter(category => category.category === slug) : (groups.find(group => group.key === slug)?.categories ?? [])).find(category => category.image_url)?.image_url ?? null}
      page={page}
      result={result}
    />
  );
}
