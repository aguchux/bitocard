import { decayFactor, type DiscoveryKind, weightOf } from './rules.js';

/**
 * A person's interest profile in one market, as kept in `interest_profiles` (JSON columns): decayed scores, the price
 * band per category, the last searches, what they have seen and what they said they are not interested in.
 */
export type Scores = Record<string, number>;
/** A category's price band, as the weighted mean and spread of the log of prices they engaged with. */
export type PriceBand = { m: number; v: number; w: number };
export type RecentSearch = { query: string; at: string; results: number | null };
/** Per listing id: how often it was shown or opened, when last (unix seconds), and whether it was ever opened. */
export type Seen = Record<string, [count: number, at: number, opened: 0 | 1]>;

export type Profile = {
  categories: Scores;
  brands: Scores;
  models: Scores;
  areas: Scores;
  conditions: Scores;
  prices: Record<string, PriceBand>;
  searches: RecentSearch[];
  seen: Seen;
  excluded: string[];
  updatedAt: Date;
};

/** What one event was about, copied at the time. */
export type ProfileEvent = {
  kind: DiscoveryKind;
  listingId: string | null;
  categoryId: string | null;
  brand: string | null;
  model: string | null;
  areaId: string | null;
  priceMinor: bigint | null;
  condition: string | null;
  query: string | null;
  results: number | null;
  seconds: number | null;
  photos: number | null;
  at: Date;
};

const keepScores = 60;
const keepSearches = 20;
const keepSeen = 200;
const keepExcluded = 500;
const smallest = 0.05;

const asScores = (value: unknown): Scores => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Scores) : {});

/** A profile row read back into its shape (anything malformed read as empty). */
export function readProfile(row: { categories: unknown; brands: unknown; models: unknown; areas: unknown; conditions: unknown; prices: unknown; searches: unknown; seen: unknown; excluded: string[]; updatedAt: Date }): Profile {
  return {
    categories: asScores(row.categories),
    brands: asScores(row.brands),
    models: asScores(row.models),
    areas: asScores(row.areas),
    conditions: asScores(row.conditions),
    prices: asScores(row.prices) as unknown as Record<string, PriceBand>,
    searches: Array.isArray(row.searches) ? (row.searches as RecentSearch[]) : [],
    seen: asScores(row.seen) as unknown as Seen,
    excluded: row.excluded ?? [],
    updatedAt: row.updatedAt,
  };
}

/** Scores decayed to `now`, the faint ones dropped, the strongest kept. */
function decayed(scores: Scores, factor: number) {
  const entries = Object.entries(scores)
    .map(([key, value]) => [key, value * factor] as const)
    .filter(([, value]) => Math.abs(value) >= smallest)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, keepScores);
  return Object.fromEntries(entries);
}

const add = (scores: Scores, key: string | null, weight: number) => {
  if (!key || weight === 0) return;
  scores[key] = (scores[key] ?? 0) + weight;
};

/** The profile after these events, decayed to the newest of them. */
export function applyEvents(profile: Profile, events: ProfileEvent[], now: Date): Profile {
  const factor = decayFactor(now.getTime() - profile.updatedAt.getTime());
  const next: Profile = {
    categories: decayed(profile.categories, factor),
    brands: decayed(profile.brands, factor),
    models: decayed(profile.models, factor),
    areas: decayed(profile.areas, factor),
    conditions: decayed(profile.conditions, factor),
    prices: Object.fromEntries(Object.entries(profile.prices).map(([key, band]) => [key, { ...band, w: band.w * factor }]).filter(([, band]) => (band as PriceBand).w >= smallest)),
    searches: [...profile.searches],
    seen: { ...profile.seen },
    excluded: [...profile.excluded],
    updatedAt: now,
  };
  for (const event of events) {
    const weight = weightOf(event);
    add(next.categories, event.categoryId, weight);
    add(next.brands, event.brand, weight);
    add(next.models, event.brand && event.model ? `${event.brand}|${event.model}` : null, weight);
    add(next.areas, event.areaId, weight / 2);
    add(next.conditions, event.condition, weight / 2);
    if (weight > 0 && event.categoryId && event.priceMinor !== null && event.priceMinor > 0n) {
      const x = Math.log(Number(event.priceMinor));
      const band = next.prices[event.categoryId] ?? { m: x, v: 0.25, w: 0 };
      const w = band.w + weight;
      const m = band.m + (weight / w) * (x - band.m);
      const v = (band.w * band.v + weight * (x - band.m) * (x - m)) / w;
      next.prices[event.categoryId] = { m, v: Math.max(v, 0.04), w };
    }
    if (event.listingId) {
      const [count, , opened] = next.seen[event.listingId] ?? [0, 0, 0];
      const isOpen = event.kind === 'view' || event.kind === 'engaged' || event.kind === 'result_click' || event.kind === 'rail_click';
      next.seen[event.listingId] = [event.kind === 'impression' ? count + 1 : count, Math.floor(event.at.getTime() / 1000), isOpen || opened ? 1 : 0];
      if (event.kind === 'not_interested' && !next.excluded.includes(event.listingId)) next.excluded.unshift(event.listingId);
    }
    if (event.kind === 'search' && event.query) {
      next.searches = [{ query: event.query, at: event.at.toISOString(), results: event.results }, ...next.searches.filter(item => item.query !== event.query)].slice(0, keepSearches);
    }
  }
  next.seen = Object.fromEntries(Object.entries(next.seen).sort((a, b) => b[1][1] - a[1][1]).slice(0, keepSeen));
  next.excluded = next.excluded.slice(0, keepExcluded);
  return next;
}

/** Two profiles of one person as one (a visitor's history folded into their account): scores added, lists joined. */
export function mergeProfiles(into: Profile, from: Profile, now: Date): Profile {
  const a = applyEvents(into, [], now);
  const b = applyEvents(from, [], now);
  const sum = (x: Scores, y: Scores) => {
    const out = { ...x };
    for (const [key, value] of Object.entries(y)) out[key] = (out[key] ?? 0) + value;
    return out;
  };
  const prices = { ...b.prices, ...a.prices };
  const seen: Seen = { ...b.seen };
  for (const [key, value] of Object.entries(a.seen)) {
    const other = seen[key];
    seen[key] = other ? [value[0] + other[0], Math.max(value[1], other[1]), value[2] || other[2] ? 1 : 0] : value;
  }
  const searches = [...a.searches, ...b.searches].sort((x, y) => y.at.localeCompare(x.at)).filter((item, index, list) => list.findIndex(other => other.query === item.query) === index);
  return applyEvents(
    {
      categories: sum(a.categories, b.categories),
      brands: sum(a.brands, b.brands),
      models: sum(a.models, b.models),
      areas: sum(a.areas, b.areas),
      conditions: sum(a.conditions, b.conditions),
      prices,
      searches,
      seen,
      excluded: [...new Set([...a.excluded, ...b.excluded])],
      updatedAt: now,
    },
    [],
    now,
  );
}

/** The profile as stored. */
export function profileData(profile: Profile) {
  return {
    categories: profile.categories,
    brands: profile.brands,
    models: profile.models,
    areas: profile.areas,
    conditions: profile.conditions,
    prices: profile.prices,
    searches: profile.searches,
    seen: profile.seen,
    excluded: profile.excluded,
    updatedAt: profile.updatedAt,
  };
}

/** Each key's share of the strongest positive score (negative ones kept negative, to at most -1). */
export function affinities(scores: Scores) {
  const top = Math.max(0, ...Object.values(scores));
  if (top <= 0) return new Map(Object.entries(scores).map(([key, value]) => [key, Math.max(-1, value / 20)]));
  return new Map(Object.entries(scores).map(([key, value]) => [key, Math.max(-1, value / top)]));
}

/** How well a price fits the band they engage with in its category: 1 in the middle, towards 0 far outside it. */
export function priceFit(band: PriceBand | undefined, priceMinor: number | null) {
  if (!band || !priceMinor || priceMinor <= 0) return 0;
  const d = Math.log(priceMinor) - band.m;
  return Math.exp(-(d * d) / (2 * band.v));
}
