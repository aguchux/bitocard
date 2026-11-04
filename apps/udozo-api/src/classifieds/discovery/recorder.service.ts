import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { brandFeatureKey, isOnShop, modelFeatureKey } from '../rules.js';
import { applyEvents, profileData, type ProfileEvent, readProfile } from './profile.js';
import { type BrowserEventKind, cleanFilters, cleanQuery, contactKinds, customerSubject, type DiscoveryKind, holdout, robots, type ServerEventKind, underEighteen, visitorIdPattern, visitorSubject } from './rules.js';

/** One event as the browser sends it (checked by the controller's DTO first). */
export type IncomingEvent = {
  kind: BrowserEventKind;
  listing?: number;
  query?: string;
  filters?: unknown;
  results?: number;
  sort?: string;
  source?: string;
  position?: number;
  seconds?: number;
  photos?: number;
  depth?: number;
  at?: string;
};

/** Who is asking: a signed-in customer, else a visitor who accepted all cookies (their `udz_vid`), else nobody. */
export type Asker = {
  customer: { id: string; personalisationOffAt: Date | null; birthDate: Date | null } | null;
  visitorId: string | null;
};

/** At most this many events a minute per person (per server instance). */
const perMinute = 300;
const hourMs = 3_600_000;
const rememberAtMost = 50_000;

type ListingFacts = { id: string; customerId: string; categoryId: string | null; areaId: string | null; priceMinor: bigint | null; condition: string | null; brand: string | null; model: string | null };

/**
 * Records what people look at, search for and do on Udozo (docs/UDOZO_PERSONALISATION_PLAN.md, Part 1), and keeps each
 * person's interest profile up to date with it. Recorded only where the `personalisation` switch is on for the market,
 * for a signed-in customer who has not turned it off and is not under 18, or a visitor who accepted all cookies (by an
 * HMAC of their visitor ID, never the ID). A seller's own listings are never recorded for them. Failing to record never
 * fails what the person was doing.
 */
@Injectable()
export class DiscoveryRecorder {
  private readonly logger = new Logger(DiscoveryRecorder.name);
  private readonly pace = new Map<string, { start: number; count: number }>();
  /** Subject, query and day already counted among a day's searchers. */
  private readonly searchers = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The person's subject (`c:<customer>` or `v:<HMAC>`), or null when nobody may be recorded. Never the market's switch. */
  subjectOf(asker: Asker): string | null {
    if (asker.customer) {
      if (asker.customer.personalisationOffAt || underEighteen(asker.customer.birthDate)) return null;
      return customerSubject(asker.customer.id);
    }
    return asker.visitorId ? this.visitorSubjectOf(asker.visitorId) : null;
  }

  /** A visitor's subject: an HMAC of their ID (never the ID itself), or null without a valid ID or a key to hash it with. */
  visitorSubjectOf(visitorId: string) {
    const key = this.config.ENCRYPTION_KEY;
    return key && visitorIdPattern.test(visitorId) ? visitorSubject(visitorId, key) : null;
  }

  /** Whether the switch is on for the market. */
  enabled(country: string) {
    return this.settings.isOnForCountry('personalisation', country.toUpperCase());
  }

  /** A batch from udozo.com (`POST /v1/classifieds/events`): whatever cannot be kept is dropped without a word. */
  async recordBatch(input: { country: string; session: string; events: IncomingEvent[] }, asker: Asker, userAgent: string, now = new Date()) {
    try {
      if (!userAgent || robots.test(userAgent)) return 0;
      const subject = this.subjectOf(asker);
      const country = input.country.toUpperCase();
      if (!subject || !(await this.enabled(country))) return 0;
      const events = input.events.slice(0, this.allowance(subject, input.events.length, now.getTime()));
      if (!events.length) return 0;
      const held = holdout(subject);
      const facts = await this.facts(events.flatMap(event => (event.listing ? [event.listing] : [])), country);
      const rows: Prisma.DiscoveryEventCreateManyInput[] = [];
      for (const event of events) {
        const listing = event.listing ? facts.byRef.get(event.listing) : undefined;
        // An event about a listing not in this market (or gone) is dropped, and so is a seller's own.
        if (event.listing && (!listing || listing.customerId === asker.customer?.id)) continue;
        const at = this.clampTime(event.at, now);
        rows.push({
          subject,
          session: input.session,
          kind: event.kind,
          ...this.about(listing),
          query: event.kind === 'search' || event.kind === 'filter' || event.kind === 'result_click' ? cleanQuery(event.query) : null,
          filters: (cleanFilters(event.filters) ?? undefined) as Prisma.InputJsonValue | undefined,
          results: event.results ?? null,
          sort: event.sort ?? null,
          // The holdout's For you is the popular order: its clicks are told apart for Reports > Discovery.
          source: event.source === 'for_you' && held ? 'for_you_holdout' : (event.source ?? null),
          position: event.position ?? null,
          seconds: event.kind === 'engaged' ? (event.seconds ?? null) : null,
          photos: event.kind === 'engaged' ? (event.photos ?? null) : null,
          depth: event.kind === 'engaged' ? (event.depth ?? null) : null,
          country,
          at,
        });
      }
      await this.keep(subject, country, rows, now);
      return rows.length;
    } catch (error) {
      this.logger.warn(`Discovery events not recorded: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * An action the API itself saw (a save, chat, contact request or call back, call, offer or Safe pay order), after it
   * committed. Never throws.
   */
  async record(customerId: string, country: string | null, kind: ServerEventKind, listingId: string) {
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, personalisationOffAt: true, birthDate: true } });
      const subject = customer ? this.subjectOf({ customer, visitorId: null }) : null;
      if (!subject) return;
      const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { ref: true, country: true, customerId: true } });
      if (!listing || listing.customerId === customerId) return;
      const market = (country ?? listing.country).toUpperCase();
      if (!(await this.enabled(market))) return;
      const facts = await this.facts([Number(listing.ref)], listing.country, false);
      const about = facts.byRef.get(Number(listing.ref));
      if (!about) return;
      const now = new Date();
      await this.keep(subject, market, [{ subject, session: null, kind, ...this.about(about), country: market, at: now }], now);
    } catch (error) {
      this.logger.warn(`Discovery event ${kind} not recorded: ${(error as Error).message}`);
    }
  }

  /** How many of `asked` events this person may still send this minute. */
  private allowance(subject: string, asked: number, now: number) {
    const window = this.pace.get(subject);
    if (!window || now - window.start >= 60_000) {
      if (this.pace.size >= rememberAtMost) this.pace.clear();
      this.pace.set(subject, { start: now, count: Math.min(asked, perMinute) });
      return Math.min(asked, perMinute);
    }
    const left = Math.max(0, perMinute - window.count);
    window.count += Math.min(asked, left);
    return Math.min(asked, left);
  }

  /** A time the page gave, kept within the last hour (anything else is now). */
  private clampTime(at: string | undefined, now: Date) {
    if (!at) return now;
    const time = new Date(at).getTime();
    if (Number.isNaN(time) || time > now.getTime()) return now;
    return new Date(Math.max(time, now.getTime() - hourMs));
  }

  private about(listing: ListingFacts | undefined) {
    return listing
      ? { listingId: listing.id, categoryId: listing.categoryId, brand: listing.brand, model: listing.model, areaId: listing.areaId, priceMinor: listing.priceMinor, condition: listing.condition }
      : {};
  }

  /** What each listing is (category, brand and model, area, price, condition), by its number, live in the market only. */
  private async facts(refs: number[], country: string, liveOnly = true) {
    const byRef = new Map<number, ListingFacts>();
    const unique = [...new Set(refs)].filter(ref => Number.isSafeInteger(ref) && ref > 0);
    if (!unique.length) return { byRef };
    const rows = await this.prisma.classifiedListing.findMany({
      where: { ref: { in: unique.map(ref => BigInt(ref)) }, country },
      select: {
        id: true,
        ref: true,
        customerId: true,
        categoryId: true,
        areaId: true,
        priceMinor: true,
        condition: true,
        status: true,
        onShop: true,
        features: { where: { feature: { key: { in: [brandFeatureKey, modelFeatureKey] } } }, select: { valueText: true, feature: { select: { key: true } } } },
      },
    });
    for (const row of rows) {
      if (liveOnly && !(isOnShop(row) || (row.onShop && row.status === 'sold'))) continue;
      const value = (key: string) => row.features.find(item => item.feature.key === key)?.valueText?.trim().toLowerCase() || null;
      byRef.set(Number(row.ref), { id: row.id, customerId: row.customerId, categoryId: row.categoryId, areaId: row.areaId, priceMinor: row.priceMinor, condition: row.condition, brand: value(brandFeatureKey), model: value(modelFeatureKey) });
    }
    return { byRef };
  }

  /** Writes the events, the day's search counts and the person's profile (locked while it changes). */
  private async keep(subject: string, country: string, rows: Prisma.DiscoveryEventCreateManyInput[], now: Date) {
    if (!rows.length) return;
    await this.prisma.discoveryEvent.createMany({ data: rows });
    await this.countSearches(subject, country, rows, now);
    const events: ProfileEvent[] = rows.map(row => ({
      kind: row.kind as DiscoveryKind,
      listingId: row.listingId ?? null,
      categoryId: row.categoryId ?? null,
      brand: row.brand ?? null,
      model: row.model ?? null,
      areaId: row.areaId ?? null,
      priceMinor: row.priceMinor === null || row.priceMinor === undefined ? null : BigInt(row.priceMinor),
      condition: row.condition ?? null,
      query: row.query ?? null,
      results: row.results ?? null,
      seconds: row.seconds ?? null,
      photos: row.photos ?? null,
      at: row.at instanceof Date ? row.at : now,
    }));
    await this.prisma.$transaction(async tx => {
      await tx.interestProfile.upsert({ where: { subject_country: { subject, country } }, create: { subject, country, updatedAt: now, lastSeenAt: now }, update: {} });
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "interest_profiles" WHERE "subject" = ${subject} AND "country" = ${country} FOR UPDATE`;
      const current = await tx.interestProfile.findUniqueOrThrow({ where: { id: row!.id } });
      const next = applyEvents(readProfile(current), events, now);
      await tx.interestProfile.update({ where: { id: row!.id }, data: { ...profileData(next), lastSeenAt: now } as Prisma.InterestProfileUpdateInput });
    });
  }

  /**
   * The market's searches by day: each search (and whether it found nothing), a person counted once a day per query,
   * clicks on results of a search with its words, and contacts within the hour after the person's latest search.
   */
  private async countSearches(subject: string, country: string, rows: Prisma.DiscoveryEventCreateManyInput[], now: Date) {
    const bump = async (query: string, at: Date, change: { searches?: number; zero?: number; subjects?: number; clicks?: number; contacts?: number }) => {
      const day = new Date(at.toISOString().slice(0, 10));
      await this.prisma.$executeRaw`
        INSERT INTO "search_query_days" ("country", "query", "day", "searches", "zero_results", "subjects", "clicks", "contacts")
        VALUES (${country}, ${query}, ${day}::date, ${change.searches ?? 0}, ${change.zero ?? 0}, ${change.subjects ?? 0}, ${change.clicks ?? 0}, ${change.contacts ?? 0})
        ON CONFLICT ("country", "query", "day") DO UPDATE SET
          "searches" = "search_query_days"."searches" + EXCLUDED."searches",
          "zero_results" = "search_query_days"."zero_results" + EXCLUDED."zero_results",
          "subjects" = "search_query_days"."subjects" + EXCLUDED."subjects",
          "clicks" = "search_query_days"."clicks" + EXCLUDED."clicks",
          "contacts" = "search_query_days"."contacts" + EXCLUDED."contacts"`;
    };
    for (const row of rows) {
      const at = row.at instanceof Date ? row.at : now;
      if (row.kind === 'search' && row.query) {
        const key = `${subject}|${row.query}|${at.toISOString().slice(0, 10)}`;
        const fresh = !this.searchers.has(key);
        if (fresh) {
          if (this.searchers.size >= rememberAtMost) this.searchers.clear();
          this.searchers.add(key);
        }
        await bump(row.query, at, { searches: 1, zero: row.results === 0 ? 1 : 0, subjects: fresh ? 1 : 0 });
      } else if (row.kind === 'result_click' && row.query) {
        await bump(row.query, at, { clicks: 1 });
      } else if ((contactKinds as readonly string[]).includes(row.kind)) {
        const profile = await this.prisma.interestProfile.findUnique({ where: { subject_country: { subject, country } }, select: { searches: true } });
        const latest = Array.isArray(profile?.searches) ? (profile.searches as Array<{ query?: string; at?: string }>)[0] : undefined;
        if (latest?.query && latest.at && now.getTime() - new Date(latest.at).getTime() <= hourMs) await bump(latest.query, now, { contacts: 1 });
      }
    }
  }
}
