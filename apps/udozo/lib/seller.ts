import { sellerPath, usernamePattern, type ShopSellerProfile } from "@bitocard/api-client/classifieds";

/** A seller's random handle (10 characters today; 6 to 12 accepted). */
export const handlePattern = /^[a-z0-9]{6,12}$/;

/** Whether an address can name a seller page: their username (`usernamePattern`) or their handle. The API decides which. */
export const isSellerKey = (key: string) => usernamePattern.test(key) || handlePattern.test(key);

/** The page's query string again (`?category=tvs&sort=…`), for a redirect that keeps it; empty when there is none. */
export function queryString(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** A seller page's listings: one category of theirs (or all), a sort, and a page of `sellerPageSize`. */
export type SellerFilters = { category: string | null; sort: SellerSort; page: number };
export const sellerSorts = ["newest", "price_asc", "price_desc"] as const;
export type SellerSort = (typeof sellerSorts)[number];
export const sellerSortLabels: Record<SellerSort, string> = { newest: "Newest", price_asc: "Lowest price", price_desc: "Highest price" };
export const sellerPageSize = 24;
/** Pages stop where the search stops (its offset limit). */
const lastPage = Math.floor(1000 / sellerPageSize) + 1;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The address's choices, kept only when they are the seller's own categories and a known sort. */
export function readSellerFilters(params: Record<string, string | string[] | undefined>, profile: Pick<ShopSellerProfile, "categories">): SellerFilters {
  const category = one(params.category);
  const sort = one(params.sort);
  const page = Number(one(params.page));
  return {
    category: category && profile.categories.some(item => item.slug === category) ? category : null,
    sort: (sellerSorts as readonly string[]).includes(sort ?? "") ? (sort as SellerSort) : "newest",
    page: Number.isInteger(page) && page > 1 ? Math.min(page, lastPage) : 1,
  };
}

/** The search for one seller's live listings. */
export function sellerListingsQuery(country: string, handle: string, filters: SellerFilters) {
  const query = new URLSearchParams({ country: country.toUpperCase(), seller: handle, sort: filters.sort, limit: String(sellerPageSize) });
  if (filters.category) query.set("category", filters.category);
  if (filters.page > 1) query.set("offset", String((filters.page - 1) * sellerPageSize));
  return `/v1/classifieds/listings?${query}`;
}

/** The seller page's address with other choices (the defaults left out), opening at the listings when it changes them. */
export function sellerHref(country: string, handle: string, filters: SellerFilters, change: Partial<SellerFilters> = {}) {
  // Another category or sort starts again at the first page; with no change, the address as it is.
  const next = { ...filters, ...(Object.keys(change).length ? { page: 1 } : {}), ...change };
  const query = new URLSearchParams();
  if (next.category) query.set("category", next.category);
  if (next.sort !== "newest") query.set("sort", next.sort);
  if (next.page > 1) query.set("page", String(next.page));
  const search = query.toString();
  return `${sellerPath(country, handle)}${search ? `?${search}` : ""}${Object.keys(change).length ? "#listings" : ""}`;
}

/** Shown as "Since November 2026". */
export const sinceText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** The figures under the seller's name, each only when it says something. */
export function sellerStats(profile: Pick<ShopSellerProfile, "active_listings" | "sold_listings" | "safe_pay_sales" | "response_rate">) {
  return [
    { key: "live", value: profile.active_listings.toLocaleString("en-GB"), label: profile.active_listings === 1 ? "Listing for sale" : "Listings for sale" },
    { key: "sold", value: profile.sold_listings.toLocaleString("en-GB"), label: "Sold on Udozo" },
    { key: "safe_pay", value: profile.safe_pay_sales.toLocaleString("en-GB"), label: profile.safe_pay_sales === 1 ? "UdozoPay sale" : "UdozoPay sales" },
    { key: "answers", value: profile.response_rate === null ? "New" : `${profile.response_rate}%`, label: profile.response_rate === null ? "Too few chats to say" : "Of chats answered" },
  ];
}

/** Where the seller's listings are, as words: "Lagos, Ogun and 2 more". */
export function placesText(states: ShopSellerProfile["states"], shown = 2) {
  if (!states.length) return null;
  const names = states.slice(0, shown).map(state => state.name);
  const rest = states.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}
