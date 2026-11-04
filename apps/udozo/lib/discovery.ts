import { browserEventKinds, type BrowserEventKind, type DiscoveryEvent, type DiscoveryEventBatch, type ForYouKind } from "@bitocard/api-client/discovery";
import type { ShopCategory } from "@bitocard/api-client/classifieds";
import type { ShopFilters } from "./search";

/**
 * udozo.com's personalised discovery (docs/UDOZO_PERSONALISATION_PLAN.md): what a visit records, sent in batches to this
 * site's own `/api/events`, which adds the customer's session or the visitor's ID and passes them to Udozo's API.
 * A signed-in customer is recorded by their session; a signed-out visitor only after Accept all, by a random ID kept in
 * `udz_vid` (an optional cookie, httpOnly, 12 months). Nothing else is ever recorded.
 */

/** The visitor's ID (`v_` and 32 base64url characters), set only after Accept all and removed with Necessary only. */
export const visitorCookie = "udz_vid";
export const visitorMaxAgeSeconds = 365 * 24 * 60 * 60;
export const visitorPattern = /^v_[A-Za-z0-9_-]{32}$/;
/** The header Udozo's API reads the visitor's ID from (never the customer's: their session says who they are). */
export const visitorHeader = "udozo-visitor";

/** At most this many events a call (the API's limit). */
export const maxBatch = 50;
/** One page view in five counts which cards were seen (impressions), so the rest send none. */
export const impressionSampleRate = 0.2;
/** An `engaged` event's time on the page is capped at ten minutes. */
export const maxEngagedSeconds = 600;
/** The kinds a home page's personal rows can ask for. */
export const forYouKinds: ForYouKind[] = ["for_you", "recent", "searched", "price_drops"];

/** A new visitor ID: 24 random bytes as base64url (32 characters). */
export function newVisitorId(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)) {
  const bytes = random(new Uint8Array(24));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return `v_${btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** A visit's ID: kept in the page's memory only, never in a cookie or storage, so it ends with the visit. */
export function newSessionId(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)) {
  return newVisitorId(random).slice(2, 26);
}

/** The market an address is in (`/ng/...`), or null: only lower-case two-letter first segments, as every market's address writes them. */
export function countryFromPath(pathname: string) {
  const first = pathname.split("/")[1] ?? "";
  return /^[a-z]{2}$/.test(first) ? first.toUpperCase() : null;
}

const int = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined);
const words = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

/** A search's filters as the API keeps them: short strings, or lists of them; anything else is dropped. */
function cleanFilters(value: unknown): DiscoveryEvent["filters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z0-9_.]{1,40}$/.test(key)) continue;
    if (typeof item === "string" && item) out[key] = item.slice(0, 100);
    else if (Array.isArray(item)) {
      const list = item.filter((entry): entry is string => typeof entry === "string" && entry.length > 0).map(entry => entry.slice(0, 100)).slice(0, 10);
      if (list.length) out[key] = list;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** One event as the API takes it, or null: unknown kinds and fields are dropped, numbers held to their ranges. */
export function cleanEvent(raw: unknown): DiscoveryEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!(browserEventKinds as readonly string[]).includes(item.kind as string)) return null;
  const event: DiscoveryEvent = { kind: item.kind as BrowserEventKind };
  if (typeof item.listing === "number" && Number.isSafeInteger(item.listing) && item.listing > 0) event.listing = item.listing;
  const query = words(item.query, 100);
  if (query) event.query = query;
  const filters = cleanFilters(item.filters);
  if (filters) event.filters = filters;
  const results = int(item.results, 0, 1_000_000);
  if (results !== undefined) event.results = results;
  const sort = words(item.sort, 20);
  if (sort) event.sort = sort;
  const source = typeof item.source === "string" && /^[a-z_]+(:[A-Za-z0-9_-]{1,32})?$/.test(item.source) ? item.source.slice(0, 40) : undefined;
  if (source) event.source = source;
  for (const [key, max] of [["position", 500], ["seconds", maxEngagedSeconds], ["photos", 50], ["depth", 100]] as const) {
    const value = int(item[key], 0, max);
    if (value !== undefined) event[key] = value;
  }
  if (typeof item.at === "string" && !Number.isNaN(Date.parse(item.at))) event.at = new Date(item.at).toISOString();
  // A view, engagement, click, impression, share or "not interested" is about one listing.
  if (["view", "engaged", "result_click", "rail_click", "impression", "share", "not_interested"].includes(event.kind) && !event.listing) return null;
  return event;
}

/** A batch from the browser as the API takes it, or null when there is nothing worth sending. */
export function cleanBatch(raw: unknown): DiscoveryEventBatch | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const country = typeof body.country === "string" && /^[A-Za-z]{2}$/.test(body.country) ? body.country.toUpperCase() : null;
  const session = typeof body.session === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(body.session) ? body.session : null;
  if (!country || !session || !Array.isArray(body.events)) return null;
  const events = body.events.slice(0, maxBatch).map(cleanEvent).filter((event): event is DiscoveryEvent => event !== null);
  return events.length ? { country, session, events } : null;
}

/** A results page's filters as a search event keeps them: its category and place, price, condition, features. */
export function searchFilters(filters: ShopFilters, category: Pick<ShopCategory, "slug"> | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (category) out.category = category.slug;
  if (filters.state) out.state = filters.state;
  if (filters.area) out.area = filters.area;
  if (filters.priceMin !== null) out.min = String(filters.priceMin);
  if (filters.priceMax !== null) out.max = String(filters.priceMax);
  if (filters.condition.length) out.condition = filters.condition;
  if (filters.features.length) out.f = filters.features;
  return out;
}

/** Where a personal row's clicks come from: its kind, or `for_you_holdout` when the For you row was not personalised. */
export const railSource = (kind: ForYouKind, personalised: boolean) => (kind === "for_you" && !personalised ? "for_you_holdout" : kind);

/** What the search box offers before anything is typed (`/api/searches`): the person's recent searches, then the market's popular ones. */
export type SearchSuggestions = { recent: string[]; popular: string[] };

/** Where clicks on a home page row's cards come from (`home:<row id>`), within the API's 40 characters. */
export const homeSource = (id: string) => `home:${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}`;
