import Link from "next/link";
import { Search, X } from "lucide-react";
import { productFeatureLabels, type StoreCountry, type StoreList, type StoreNavigationGroup, type StoreProduct } from "@bitocard/api-client/storefront";
import { query, storeApi } from "@/lib/api";
import { featureIcon, filterFeatures, isFeature } from "./features";
import { ProductCard } from "./product-card";
import { CategoryIcon, GroupIcon } from "./category-icon";

export const pageSize = 24;

/** `features`: comma-separated product features every product must have (numbers that receive SMS, for example). */
export type CatalogueParams = { q?: string; country?: string; brand?: string; tag?: string; sort?: string; features?: string; page?: string };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads the catalogue filters from the address, ignoring anything malformed. */
export function readParams(search: Record<string, string | string[] | undefined>): CatalogueParams {
  const country = one(search.country)?.toLowerCase();
  const sort = one(search.sort);
  const page = one(search.page);
  const features = (one(search.features) ?? "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(isFeature);
  return {
    q: one(search.q)?.trim().slice(0, 100) || undefined,
    country: country && /^([a-z]{2}|global)$/.test(country) ? country : undefined,
    brand: one(search.brand)?.slice(0, 80) || undefined,
    tag: one(search.tag)?.toLowerCase().slice(0, 40) || undefined,
    sort: sort === "name" || sort === "new" ? sort : undefined,
    features: features.length ? [...new Set(features)].join(",") : undefined,
    page: page && /^\d{1,3}$/.test(page) && Number(page) > 1 ? page : undefined,
  };
}

/** A page of the catalogue: category or menu group, plus the filters in the address. */
export async function loadCatalogue(base: { category?: string; group?: string }, params: CatalogueParams) {
  const page = Number(params.page ?? 1);
  const result = await storeApi<StoreList<StoreProduct>>(
    `/v1/store/products${query({ ...base, q: params.q, country: params.country, brand: params.brand, tag: params.tag, sort: params.sort, features: params.features, limit: pageSize, offset: (page - 1) * pageSize })}`,
  );
  return { page, result };
}

/** The address for these filters with one changed (or removed with `undefined`); changing a filter goes back to page 1. */
export function hrefWith(path: string, params: CatalogueParams, change: Partial<CatalogueParams>) {
  const next = { ...params, page: undefined, ...change };
  return `${path}${query(next)}`;
}

/** Number filters: each chip switches one feature on or off (products must have every chosen feature). */
function FeatureFilters({ path, params }: { path: string; params: CatalogueParams }) {
  const chosen = new Set((params.features ?? "").split(",").filter(Boolean));
  return (
    <ul aria-label="Filter by what it can do" className="mt-4 flex flex-wrap gap-2">
      {filterFeatures.map(feature => {
        const Icon = featureIcon[feature];
        const on = chosen.has(feature);
        const next = new Set(chosen);
        if (on) next.delete(feature);
        else next.add(feature);
        return (
          <li key={feature}>
            <Link
              href={hrefWith(path, params, { features: next.size ? [...next].join(",") : undefined })}
              aria-current={on ? "true" : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition ${on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-[#070f4c]"}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {productFeatureLabels[feature]}
            </Link>
          </li>
        );
      })}
    </ul>
  );
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
  banner,
}: {
  path: string;
  title: string;
  description: string;
  params: CatalogueParams;
  groups: StoreNavigationGroup[];
  countries: StoreCountry[];
  active?: string;
  /** The category's banner (Storefront > Categories), shown above the title. */
  banner?: string | null;
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
    params.q ? { label: `“${params.q}”`, change: { q: undefined } } : null,
    params.country ? { label: params.country === "global" ? "Usable anywhere" : (countries.find(item => item.code.toLowerCase() === params.country)?.name ?? params.country.toUpperCase()), change: { country: undefined } } : null,
    params.brand ? { label: `Brand: ${params.brand}`, change: { brand: undefined } } : null,
    params.tag ? { label: params.tag.charAt(0).toUpperCase() + params.tag.slice(1), change: { tag: undefined } } : null,
  ].filter(Boolean) as Array<{ label: string; change: Partial<CatalogueParams> }>;

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="Catalogue" className="hidden lg:block">
          <Link href="/catalogs" aria-current={active === undefined ? "page" : undefined} className={`block rounded-lg px-3 py-2 font-semibold ${active === undefined ? "bg-pink-50 text-[#e0116d]" : "text-[#070f4c] hover:bg-slate-50"}`}>
            Everything
          </Link>
          {groups.map(group => {
            const href = `/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`;
            const current = path === `/catalogs/${group.key}`;
            return (
              <div key={group.key} className="mt-3">
                {/* Compact: the group's name (no icon), linking to the whole group, then its categories. */}
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`block rounded-md px-2 py-1 text-sm font-bold ${current ? "text-[#e0116d]" : "text-[#070f4c] hover:text-[#e0116d]"}`}
                >
                  {group.label}
                </Link>
                <ul className="mt-0.5 ml-2 border-l border-slate-200 pl-2">
                  {group.categories.map(category => (
                    <li key={category.category}>
                      <Link
                        href={`/catalogs/${category.category}`}
                        aria-current={active === category.category ? "page" : undefined}
                        className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${active === category.category ? "bg-pink-50 font-semibold text-[#e0116d]" : "text-slate-600 hover:bg-slate-50 hover:text-[#070f4c]"}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-5 rounded" ink="text-slate-500" tile="bg-slate-100" />
                          {category.label}
                        </span>
                        {category.on_sale ? (
                          <span className="text-xs text-slate-500">{category.products}</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Soon</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <form method="get" action={path} className="mt-0 grid grid-cols-2 gap-2 lg:mt-6 lg:grid-cols-1">
          {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
          {params.brand ? <input type="hidden" name="brand" value={params.brand} /> : null}
          {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
          {params.features ? <input type="hidden" name="features" value={params.features} /> : null}
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Country</span>
            <select name="country" defaultValue={params.country ?? ""} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 focus:outline-none">
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
            <select name="sort" defaultValue={params.sort ?? ""} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 focus:outline-none">
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
        {banner ? (
          // The banner as background, darkened on the left behind the title.
          <header className="relative isolate overflow-hidden rounded-2xl bg-[#070f4c] shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- banners uploaded by admins, served from the storage CDN */}
            <img src={banner} alt="" className="absolute inset-0 -z-10 size-full object-cover object-right" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(7,15,76,.92),rgba(7,15,76,.7)_45%,rgba(7,15,76,.15)_75%)]" />
            <div className="flex min-h-44 max-w-xl flex-col justify-center px-6 py-8 sm:min-h-56 sm:px-10">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">{title}</h1>
              <p className="mt-2 text-white/80 sm:text-lg">{description}</p>
            </div>
          </header>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-1 text-slate-500">{description}</p>
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 lg:hidden">
          {groups.map(group => (
            <Link key={group.key} href={`/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
              <GroupIcon group={group} className="size-7" />
              {group.label}
            </Link>
          ))}
        </div>
        {path === "/catalogs/virtual_numbers" || params.features ? (
          <FeatureFilters path={path} params={params} />
        ) : null}
        {chips.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Active filters">
            {chips.map(chip => (
              <li key={chip.label}>
                <Link href={hrefWith(path, params, chip.change)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-pink-50 px-3 text-sm font-semibold text-[#e0116d]">
                  {chip.label}
                  <X className="size-4" aria-label="Remove" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500" aria-live="polite">
            {result.ok ? `${total} ${total === 1 ? "product" : "products"}${params.q ? ` for “${params.q}”` : ""}` : "The catalogue is unavailable right now. Please try again shortly."}
          </p>
          {/* Search within this list; the other filters are kept. */}
          <form method="get" action={path} role="search" className="relative w-full sm:w-80">
            {params.country ? <input type="hidden" name="country" value={params.country} /> : null}
            {params.brand ? <input type="hidden" name="brand" value={params.brand} /> : null}
            {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
            {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
            {params.features ? <input type="hidden" name="features" value={params.features} /> : null}
            <label htmlFor="catalogue-search" className="sr-only">{`Search ${title.toLowerCase()}`}</label>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="catalogue-search"
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              autoComplete="off"
              placeholder={`Search ${title.toLowerCase()}…`}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pr-3 pl-10 text-sm text-[#070f4c] placeholder:text-slate-400 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 focus:outline-none"
            />
          </form>
        </div>
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
