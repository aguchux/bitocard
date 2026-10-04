import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryLabels, type ProductCategory } from "@bitocard/api-client/storefront";
import { CatalogueView, loadCatalogue, readParams } from "@/components/store/catalogue";
import { storeNavigation } from "@/lib/navigation";

const isCategory = (slug: string): slug is ProductCategory => slug in categoryLabels;

/** A category (/catalogs/esim) or a menu group (/catalogs/mobile). */
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
  return { title: found.title, description: `Shop ${found.title.toLowerCase()} on BitoCard, delivered digitally.`, alternates: { canonical: `/catalogs/${slug}` } };
}

export default async function CataloguePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const found = await resolve(slug);
  if (!found) notFound();
  const filters = readParams(await searchParams);
  const [{ groups, countries }, { page, result }] = await Promise.all([storeNavigation(), loadCatalogue(found.base, filters)]);
  return (
    <CatalogueView
      path={`/catalogs/${slug}`}
      title={found.title}
      description={`Every ${found.title.toLowerCase()} product in store.`}
      params={filters}
      groups={groups}
      countries={countries}
      active={found.active}
      page={page}
      result={result}
    />
  );
}
