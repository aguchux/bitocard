import type { ShopCondition, ShopSort } from "@bitocard/api-client/classifieds";

/** Results per page. */
export const perPage = 24;
/** The API stops at this offset: pages past it are not offered. */
export const maxOffset = 1000;
/** A location page is indexed once it has this many live listings (thinner ones are `noindex, follow`). */
export const indexFrom = 5;

const conditionValues: ShopCondition[] = ["new", "used", "untested", "parts"];
const sortValues: ShopSort[] = ["relevant", "newest", "price_asc", "price_desc"];
const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What a results page's address asks for. Prices are in the currency's main unit (naira), as buyers type them. */
export type ShopFilters = {
  q: string;
  priceMin: number | null;
  priceMax: number | null;
  condition: ShopCondition[];
  /** Feature filters as the API takes them: `storage:128..256`, `brand:apple,samsung`. */
  features: string[];
  sort: ShopSort | null;
  page: number;
  /** The buyer's area and its state, for local-first results (search pages; location pages carry them in the path). */
  area: string | null;
  state: string | null;
};

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const many = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const amount = (value: string | string[] | undefined) => {
  const text = one(value).replace(/[,\s]/g, "");
  return /^\d{1,13}$/.test(text) ? Number(text) : null;
};

/**
 * Feature filters from the filters form, which cannot write `f=storage:128..256` itself: `f.storage.min` and
 * `f.storage.max` for numbers, `f.brand` (repeated, or comma separated) for choices and words, `f.<key>=yes` for yes or no.
 */
function formFeatures(params: Params) {
  const ranges = new Map<string, { min?: string; max?: string }>();
  const values = new Map<string, string[]>();
  for (const [name, value] of Object.entries(params)) {
    const match = /^f\.([a-z0-9_]{1,60})(?:\.(min|max))?$/.exec(name);
    if (!match) continue;
    const key = match[1]!;
    if (match[2]) {
      const number = one(value).replace(/[,\s]/g, "");
      if (/^\d{1,12}(\.\d{1,4})?$/.test(number)) ranges.set(key, { ...ranges.get(key), [match[2]]: number });
    } else {
      const chosen = many(value).flatMap(item => item.split(",")).map(item => item.trim()).filter(item => item && !item.includes(":") && item.length <= 60);
      if (chosen.length) values.set(key, [...(values.get(key) ?? []), ...chosen]);
    }
  }
  return [
    ...[...ranges].map(([key, range]) => `${key}:${range.min ?? ""}..${range.max ?? ""}`),
    ...[...values].map(([key, chosen]) => `${key}:${[...new Set(chosen)].join(",")}`),
  ];
}

/** Reads the filters from a page's search params, dropping anything malformed instead of failing the page. */
export function readFilters(params: Params): ShopFilters {
  const page = Number(one(params.page));
  return {
    q: one(params.q).trim().slice(0, 100),
    priceMin: amount(params.min),
    priceMax: amount(params.max),
    condition: many(params.condition)
      .flatMap(item => item.split(","))
      .filter((item): item is ShopCondition => (conditionValues as string[]).includes(item)),
    features: [...many(params.f), ...formFeatures(params)]
      .filter(item => /^[a-z0-9_]{1,60}:[^:]{1,100}$/.test(item))
      .filter((item, index, all) => all.findIndex(other => other.split(":")[0] === item.split(":")[0]) === index)
      .slice(0, 10),
    sort: (sortValues as string[]).includes(one(params.sort)) ? (one(params.sort) as ShopSort) : null,
    page: Number.isInteger(page) && page > 1 && (page - 1) * perPage <= maxOffset ? page : 1,
    area: slug.test(one(params.area)) ? one(params.area) : null,
    state: slug.test(one(params.state)) ? one(params.state) : null,
  };
}

/** A feature filter's parts: its key and, for numbers, the range; for others, the chosen values. */
export function featureFilter(filters: ShopFilters, key: string) {
  const raw = filters.features.find(item => item.startsWith(`${key}:`));
  if (!raw) return null;
  const value = raw.slice(key.length + 1);
  const range = /^([\d.]*)\.\.([\d.]*)$/.exec(value);
  return range ? { min: range[1] || null, max: range[2] || null, values: [] as string[] } : { min: null, max: null, values: value.split(",") };
}

/** How many filters narrow the results (the Filters button's count): words and sort do not count. */
export function filterCount(filters: ShopFilters) {
  return (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0) + (filters.condition.length ? 1 : 0) + filters.features.length;
}

/** Whether a page is a plain listing of a place or category (indexed) rather than a search or a filtered view (noindex). */
export function isFiltered(filters: ShopFilters) {
  return Boolean(filters.q || filterCount(filters) || filters.sort || filters.page > 1 || filters.area || filters.state);
}

/** The API's search query for these filters in a country, with the page's own category and place. */
export function searchQuery(country: string, filters: ShopFilters, place: { category?: string | null; state?: string | null; area?: string | null } = {}) {
  const params = new URLSearchParams({ country: country.toUpperCase() });
  if (filters.q) params.set("q", filters.q);
  if (place.category) params.set("category", place.category);
  const state = place.state ?? filters.state;
  const area = place.area ?? (place.state ? null : filters.area);
  if (area) params.set("area", area);
  if (state) params.set("state", state);
  if (filters.priceMin !== null) params.set("price_min", String(filters.priceMin * 100));
  if (filters.priceMax !== null) params.set("price_max", String(filters.priceMax * 100));
  if (filters.condition.length) params.set("condition", filters.condition.join(","));
  for (const feature of filters.features) params.append("f", feature);
  if (filters.sort) params.set("sort", filters.sort);
  params.set("offset", String((filters.page - 1) * perPage));
  params.set("limit", String(perPage));
  return `/v1/classifieds/listings?${params}`;
}

/** The same page with some filters changed (a new filter goes back to the first page). */
export function filtersHref(path: string, filters: ShopFilters, change: Partial<ShopFilters> = {}) {
  const next = { ...filters, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.area) params.set("area", next.area);
  if (next.state) params.set("state", next.state);
  if (next.priceMin !== null) params.set("min", String(next.priceMin));
  if (next.priceMax !== null) params.set("max", String(next.priceMax));
  if (next.condition.length) params.set("condition", next.condition.join(","));
  for (const feature of next.features) params.append("f", feature);
  if (next.sort) params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
