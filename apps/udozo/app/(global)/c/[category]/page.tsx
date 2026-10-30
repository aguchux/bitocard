import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { categoryPath, type ShopShowcase } from "@bitocard/api-client/classifieds";
import { Flag } from "@/components/flag";
import { ListingGrid } from "@/components/listing-card";
import { markets, shopApi } from "@/lib/api";
import { regionalAlternates } from "@/lib/seo";

type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const [all, showcase] = await Promise.all([markets(), shopApi<ShopShowcase>(`/v1/classifieds/showcase?category=${encodeURIComponent(category)}`)]);
  if (!showcase.ok || !showcase.data.category) return {};
  const name = showcase.data.category.name;
  // This page is the x-default of each country's own category page (`/ng/c/<category>`), which carries the prices.
  return {
    title: `${name} for sale across Africa`,
    description: `${name} for sale in ${all.data.map(market => market.name).join(", ")} on BitoCard Shop.`,
    alternates: { canonical: `/c/${category}`, languages: regionalAlternates(all.data.filter(market => showcase.data.categories.find(row => row.slug === category)?.countries.includes(market.country)), all.showcase, code => categoryPath(code, category), `/c/${category}`) },
  };
}

/** A category across countries (from the second country): a section per country, never a price, each linking into it. */
export default async function GlobalCategory({ params }: Props) {
  const { category } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(category)) notFound();
  const all = await markets();
  if (!all.showcase) {
    if (all.data.length === 1) redirect(categoryPath(all.data[0]!.country, category));
    notFound();
  }
  const showcase = await shopApi<ShopShowcase>(`/v1/classifieds/showcase?category=${encodeURIComponent(category)}`);
  if (!showcase.ok || !showcase.data.category || !showcase.data.sections) notFound();
  return (
    <div className="mx-auto grid max-w-[1400px] gap-8 px-4 sm:px-6 lg:px-8 pt-5">
      <h1 className="text-2xl font-extrabold tracking-tight">{showcase.data.category.name} across Africa</h1>
      {showcase.data.sections.map(section => (
        <section key={section.country} aria-labelledby={`in-${section.country}`}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id={`in-${section.country}`} className="flex items-center gap-2 text-base font-bold">
              <Flag country={section.country} /> {section.name}
              <span className="text-sm font-medium text-navy-500">{section.listings.toLocaleString("en-GB")}</span>
            </h2>
            <Link href={categoryPath(section.country, category)} className="text-[13px] font-semibold text-brand-700 hover:underline">
              See prices in {section.name}
            </Link>
          </div>
          {section.cards.length ? <ListingGrid cards={section.cards} /> : <p className="text-sm text-navy-600">Nothing listed here yet.</p>}
        </section>
      ))}
    </div>
  );
}
