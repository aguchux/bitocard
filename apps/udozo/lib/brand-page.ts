import { brandFeatureKey, brandPath, categoryPath, modelFeatureKey, placePath, type ShopBrandPage } from "@bitocard/api-client/classifieds";

/** A brand page's listings: one of its categories (or all), one of its models, a sort, and a page of `brandPageSize`. */
export type BrandFilters = { category: string | null; model: string | null; sort: BrandSort; page: number };
export const brandSorts = ["newest", "price_asc", "price_desc"] as const;
export type BrandSort = (typeof brandSorts)[number];
export const brandSortLabels: Record<BrandSort, string> = { newest: "Newest", price_asc: "Lowest price", price_desc: "Highest price" };
export const brandPageSize = 24;
/** Pages stop where the search stops (its offset limit). */
const lastPage = Math.floor(1000 / brandPageSize) + 1;
/** A brand's address: the registry's slugs. */
export const brandSlugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The address's choices, kept only when they are the brand's own categories and models here, and a known sort. */
export function readBrandFilters(params: Record<string, string | string[] | undefined>, page: Pick<ShopBrandPage, "categories" | "models">): BrandFilters {
  const category = one(params.category);
  const model = one(params.model)?.trim().toLowerCase();
  const sort = one(params.sort);
  const number = Number(one(params.page));
  return {
    category: category && page.categories.some(item => item.slug === category && item.listings > 0) ? category : null,
    model: model ? (page.models.find(item => item.name.toLowerCase() === model)?.name ?? null) : null,
    sort: (brandSorts as readonly string[]).includes(sort ?? "") ? (sort as BrandSort) : "newest",
    page: Number.isInteger(number) && number > 1 ? Math.min(number, lastPage) : 1,
  };
}

/** Whether the page is narrowed or paged (those views are `noindex`): only the brand's own page is indexed. */
export const isBrandFiltered = (params: Record<string, string | string[] | undefined>) => ["category", "model", "sort", "page"].some(key => params[key] !== undefined);

/** The search for one brand's live listings in a market. */
export function brandListingsQuery(country: string, slug: string, filters: BrandFilters) {
  const query = new URLSearchParams({ country: country.toUpperCase(), brand: slug, sort: filters.sort, limit: String(brandPageSize) });
  if (filters.category) query.set("category", filters.category);
  if (filters.model) query.append("f", `${modelFeatureKey}:${filters.model.toLowerCase()}`);
  if (filters.page > 1) query.set("offset", String((filters.page - 1) * brandPageSize));
  return `/v1/classifieds/listings?${query}`;
}

/** The brand page's address with other choices (the defaults left out), opening at the listings when it changes them. */
export function brandHref(country: string, slug: string, filters: BrandFilters, change: Partial<BrandFilters> = {}) {
  const changed = Object.keys(change).length > 0;
  // Another category, model or sort starts again at the first page; with no change, the address as it is.
  const next = { ...filters, ...(changed ? { page: 1 } : {}), ...change };
  const query = new URLSearchParams();
  if (next.category) query.set("category", next.category);
  if (next.model) query.set("model", next.model);
  if (next.sort !== "newest") query.set("sort", next.sort);
  if (next.page > 1) query.set("page", String(next.page));
  const search = query.toString();
  return `${brandPath(country, slug)}${search ? `?${search}` : ""}${changed ? "#listings" : ""}`;
}

/** The brand's listings in a category or state, on that page with its brand filter on (`?f=brand:hp`). */
export function brandIn(country: string, brand: Pick<ShopBrandPage, "name">, where: { category: string } | { state: string }) {
  const path = "category" in where ? categoryPath(country, where.category) : placePath(country, { state: where.state });
  return `${path}?${new URLSearchParams({ f: `${brandFeatureKey}:${brand.name.toLowerCase()}` })}`;
}

/** The figures under the brand's name. */
export function brandStats(page: Pick<ShopBrandPage, "listings" | "sellers" | "categories" | "states">) {
  const categories = page.categories.filter(item => item.listings > 0).length;
  const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;
  return [
    { key: "live", value: page.listings.toLocaleString("en-GB"), label: `${plural(page.listings, "Listing")} for sale` },
    { key: "sellers", value: page.sellers.toLocaleString("en-GB"), label: plural(page.sellers, "Seller") },
    { key: "categories", value: categories.toLocaleString("en-GB"), label: categories === 1 ? "Category" : "Categories" },
    { key: "states", value: page.states.length.toLocaleString("en-GB"), label: page.states.length === 1 ? "Place" : "Places" },
  ];
}

/** "Mobile phones, TVs and 3 more": what the brand is listed under, for the page's words. */
export function categoriesText(categories: ShopBrandPage["categories"], shown = 2) {
  const names = categories.slice(0, shown).map(item => item.name.toLowerCase());
  const rest = categories.length - names.length;
  if (!names.length) return null;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
}
