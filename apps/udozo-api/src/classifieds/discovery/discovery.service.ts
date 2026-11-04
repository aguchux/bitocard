import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ListingSearchService } from '../search.service.js';
import { affinities, mergeProfiles, priceFit, type Profile, profileData, readProfile } from './profile.js';
import { type Asker, DiscoveryRecorder } from './recorder.service.js';
import { cleanQuery, contactKinds, customerSubject, holdout, type PersonalRowKind, personalRowKinds } from './rules.js';

/** One live listing as ranking sees it. */
type Candidate = {
  id: string;
  sellerId: string;
  categoryId: string | null;
  areaId: string | null;
  priceMinor: number | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  publishedAt: number;
  popularity: number;
  quality: number;
};

type Card = Record<string, unknown> & { id: string };
export type ForYouRow = { kind: PersonalRowKind; title: string; href: string | null; query?: string; items: Card[] };

const poolMs = 60_000;
/** Live listings ranked per market (the newest this many): the pool every personal row is chosen from. */
const poolSize = 1500;
const dayMs = 86_400_000;
const freshnessHalfLifeDays = 14;
/** A share of every personalised row kept for fresh and popular listings outside the person's interests. */
const exploration = 0.15;
const perSeller = 2;
/** Shown this often without ever being opened: no longer suggested. */
const seenTooOften = 6;

const subjectRequired = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'subject_required', 'Sign in, or accept all cookies, so Udozo can remember what you look at.');

/**
 * What a person sees chosen for them (docs/UDOZO_PERSONALISATION_PLAN.md, Parts 2 and 3): For you, Recently viewed,
 * Because you searched and Price dropped, People also viewed, their recent searches and the market's popular ones, and
 * their history, which they can remove. Every score is `quality × freshness × popularity × (1 + personal)`; without a
 * profile, for the 10% holdout or where the switch is off, the personal part is left out (the popular order).
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly pools = new Map<string, { at: number; items: Candidate[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: DiscoveryRecorder,
    private readonly search: ListingSearchService,
  ) {}

  /** Forgets the cached pools (tests, after listings change). */
  forget() {
    this.pools.clear();
  }

  // ---- For you ----

  async forYou(country: string, asker: Asker, kinds: PersonalRowKind[] = [...personalRowKinds], limit = 12) {
    const market = country.toUpperCase();
    const subject = this.recorder.subjectOf(asker);
    const enabled = await this.recorder.enabled(market);
    const profileRow = subject && enabled ? await this.prisma.interestProfile.findUnique({ where: { subject_country: { subject, country: market } } }) : null;
    const profile = profileRow ? readProfile(profileRow) : null;
    const known = profile !== null && Object.values(profile.categories).some(value => value > 0);
    const pool = await this.pool(market);
    const ownerId = asker.customer?.id ?? null;

    if (!subject || !enabled || !known) {
      const items = kinds.includes('for_you') ? await this.cards(this.rank(pool, null, new Set(), ownerId, limit, null)) : [];
      return { object: 'for_you' as const, personalised: false, rows: items.length ? [{ kind: 'for_you' as const, title: 'For you', href: null, items }] : [] };
    }

    const held = holdout(subject);
    const rows: ForYouRow[] = [];
    for (const kind of kinds) {
      let row: ForYouRow | null = null;
      try {
        if (kind === 'for_you') {
          const exclude = await this.excluded(subject, market, profile);
          const ids = this.rank(pool, held ? null : profile, exclude, ownerId, limit, asker.customer ? await this.homeArea(asker.customer.id) : null);
          row = { kind, title: 'For you', href: null, items: await this.cards(ids) };
        } else if (kind === 'recent') {
          row = { kind, title: 'Recently viewed', href: null, items: await this.cards((await this.viewed(subject, market, limit)).map(item => item.id)) };
        } else if (kind === 'searched') {
          row = await this.searched(market, profile, limit, ownerId);
        } else {
          row = { kind, title: 'Price dropped', href: null, items: await this.priceDrops(subject, market, limit) };
        }
      } catch (error) {
        this.logger.warn(`Personal row ${kind} not filled: ${(error as Error).message}`);
      }
      if (row && row.items.length) rows.push(row);
    }
    return { object: 'for_you' as const, personalised: !held, rows };
  }

  /** The market's live listings with what ranking needs, kept a minute. */
  private async pool(country: string) {
    const cached = this.pools.get(country);
    if (cached && Date.now() - cached.at < poolMs) return cached.items;
    const rows = await this.prisma.$queryRaw<
      { id: string; customer_id: string; category_id: string | null; area_id: string | null; price_minor: bigint | null; condition: string | null; published_at: Date | null; leads: number; views: number; saves: bigint; quality: number | null; brand: string | null; model: string | null }[]
    >`
      SELECT l."id", l."customer_id", l."category_id", l."area_id", l."price_minor", l."condition", l."published_at", l."leads", l."views",
        (SELECT count(*) FROM "classified_favourites" f WHERE f."listing_id" = l."id") AS saves,
        s."quality",
        (SELECT lower(lf."value_text") FROM "classified_listing_features" lf JOIN "classified_features" cf ON cf."id" = lf."feature_id" WHERE lf."listing_id" = l."id" AND cf."key" = 'brand' LIMIT 1) AS brand,
        (SELECT lower(lf."value_text") FROM "classified_listing_features" lf JOIN "classified_features" cf ON cf."id" = lf."feature_id" WHERE lf."listing_id" = l."id" AND cf."key" = 'model' LIMIT 1) AS model
      FROM "classified_listings" l
      LEFT JOIN "listing_signals" s ON s."listing_id" = l."id"
      WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop"
      ORDER BY l."published_at" DESC NULLS LAST, l."id"
      LIMIT ${poolSize}`;
    const items = rows.map(row => ({
      id: row.id,
      sellerId: row.customer_id,
      categoryId: row.category_id,
      areaId: row.area_id,
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
      condition: row.condition,
      brand: row.brand?.trim() || null,
      model: row.model?.trim() || null,
      publishedAt: row.published_at?.getTime() ?? 0,
      popularity: row.leads * 3 + Number(row.saves) * 2 + row.views / 10,
      quality: row.quality ?? 1,
    }));
    this.pools.set(country, { at: Date.now(), items });
    return items;
  }

  /**
   * Listings in order: by quality, freshness and popularity, times (1 + personal) when there is a profile. At most two
   * per seller, categories spread, and 15% of the places kept for popular listings outside the person's interests.
   */
  private rank(pool: Candidate[], profile: Profile | null, exclude: Set<string>, ownerId: string | null, limit: number, homeAreaId: string | null) {
    const now = Date.now();
    const base = (item: Candidate) => item.quality * Math.max(0.05, 0.5 ** ((now - item.publishedAt) / dayMs / freshnessHalfLifeDays)) * (1 + Math.log1p(item.popularity));
    const open = pool.filter(item => !exclude.has(item.id) && item.sellerId !== ownerId);
    const popular = [...open].sort((a, b) => base(b) - base(a));
    if (!profile) return this.spread(popular, limit);

    const categories = affinities(profile.categories);
    const brands = affinities(profile.brands);
    const models = affinities(profile.models);
    const areas = affinities(profile.areas);
    const conditions = affinities(profile.conditions);
    const personal = (item: Candidate) => {
      const category = item.categoryId ? (categories.get(item.categoryId) ?? 0) : 0;
      const brand = item.brand ? (brands.get(item.brand) ?? 0) : 0;
      const model = item.brand && item.model ? (models.get(`${item.brand}|${item.model}`) ?? 0) : 0;
      const area = (item.areaId ? (areas.get(item.areaId) ?? 0) : 0) + (homeAreaId && item.areaId === homeAreaId ? 0.3 : 0);
      const condition = item.condition ? (conditions.get(item.condition) ?? 0) : 0;
      const price = category > 0 && item.categoryId ? priceFit(profile.prices[item.categoryId], item.priceMinor) : 0;
      return 1.5 * category + 0.8 * brand + 0.8 * model + 0.4 * area + 0.2 * condition + 0.5 * price;
    };
    const scored = new Map(open.map(item => [item.id, base(item) * Math.max(0.1, 1 + personal(item))]));
    const ordered = [...open].sort((a, b) => scored.get(b.id)! - scored.get(a.id)!);
    const chosen = this.spread(ordered, limit);
    // Exploration: popular listings in categories the person has shown no interest in, spread through the row.
    const slots = limit >= 6 ? Math.max(1, Math.round(limit * exploration)) : 0;
    if (!slots) return chosen;
    const sellerOf = new Map(open.map(item => [item.id, item.sellerId]));
    const kept = chosen.slice(0, limit - slots);
    const sellers = new Map<string, number>();
    for (const id of kept) sellers.set(sellerOf.get(id)!, (sellers.get(sellerOf.get(id)!) ?? 0) + 1);
    const explore: string[] = [];
    for (const item of popular) {
      if (explore.length >= slots) break;
      if (kept.includes(item.id) || (item.categoryId && (categories.get(item.categoryId) ?? 0) > 0) || (sellers.get(item.sellerId) ?? 0) >= perSeller) continue;
      explore.push(item.id);
      sellers.set(item.sellerId, (sellers.get(item.sellerId) ?? 0) + 1);
    }
    // Places exploration could not fill go back to the person's own order.
    for (const id of chosen.slice(limit - slots)) {
      if (kept.length + explore.length >= limit) break;
      if ((sellers.get(sellerOf.get(id)!) ?? 0) >= perSeller) continue;
      kept.push(id);
      sellers.set(sellerOf.get(id)!, (sellers.get(sellerOf.get(id)!) ?? 0) + 1);
    }
    explore.forEach((id, n) => kept.splice(Math.min(kept.length, Math.floor(((n + 1) * limit) / (explore.length + 1))), 0, id));
    return kept.slice(0, limit);
  }

  /** The first `limit` with at most two per seller and no category taking more than a third (topped up if short). */
  private spread(ordered: Candidate[], limit: number) {
    const perCategory = Math.max(3, Math.ceil(limit / 3));
    const sellers = new Map<string, number>();
    const categories = new Map<string, number>();
    const out: string[] = [];
    const skipped: Candidate[] = [];
    for (const item of ordered) {
      if (out.length >= limit) break;
      if ((sellers.get(item.sellerId) ?? 0) >= perSeller) continue;
      const category = item.categoryId ?? '';
      if ((categories.get(category) ?? 0) >= perCategory) {
        skipped.push(item);
        continue;
      }
      out.push(item.id);
      sellers.set(item.sellerId, (sellers.get(item.sellerId) ?? 0) + 1);
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    for (const item of skipped) {
      if (out.length >= limit) break;
      if ((sellers.get(item.sellerId) ?? 0) >= perSeller) continue;
      out.push(item.id);
      sellers.set(item.sellerId, (sellers.get(item.sellerId) ?? 0) + 1);
    }
    return out;
  }

  /** Listings never to suggest again: contacted or bought, marked not interested, or shown often without being opened. */
  private async excluded(subject: string, country: string, profile: Profile) {
    const rows = await this.prisma.discoveryEvent.findMany({ where: { subject, country, kind: { in: [...contactKinds] }, listingId: { not: null } }, select: { listingId: true }, distinct: ['listingId'] });
    const out = new Set<string>(rows.map(row => row.listingId!));
    for (const id of profile.excluded) out.add(id);
    for (const [id, [count, , opened]] of Object.entries(profile.seen)) if (count >= seenTooOften && !opened) out.add(id);
    return out;
  }

  private async homeArea(customerId: string) {
    return (await this.prisma.customer.findUnique({ where: { id: customerId }, select: { areaId: true } }))?.areaId ?? null;
  }

  /** The listings the person opened, newest first (live ones only). */
  private async viewed(subject: string, country: string | null, limit: number) {
    const rows = await this.prisma.$queryRaw<{ id: string; viewed_at: Date }[]>`
      SELECT e."listing_id" AS id, max(e."at") AS viewed_at
      FROM "discovery_events" e JOIN "classified_listings" l ON l."id" = e."listing_id"
      WHERE e."subject" = ${subject} AND e."kind" IN ('view', 'engaged') AND (${country}::text IS NULL OR e."country" = ${country})
        AND l."status" = 'active' AND l."on_shop"
      GROUP BY e."listing_id"
      ORDER BY max(e."at") DESC
      LIMIT ${limit}`;
    return rows;
  }

  /** Because you searched: the latest search that found something, searched again now. */
  private async searched(country: string, profile: Profile, limit: number, ownerId: string | null): Promise<ForYouRow | null> {
    const latest = profile.searches.find(item => (item.results ?? 1) > 0);
    if (!latest) return null;
    const found = await this.search.search({ country, q: latest.query, limit: limit + perSeller });
    const cards = found.data as unknown as Card[];
    const own = ownerId ? new Set((await this.prisma.classifiedListing.findMany({ where: { id: { in: cards.map(card => card.id) }, customerId: ownerId }, select: { id: true } })).map(row => row.id)) : new Set<string>();
    const items = cards.filter(card => !own.has(card.id)).slice(0, limit);
    return { kind: 'searched', title: `Because you searched "${latest.query}"`, href: `/${country.toLowerCase()}/search?q=${encodeURIComponent(latest.query)}`, query: latest.query, items };
  }

  /** Listings the person opened or saved that are cheaper now than when they did, with the price they saw. */
  private async priceDrops(subject: string, country: string, limit: number) {
    const rows = await this.prisma.$queryRaw<{ id: string; was: bigint }[]>`
      WITH last AS (
        SELECT DISTINCT ON (e."listing_id") e."listing_id", e."price_minor"
        FROM "discovery_events" e
        WHERE e."subject" = ${subject} AND e."country" = ${country} AND e."kind" IN ('view', 'engaged', 'save') AND e."listing_id" IS NOT NULL AND e."price_minor" IS NOT NULL
        ORDER BY e."listing_id", e."at" DESC
      )
      SELECT l."id", last."price_minor" AS was
      FROM last JOIN "classified_listings" l ON l."id" = last."listing_id"
      WHERE l."status" = 'active' AND l."on_shop" AND l."price_minor" IS NOT NULL AND l."price_minor" < last."price_minor"
      ORDER BY (last."price_minor" - l."price_minor")::float8 / last."price_minor" DESC, l."id"
      LIMIT ${limit}`;
    const was = new Map(rows.map(row => [row.id, Number(row.was)]));
    return (await this.cards(rows.map(row => row.id))).map(card => ({ ...card, was_price: was.get(card.id) ?? null }));
  }

  /** Cards in the order given (listings gone since left out). */
  private async cards(ids: string[]): Promise<Card[]> {
    if (!ids.length) return [];
    const cards = await this.search.cards(ids);
    return ids.flatMap(id => (cards.has(id) ? [cards.get(id) as unknown as Card] : []));
  }

  // ---- People also viewed ----

  async alsoViewed(ref: number, limit = 8) {
    if (!Number.isSafeInteger(ref) || ref < 1) return { object: 'list' as const, data: [] };
    const listing = await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(ref) }, select: { id: true } });
    if (!listing) return { object: 'list' as const, data: [] };
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT n."neighbour_id" AS id
      FROM "listing_neighbours" n JOIN "classified_listings" l ON l."id" = n."neighbour_id"
      WHERE n."listing_id" = ${listing.id}::uuid AND n."neighbour_id" <> ${listing.id}::uuid AND l."status" = 'active' AND l."on_shop"
      ORDER BY n."score" DESC, n."neighbour_id"
      LIMIT ${limit}`;
    return { object: 'list' as const, data: await this.cards(rows.map(row => row.id)) };
  }

  // ---- History ----

  /** What is remembered about the person: the last 30 listings they opened and their last 20 searches. */
  async history(asker: Asker) {
    if (!asker.customer && !asker.visitorId) throw subjectRequired();
    const subject = this.recorder.subjectOf(asker);
    if (!subject) {
      if (!asker.customer) throw subjectRequired();
      return { object: 'history' as const, personalisation: false, listings: [], searches: [] };
    }
    const viewed = await this.viewed(subject, null, 30);
    const cards = await this.cards(viewed.map(item => item.id));
    const at = new Map(viewed.map(item => [item.id, item.viewed_at]));
    const searches = await this.prisma.$queryRaw<{ query: string; searched_at: Date }[]>`
      SELECT e."query", max(e."at") AS searched_at FROM "discovery_events" e
      WHERE e."subject" = ${subject} AND e."kind" = 'search' AND e."query" IS NOT NULL
      GROUP BY e."query" ORDER BY max(e."at") DESC LIMIT 20`;
    return {
      object: 'history' as const,
      personalisation: true,
      listings: cards.map(card => ({ ...card, viewed_at: at.get(card.id)!.toISOString() })),
      searches: searches.map(row => ({ query: row.query, searched_at: row.searched_at.toISOString() })),
    };
  }

  /** The person's subject for removing their history: any customer (even one who turned it off) or visitor. */
  private ownSubject(asker: Asker) {
    if (asker.customer) return customerSubject(asker.customer.id);
    if (asker.visitorId) return this.recorder.subjectOf(asker);
    return null;
  }

  /** Everything remembered about the person (events and interest profiles) deleted. */
  async clear(asker: Asker) {
    const subject = this.ownSubject(asker);
    if (!subject) throw subjectRequired();
    await this.forgetSubject(subject);
  }

  async forgetSubject(subject: string) {
    await this.prisma.$transaction([this.prisma.discoveryEvent.deleteMany({ where: { subject } }), this.prisma.interestProfile.deleteMany({ where: { subject } })]);
  }

  /** One listing taken out of the person's history (and from what they have seen). */
  async removeListing(asker: Asker, ref: number) {
    const subject = this.ownSubject(asker);
    if (!subject) throw subjectRequired();
    const listing = Number.isSafeInteger(ref) && ref > 0 ? await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(ref) }, select: { id: true } }) : null;
    if (!listing) return;
    await this.prisma.discoveryEvent.deleteMany({ where: { subject, listingId: listing.id, kind: { notIn: ['not_interested'] } } });
    await this.editProfiles(subject, profile => {
      delete profile.seen[listing.id];
      return profile;
    });
  }

  /** One search taken out of the person's history and recent searches. */
  async removeSearch(asker: Asker, q: string) {
    const subject = this.ownSubject(asker);
    if (!subject) throw subjectRequired();
    const query = cleanQuery(q);
    if (!query) return;
    await this.prisma.discoveryEvent.deleteMany({ where: { subject, kind: { in: ['search', 'filter', 'result_click'] }, query } });
    await this.editProfiles(subject, profile => ({ ...profile, searches: profile.searches.filter(item => item.query !== query) }));
  }

  private async editProfiles(subject: string, change: (profile: Profile) => Profile) {
    const rows = await this.prisma.interestProfile.findMany({ where: { subject }, select: { id: true } });
    for (const { id } of rows) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "interest_profiles" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const row = await tx.interestProfile.findUnique({ where: { id } });
        if (!row) return;
        const profile = change(readProfile(row));
        await tx.interestProfile.update({ where: { id }, data: { seen: profile.seen, searches: profile.searches } as Prisma.InterestProfileUpdateInput });
      });
    }
  }

  /** Personalise what I see: off deletes the customer's history and profile and stops recording; on starts again. */
  async setPersonalisation(customerId: string, enabled: boolean) {
    await this.prisma.customer.update({ where: { id: customerId }, data: { personalisationOffAt: enabled ? null : new Date() } });
    if (!enabled) await this.forgetSubject(customerSubject(customerId));
    return { object: 'personalisation' as const, enabled };
  }

  /**
   * After signing in: the visitor's history and profiles become the customer's (profiles in the same market added
   * together), unless the customer turned personalisation off or is under 18: then the visitor's are deleted.
   */
  async merge(customer: { id: string; personalisationOffAt: Date | null; birthDate: Date | null }, visitorId: string) {
    const from = this.recorder.visitorSubjectOf(visitorId);
    if (!from) return { object: 'history_merge' as const, merged: 0 };
    const into = this.recorder.subjectOf({ customer, visitorId: null });
    if (!into) {
      await this.forgetSubject(from);
      return { object: 'history_merge' as const, merged: 0 };
    }
    const now = new Date();
    const moved = await this.prisma.$transaction(async tx => {
      const events = await tx.discoveryEvent.updateMany({ where: { subject: from }, data: { subject: into } });
      const theirs = await tx.interestProfile.findMany({ where: { subject: from } });
      for (const visitor of theirs) {
        const mine = await tx.interestProfile.findUnique({ where: { subject_country: { subject: into, country: visitor.country } } });
        if (!mine) {
          await tx.interestProfile.update({ where: { id: visitor.id }, data: { subject: into } });
          continue;
        }
        await tx.$queryRaw`SELECT "id" FROM "interest_profiles" WHERE "id" = ${mine.id}::uuid FOR UPDATE`;
        const merged = mergeProfiles(readProfile(mine), readProfile(visitor), now);
        await tx.interestProfile.update({ where: { id: mine.id }, data: { ...profileData(merged), lastSeenAt: now } as Prisma.InterestProfileUpdateInput });
        await tx.interestProfile.delete({ where: { id: visitor.id } });
      }
      return events.count;
    });
    return { object: 'history_merge' as const, merged: moved };
  }

  // ---- Searches ----

  /** The person's last 8 searches in the market, newest first. */
  async recentSearches(country: string, asker: Asker) {
    const subject = this.recorder.subjectOf(asker);
    if (!subject) return { object: 'list' as const, data: [] };
    const row = await this.prisma.interestProfile.findUnique({ where: { subject_country: { subject, country: country.toUpperCase() } }, select: { searches: true } });
    const searches = Array.isArray(row?.searches) ? (row.searches as Array<{ query: string }>) : [];
    return { object: 'list' as const, data: searches.slice(0, 8).map(item => ({ query: item.query })) };
  }

  /** The market's 8 most searched words of the last 7 days that found something, each searched by at least 3 people. */
  async popularSearches(country: string, now = new Date()) {
    const since = new Date(new Date(now.getTime() - 6 * dayMs).toISOString().slice(0, 10));
    const rows = await this.prisma.$queryRaw<{ query: string }[]>`
      SELECT "query" FROM "search_query_days"
      WHERE "country" = ${country.toUpperCase()} AND "day" >= ${since}::date
      GROUP BY "query"
      HAVING sum("searches") > sum("zero_results") AND sum("subjects") >= 3
      ORDER BY sum("searches") DESC, "query"
      LIMIT 8`;
    return { object: 'list' as const, data: rows.map(row => ({ query: row.query })) };
  }
}
