import type { Metadata } from "next";
import Link from "next/link";
import type { StoreSearch } from "@bitocard/api-client/storefront";
import { SearchForm } from "@/components/store/layout";
import { BrandArt, ProductCard } from "@/components/store/product-card";
import { CategoryIcon, categoryArt } from "@/components/store/category-icon";
import { query, storeApi } from "@/lib/api";
import { storeNavigation } from "@/lib/navigation";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Everything matching the search: categories, brands, countries and products, best matches first. */
export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const q = one(search.q).trim().slice(0, 100);
  const country = one(search.country).toLowerCase();
  const validCountry = /^([a-z]{2}|global)$/.test(country) ? country : "";
  const [{ countries, groups }, result] = await Promise.all([storeNavigation(), q ? storeApi<StoreSearch>(`/v1/store/search${query({ q, country: validCountry, limit: 36 })}`) : null]);
  const data = result?.ok ? result.data : null;
  const art = categoryArt(groups);
  const found = data ? data.products.length + data.brands.length + data.categories.length + data.countries.length : 0;

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-[#060b3a] p-5 sm:p-8">
        <h1 className="font-display mb-4 text-2xl font-extrabold text-white sm:text-3xl">{q ? `Results for “${q}”` : "Search the store"}</h1>
        <SearchForm countries={countries} q={q} country={validCountry} size="md" />
      </div>
      {!q ? (
        <p className="text-slate-500">Search for a brand, a company, a product, a category or a country, for example Amazon, top up, electricity or Nigeria.</p>
      ) : result && !result.ok ? (
        <p className="text-slate-500">Search is unavailable right now. Please try again shortly.</p>
      ) : found === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">
          Nothing matches {`“${q}”`}. Try a brand name, or browse the{" "}
          <Link href="/catalogs" className="font-semibold text-[#e0116d] underline">
            catalogue
          </Link>
          .
        </p>
      ) : data ? (
        <>
          {data.categories.length || data.countries.length ? (
            <section aria-label="Categories and countries">
              <ul className="flex flex-wrap gap-2">
                {data.categories.map(category => {
                  return (
                    <li key={category.category}>
                      <Link href={`/catalogs/${category.category}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 font-semibold hover:border-slate-300">
                        <CategoryIcon category={category.category} iconUrl={art.get(category.category)?.icon} className="size-5" />
                        {category.label}
                        <span className="text-sm font-normal text-slate-500">{category.products}</span>
                      </Link>
                    </li>
                  );
                })}
                {data.countries.map(item => (
                  <li key={item.code}>
                    <Link href={`/catalogs?country=${item.code.toLowerCase()}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 font-semibold hover:border-slate-300">
                      {item.name}
                      <span className="text-sm font-normal text-slate-500">{item.products}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.brands.length ? (
            <section aria-labelledby="brands-heading">
              <h2 id="brands-heading" className="font-display mb-3 text-xl font-extrabold">
                Brands
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {data.brands.map(brand => (
                  <li key={brand.slug}>
                    <Link href={`/catalogs?brand=${encodeURIComponent(brand.slug)}`} className="block overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md">
                      <div className="aspect-[16/9]">
                        <BrandArt brand={brand} className="text-base" />
                      </div>
                      <p className="truncate px-3 py-2 text-sm font-bold">{brand.name}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.products.length ? (
            <section aria-labelledby="products-heading">
              <h2 id="products-heading" className="font-display mb-3 text-xl font-extrabold">
                Products
              </h2>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.products.map(product => (
                  <li key={product.id}>
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
