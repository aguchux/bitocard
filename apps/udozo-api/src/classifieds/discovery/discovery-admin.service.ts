import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';

const dayMs = 86_400_000;
/** Raw events kept 90 days; an idle profile 180 days; searches per day about 13 months. */
const eventsKeptDays = 90;
const profilesKeptDays = 180;
const searchDaysKept = 396;
const neighbourDays = 30;
const neighboursEach = 20;
/** A visit with more listings than this is left out of "also viewed" (a robot, or someone scrolling everything). */
const visitAtMost = 50;
const signalDays = 30;
/** Weight given to the market's average in a listing's rates, so new listings start there rather than at nothing. */
const prior = 20;

const contactList = Prisma.join(['chat', 'contact', 'call', 'offer', 'order']);
const clickList = Prisma.join(['result_click', 'rail_click']);
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null);

/**
 * Reports > Discovery for Udozo's admins, and the jobs that keep discovery's aggregates and its memory short: each
 * listing's quality signals (every 15 minutes), "people also viewed" and retention (daily).
 */
@Injectable()
export class DiscoveryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Searches, clicks and contacts by source, and For you personalised against the 10% holdout, over 7, 30 or 90 days. */
  async summary(input: { country?: string; days?: number }, now = new Date()) {
    const country = input.country?.toUpperCase() ?? null;
    const days = input.days ?? 7;
    const from = new Date(now.getTime() - days * dayMs);
    const where = country ? Prisma.sql`e."at" >= ${from} AND e."at" <= ${now} AND e."country" = ${country}` : Prisma.sql`e."at" >= ${from} AND e."at" <= ${now}`;
    const fromDay = new Date(from.toISOString().slice(0, 10));
    const dayWhere = country ? Prisma.sql`"day" >= ${fromDay}::date AND "country" = ${country}` : Prisma.sql`"day" >= ${fromDay}::date`;
    const held = Prisma.sql`get_byte(sha256(convert_to(e."subject", 'UTF8')), 0) < 26`;

    const [totals, top, zero, sources, groups, daily, kinds, enabled] = await Promise.all([
      this.prisma.$queryRaw<{ subjects: bigint; events: bigint; searches: bigint; zero: bigint }[]>`
        SELECT count(DISTINCT e."subject") AS subjects, count(*) AS events,
          count(*) FILTER (WHERE e."kind" = 'search') AS searches,
          count(*) FILTER (WHERE e."kind" = 'search' AND e."results" = 0) AS zero
        FROM "discovery_events" e WHERE ${where}`,
      this.prisma.$queryRaw<{ query: string; searches: bigint; subjects: bigint }[]>`
        SELECT "query", sum("searches") AS searches, sum("subjects") AS subjects FROM "search_query_days" WHERE ${dayWhere}
        GROUP BY "query" ORDER BY sum("searches") DESC, "query" LIMIT 20`,
      this.prisma.$queryRaw<{ query: string; searches: bigint; subjects: bigint }[]>`
        SELECT "query", sum("zero_results") AS searches, sum("subjects") AS subjects FROM "search_query_days" WHERE ${dayWhere}
        GROUP BY "query" HAVING sum("zero_results") > 0 ORDER BY sum("zero_results") DESC, "query" LIMIT 20`,
      this.prisma.$queryRaw<{ source: string; impressions: bigint; clicks: bigint; contacts: bigint }[]>`
        WITH shown AS (
          SELECT e."source", e."kind", e."subject", e."listing_id", e."at" FROM "discovery_events" e
          WHERE ${where} AND e."source" IS NOT NULL AND (e."kind" = 'impression' OR e."kind" IN (${clickList}))
        )
        SELECT s."source",
          count(*) FILTER (WHERE s."kind" = 'impression') AS impressions,
          count(*) FILTER (WHERE s."kind" <> 'impression') AS clicks,
          count(DISTINCT (s."subject", s."listing_id")) FILTER (WHERE s."kind" <> 'impression' AND EXISTS (
            SELECT 1 FROM "discovery_events" c WHERE c."subject" = s."subject" AND c."listing_id" = s."listing_id"
              AND c."kind" IN (${contactList}) AND c."at" >= s."at" AND c."at" <= s."at" + interval '2 hours'
          )) AS contacts
        FROM shown s GROUP BY s."source" ORDER BY count(*) FILTER (WHERE s."kind" <> 'impression') DESC, s."source"`,
      this.prisma.$queryRaw<{ held: boolean; subjects: bigint; impressions: bigint; clicks: bigint; contacts: bigint }[]>`
        SELECT ${held} AS held, count(DISTINCT e."subject") AS subjects,
          count(*) FILTER (WHERE e."kind" = 'impression' AND e."source" IN ('for_you', 'for_you_holdout')) AS impressions,
          count(*) FILTER (WHERE e."kind" IN (${clickList}) AND e."source" IN ('for_you', 'for_you_holdout')) AS clicks,
          count(*) FILTER (WHERE e."kind" IN (${contactList})) AS contacts
        FROM "discovery_events" e WHERE ${where} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: Date; events: bigint; searches: bigint; subjects: bigint }[]>`
        SELECT date_trunc('day', e."at") AS day, count(*) AS events, count(*) FILTER (WHERE e."kind" = 'search') AS searches, count(DISTINCT e."subject") AS subjects
        FROM "discovery_events" e WHERE ${where} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ kind: string; events: bigint }[]>`
        SELECT e."kind", count(*) AS events FROM "discovery_events" e WHERE ${where} GROUP BY 1 ORDER BY count(*) DESC, e."kind"`,
      country ? this.settings.isOnForCountry('personalisation', country) : this.settings.isOnGlobally('personalisation'),
    ]);
    const total = totals[0] ?? { subjects: 0n, events: 0n, searches: 0n, zero: 0n };
    const counts = (list: { query: string; searches: bigint; subjects: bigint }[]) => list.map(row => ({ query: row.query, searches: Number(row.searches), subjects: Number(row.subjects) }));
    const group = (isHeld: boolean) => {
      const row = groups.find(item => item.held === isHeld);
      const subjects = Number(row?.subjects ?? 0);
      const impressions = Number(row?.impressions ?? 0);
      const clicks = Number(row?.clicks ?? 0);
      return { group: isHeld ? ('holdout' as const) : ('personalised' as const), subjects, impressions, clicks, click_rate: rate(clicks, impressions), contacts_per_subject: rate(Number(row?.contacts ?? 0), subjects) };
    };
    return {
      object: 'discovery_summary' as const,
      country,
      days,
      from: from.toISOString(),
      to: now.toISOString(),
      enabled,
      totals: { subjects: Number(total.subjects), events: Number(total.events), searches: Number(total.searches), zero_result_searches: Number(total.zero), zero_result_rate: rate(Number(total.zero), Number(total.searches)) },
      top_queries: counts(top),
      zero_result_queries: counts(zero),
      sources: sources.map(row => ({ source: row.source, impressions: Number(row.impressions), clicks: Number(row.clicks), contacts: Number(row.contacts), click_rate: rate(Number(row.clicks), Number(row.impressions)) })),
      for_you: [group(false), group(true)],
      daily: daily.map(row => ({ day: new Date(row.day).toISOString().slice(0, 10), events: Number(row.events), searches: Number(row.searches), subjects: Number(row.subjects) })),
      kinds: kinds.map(row => ({ kind: row.kind, events: Number(row.events) })),
    };
  }

  /**
   * Every live listing's quality (the `classifieds` job): click-through from impressions, saves and contacts against
   * opens over 30 days, each smoothed towards its market's average so a new listing is not punished for having none.
   */
  async refreshSignals(now = new Date()) {
    const since = new Date(now.getTime() - signalDays * dayMs);
    const refreshed = await this.prisma.$executeRaw`
      WITH ev AS (
        SELECT e."listing_id",
          count(*) FILTER (WHERE e."kind" = 'impression') AS imp,
          count(*) FILTER (WHERE e."kind" IN (${clickList})) AS clk,
          count(*) FILTER (WHERE e."kind" IN ('view', 'engaged')) AS vw,
          count(*) FILTER (WHERE e."kind" = 'save') AS sv,
          count(*) FILTER (WHERE e."kind" IN (${contactList})) AS ct
        FROM "discovery_events" e WHERE e."at" >= ${since} AND e."listing_id" IS NOT NULL GROUP BY e."listing_id"
      ),
      stats AS (
        SELECT l."id", l."country", COALESCE(ev.imp, 0)::float8 AS imp, COALESCE(ev.clk, 0)::float8 AS clk, COALESCE(ev.vw, 0)::float8 AS vw, COALESCE(ev.sv, 0)::float8 AS sv, COALESCE(ev.ct, 0)::float8 AS ct
        FROM "classified_listings" l LEFT JOIN ev ON ev."listing_id" = l."id"
        WHERE l."status" = 'active' AND l."on_shop"
      ),
      market AS (
        SELECT "country", (sum(clk) + 1) / (sum(imp) + 20) AS pc, (sum(sv) + 1) / (sum(vw) + 20) AS ps, (sum(ct) + 1) / (sum(vw) + 20) AS pk FROM stats GROUP BY "country"
      ),
      rates AS (
        SELECT s."id", (s.clk + ${prior} * m.pc) / (s.imp + ${prior}) AS ctr, (s.sv + ${prior} * m.ps) / (s.vw + ${prior}) AS sr, (s.ct + ${prior} * m.pk) / (s.vw + ${prior}) AS cr, m.pc, m.ps, m.pk
        FROM stats s JOIN market m ON m."country" = s."country"
      )
      INSERT INTO "listing_signals" ("listing_id", "quality", "ctr", "save_rate", "contact_rate", "refreshed_at")
      SELECT r."id", LEAST(2.0, GREATEST(0.5, 0.4 * r.ctr / r.pc + 0.3 * r.sr / r.ps + 0.3 * r.cr / r.pk)), r.ctr, r.sr, r.cr, ${now}
      FROM rates r
      ON CONFLICT ("listing_id") DO UPDATE SET "quality" = EXCLUDED."quality", "ctr" = EXCLUDED."ctr", "save_rate" = EXCLUDED."save_rate", "contact_rate" = EXCLUDED."contact_rate", "refreshed_at" = EXCLUDED."refreshed_at"`;
    const removed = await this.prisma.$executeRaw`
      DELETE FROM "listing_signals" s WHERE NOT EXISTS (SELECT 1 FROM "classified_listings" l WHERE l."id" = s."listing_id" AND l."status" = 'active' AND l."on_shop")`;
    return { refreshed, removed };
  }

  /**
   * "People also viewed" (daily): for each listing, the 20 listings most often opened or contacted in the same visits
   * over 30 days (a visit is the page's session, or a person's day for what the API recorded), live ones only.
   */
  async refreshNeighbours(now = new Date()) {
    const since = new Date(now.getTime() - neighbourDays * dayMs);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM "listing_neighbours"`;
      return tx.$executeRaw`
        WITH items AS (
          SELECT COALESCE(e."session", e."subject" || ':' || to_char(e."at", 'YYYY-MM-DD')) AS visit, e."listing_id",
            max(CASE WHEN e."kind" IN (${contactList}) THEN 3 WHEN e."kind" = 'save' THEN 2 ELSE 1 END) AS w
          FROM "discovery_events" e
          WHERE e."at" >= ${since} AND e."listing_id" IS NOT NULL AND e."kind" IN ('view', 'engaged', 'result_click', 'rail_click', 'save', ${contactList})
          GROUP BY 1, 2
        ),
        visits AS (SELECT visit FROM items GROUP BY visit HAVING count(*) BETWEEN 2 AND ${visitAtMost}),
        pairs AS (
          SELECT a."listing_id", b."listing_id" AS neighbour_id, sum(a.w * b.w)::float8 AS score
          FROM items a JOIN items b ON b.visit = a.visit AND b."listing_id" <> a."listing_id"
          WHERE a.visit IN (SELECT visit FROM visits)
          GROUP BY 1, 2
        ),
        live AS (
          SELECT p.*, row_number() OVER (PARTITION BY p."listing_id" ORDER BY p.score DESC, p.neighbour_id) AS n
          FROM pairs p
          JOIN "classified_listings" l ON l."id" = p."listing_id" AND l."status" = 'active' AND l."on_shop"
          JOIN "classified_listings" m ON m."id" = p.neighbour_id AND m."status" = 'active' AND m."on_shop"
        )
        INSERT INTO "listing_neighbours" ("listing_id", "neighbour_id", "score")
        SELECT "listing_id", neighbour_id, score FROM live WHERE n <= ${neighboursEach}`;
    }, { timeout: 120_000 });
  }

  /** Short memory: events after 90 days, profiles idle 180 days, searches per day after about 13 months. */
  async purge(now = new Date()) {
    const events = await this.prisma.discoveryEvent.deleteMany({ where: { at: { lt: new Date(now.getTime() - eventsKeptDays * dayMs) } } });
    const profiles = await this.prisma.interestProfile.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - profilesKeptDays * dayMs) } } });
    const searches = await this.prisma.searchQueryDay.deleteMany({ where: { day: { lt: new Date(now.getTime() - searchDaysKept * dayMs) } } });
    return { events: events.count, profiles: profiles.count, search_days: searches.count };
  }

  /** The daily part (the `marketing` job): "people also viewed", then retention. */
  async daily(now = new Date()) {
    return { neighbours: await this.refreshNeighbours(now), ...(await this.purge(now)) };
  }
}
