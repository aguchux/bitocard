import Link from "next/link";
import { X } from "lucide-react";
import type { StoreCountry, StoreList, StoreNavigationGroup, StoreProduct } from "@bitocard/api-client/storefront";
import { query, storeApi } from "@/lib/api";
import { ProductCard } from "./product-card";

export const pageSize = 24;

export type CatalogueParams = { country?: string; brand?: string; tag?: string; sort?: string; page?: string };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads the catalogue filters from the address, ignoring anything malformed. */
export function readParams(search: Record<string, string | string[] | undefined>): CatalogueParams {
  const country = one(search.country)?.toLowerCase();
  const sort = one(search.sort);
  const page = one(search.page);
  return {
    country: country && /^([a-z]{2}|global)$/.test(country) ? country : undefined,
    brand: one(search.brand)?.slice(0, 80) || undefined,
    tag: one(search.tag)?.toLowerCase().slice(0, 40) || undefined,
    sort: sort === "name" || sort === "new" ? sort : undefined,
    page: page && /^\d{1,3}$/.test(page) && Number(page) > 1 ? page : undefined,
  };
}

/** A page of the catalogue: category or menu group, plus the filters in the address. */
export async function loadCatalogue(base: { category?: string; group?: string }, params: CatalogueParams) {
  const page = Number(params.page ?? 1);
  const result = await storeApi<StoreList<StoreProduct>>(
    `/v1/store/products${query({ ...base, country: params.country, brand: params.brand, tag: params.tag, sort: params.sort, limit: pageSize, offset: (page - 1) * pageSize })}`,
  );
  return { page, result };
}

/** The address for these filters with one changed (or removed with `undefined`); changing a filter goes back to page 1. */
export function hrefWith(path: string, params: CatalogueParams, change: Partial<CatalogueParams>) {
  const next = { ...params, page: undefined, ...change };
  return `${path}${query(next)}`;
}

export function CatalogueView({
  path,
  title,
  description,
  params,
  groups,
  countries,
  active,
  page,
  result,
}: {
  path: string;
  title: string;
  description: string;
  params: CatalogueParams;
  groups: StoreNavigationGroup[];
  countries: StoreCountry[];
  active?: string;
  page: number;
  result: Awaited<ReturnType<typeof loadCatalogue>>["result"];
}) {
  const products = result.ok ? result.data.data : [];
  // A category or menu group with nothing open yet says so, instead of "nothing matches".
  const slug = path.replace(/^\/catalogs\/?/, "");
  const every = groups.flatMap(group => group.categories);
  const scope = !slug ? every : (groups.find(group => group.key === slug)?.categories ?? every.filter(category => category.category === slug));
  const comingSoon = path.startsWith("/catalogs") && products.length === 0 && !scope.some(category => category.on_sale);
  const total = result.ok ? (result.data.total ?? products.length) : 0;
  const chips = [
    params.country ? { label: params.country === "global" ? "Usable anywhere" : (countries.find(item => item.code.toLowerCase() === params.country)?.name ?? params.country.toUpperCase()), change: { country: undefined } } : null,
    params.brand ? { label: `Brand: ${params.brand}`, change: { brand: undefined } } : null,
    params.tag ? { label: params.tag, change: { tag: undefined } } : null,
  ].filter(Boolean) as Array<{ label: string; change: Partial<CatalogueParams> }>;

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="Catalogue" className="hidden lg:block">
          <Link href="/catalogs" aria-current={active === undefined ? "page" : undefined} className={`block rounded-lg px-3 py-2 font-semibold ${active === undefined ? "bg-pink-50 text-[#e0116d]" : "text-[#070f4c] hover:bg-slate-50"}`}>
            Everything
          </Link>
          {groups.map(group => (
            <div key={group.key} className="mt-3">
              <p className="px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group.label}</p>
              <ul>
                {group.categories.map(category => (
                  <li key={category.category}>
                    <Link
                      href={`/catalogs/${category.category}`}
                      aria-current={active === category.category ? "page" : undefined}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${active === category.category ? "bg-pink-50 font-semibold text-[#e0116d]" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      {category.label}
                      <span className="text-xs text-slate-500">{category.on_sale ? category.products : "Soon"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <form method="get" action={path} className="mt-0 grid grid-cols-2 gap-2 lg:mt-6 lg:grid-cols-1">
          {params.brand ? <input type="hidden" name="brand" value={params.brand} /> : null}
          {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Country</span>
            <select name="country" defaultValue={params.country ?? ""} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3">
              <option value="">All countries</option>
              <option value="global">Usable anywhere</option>
              {countries.map(item => (
                <option key={item.code} value={item.code.toLowerCase()}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Sort by</span>
            <select name="sort" defaultValue={params.sort ?? ""} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3">
              <option value="">Most popular</option>
              <option value="name">Name</option>
              <option value="new">Newest</option>
            </select>
          </label>
          <button type="submit" className="col-span-2 min-h-11 rounded-xl bg-[#070f4c] font-semibold text-white hover:bg-[#121a6b] lg:col-span-1">
            Apply
          </button>
        </form>
      </aside>

      <div className="min-w-0">
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-1 text-slate-500">{description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 lg:hidden">
          {groups.map(group => (
            <Link key={group.key} href={`/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
              {group.label}
            </Link>
          ))}
        </div>
        {chips.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Active filters">
            {chips.map(chip => (
              <li key={chip.label}>
                <Link href={hrefWith(path, params, chip.change)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-pink-50 px-3 text-sm font-semibold capitalize text-[#e0116d]">
                  {chip.label}
                  <X className="size-4" aria-label="Remove" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-4 text-sm text-slate-500" aria-live="polite">
          {result.ok ? `${total} ${total === 1 ? "product" : "products"}` : "The catalogue is unavailable right now. Please try again shortly."}
        </p>
        {products.length ? (
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {products.map(product => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        ) : result.ok ? (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">
            {comingSoon ? `${title} are coming soon to BitoCard. Check back shortly.` : "Nothing matches these filters yet."}
          </p>
        ) : null}
        {result.ok && (page > 1 || result.data.has_more) ? (
          <nav aria-label="Pages" className="mt-8 flex items-center justify-between">
            {page > 1 ? (
              <Link href={`${path}${query({ ...params, page: page > 2 ? String(page - 1) : undefined })}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold hover:bg-slate-50">
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-slate-500">Page {page}</span>
            {result.data.has_more ? (
              <Link href={`${path}${query({ ...params, page: String(page + 1) })}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold hover:bg-slate-50">
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
