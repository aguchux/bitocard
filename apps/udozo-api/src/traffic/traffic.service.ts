import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { classify, cleanTag, type LandingKind, landingKinds, landingOf, type TrafficChannel, trafficChannels } from './sources.js';

/** Crawlers, link previews and monitors: never visitors. */
const bots = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|embedly|curl|wget|python|axios|node-fetch|go-http|java\//i;
/** Daily totals are kept about 13 months. */
const keepDays = 400;
/** The signature's time may be this far either side of now. */
const skewSeconds = 300;
/** An account is credited to the visit that led to it only within a day of signing up. */
const attributeWithinMs = 86_400_000;

export const summaryPeriods = [7, 30, 90, 365] as const;

export type VisitInput = { path: string; params: Record<string, string>; referrer: string | null; userAgent: string };
export type AttributionInput = { params: Record<string, string>; referrer: string | null; path: string };

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` keyed with `STORE_SERVER_SECRET`: only udozo.com's server counts visits. */
export function trafficSignature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export function signatureValid(header: string | undefined, body: Buffer | string | undefined, secret: string | undefined, now = Date.now()) {
  if (!header || !secret || body === undefined) return false;
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now / 1000 - t) > skewSeconds || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${typeof body === 'string' ? body : body.toString('utf8')}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1!, 'hex'));
}

const dayKey = (time: Date) => time.toISOString().slice(0, 10);

/**
 * Where udozo.com's visitors come from (8 November 2026, the owner's request), so ads can be aimed where they work.
 * udozo.com's server reports each landing from outside (another site, an ad, a campaign link, or typed in), signed
 * with the secret it shares with the API, and it is counted for the day by channel, source, medium, campaign, the
 * kind of page and the market: no address, click id or identifier is kept, so it needs no consent. An account is
 * credited to the visit that led to it only when the visitor chose Accept all (udozo.com then keeps `udz_src`).
 */
@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get secret() {
    return this.config.STORE_SERVER_SECRET;
  }

  /** udozo.com's own hosts (its stores' subdomains included): never a referrer. */
  ownHosts() {
    let host = 'udozo.com';
    try {
      host = new URL(String(this.integrations.config.STOREFRONT_URL ?? 'https://udozo.com')).hostname.toLowerCase();
    } catch {
      // The default stands.
    }
    return [...new Set([host.replace(/^www\./, ''), 'udozo.com', 'localhost'])];
  }

  /** Counts one landing; a robot's, or one that is not a page, is ignored. Never throws. */
  async recordVisit(input: VisitInput, now = new Date()) {
    try {
      if (!input.userAgent || bots.test(input.userAgent)) return { counted: false };
      const source = classify(input.params, input.referrer, this.ownHosts());
      const landing = landingOf(input.path);
      const day = new Date(`${dayKey(now)}T00:00:00Z`);
      await this.prisma.$executeRaw`
        INSERT INTO traffic_source_days (day, country, channel, source, medium, campaign, landing, visits)
        VALUES (${day}::date, ${landing.country ?? 'WW'}, ${source.channel}, ${source.source}, ${source.medium}, ${source.campaign}, ${landing.kind}, 1)
        ON CONFLICT (day, country, channel, source, medium, campaign, landing) DO UPDATE SET visits = traffic_source_days.visits + 1`;
      return { counted: true, ...source, landing: landing.kind };
    } catch (error) {
      this.logger.warn(`A visit could not be counted: ${(error as Error).message}`);
      return { counted: false };
    }
  }

  /**
   * Credits a new account (made in the last day, not credited yet) to the visit that led to it, from what udozo.com
   * kept with the visitor's consent. Only the derived words are kept.
   */
  async attribute(customer: CustomerWithStore, input: AttributionInput, now = new Date()) {
    if (customer.acquisitionChannel || now.getTime() - customer.createdAt.getTime() > attributeWithinMs) return { object: 'attribution' as const, attributed: false };
    const source = classify(input.params, input.referrer, this.ownHosts());
    const landing = landingOf(input.path).kind;
    const { count } = await this.prisma.customer.updateMany({
      where: { id: customer.id, acquisitionChannel: null },
      data: { acquisitionChannel: source.channel, acquisitionSource: source.source, acquisitionMedium: source.medium || null, acquisitionCampaign: source.campaign || null, acquisitionLanding: landing, acquiredAt: now },
    });
    return { object: 'attribution' as const, attributed: count === 1, channel: source.channel, source: source.source };
  }

  /**
   * Reports > Traffic sources: landings by channel, source, campaign, page and day over the period, and sign-ups by
   * where they came from (only those whose visitors allowed it), for one market or all of them.
   */
  async summary(filter: { days: number; country?: string }, now = new Date()) {
    const today = new Date(`${dayKey(now)}T00:00:00Z`);
    const since = new Date(today.getTime() - (filter.days - 1) * 86_400_000);
    const before = new Date(since.getTime() - filter.days * 86_400_000);
    const country = filter.country?.toUpperCase();
    const where = { day: { gte: since }, ...(country ? { country } : {}) };
    const [rows, previous, signups, attributed] = await Promise.all([
      this.prisma.trafficSourceDay.findMany({ where, select: { day: true, channel: true, source: true, medium: true, campaign: true, landing: true, visits: true, country: true } }),
      this.prisma.trafficSourceDay.aggregate({ where: { day: { gte: before, lt: since }, ...(country ? { country } : {}) }, _sum: { visits: true } }),
      this.prisma.customer.count({ where: { createdAt: { gte: since }, store: { reseller: { house: true } }, ...(country ? { country } : {}) } }),
      this.prisma.customer.groupBy({
        by: ['acquisitionChannel', 'acquisitionSource'],
        where: { createdAt: { gte: since }, acquisitionChannel: { not: null }, store: { reseller: { house: true } }, ...(country ? { country } : {}) },
        _count: { _all: true },
      }),
    ]);

    const add = <K extends string>(map: Map<K, number>, key: K, value: number) => map.set(key, (map.get(key) ?? 0) + value);
    const channels = new Map<TrafficChannel, number>();
    const sources = new Map<string, number>();
    const campaigns = new Map<string, number>();
    const landings = new Map<LandingKind, number>();
    const markets = new Map<string, number>();
    const days = new Map<string, Map<TrafficChannel, number>>();
    let total = 0;
    for (const row of rows) {
      total += row.visits;
      const channel = row.channel as TrafficChannel;
      add(channels, channel, row.visits);
      add(sources, `${channel}|${row.source}`, row.visits);
      if (row.campaign || row.medium) add(campaigns, `${row.source}|${row.medium}|${row.campaign}`, row.visits);
      add(landings, row.landing as LandingKind, row.visits);
      add(markets, row.country, row.visits);
      const key = dayKey(row.day);
      const day = days.get(key) ?? new Map<TrafficChannel, number>();
      add(day, channel, row.visits);
      days.set(key, day);
    }
    const signupsBy = new Map<string, number>();
    for (const row of attributed) signupsBy.set(`${row.acquisitionChannel}|${row.acquisitionSource}`, row._count._all);
    const credited = attributed.reduce((sum, row) => sum + row._count._all, 0);
    const share = (value: number) => (total ? Math.round((value / total) * 1000) / 10 : 0);
    const sorted = <T extends { visits: number }>(list: T[]) => list.sort((a, b) => b.visits - a.visits);

    return {
      object: 'traffic_summary' as const,
      days: filter.days,
      country: country ?? null,
      since: dayKey(since),
      until: dayKey(today),
      visits: total,
      previous_visits: previous._sum.visits ?? 0,
      signups,
      signups_attributed: credited,
      channels: trafficChannels.map(channel => ({ channel, visits: channels.get(channel) ?? 0, share: share(channels.get(channel) ?? 0), signups: attributed.filter(row => row.acquisitionChannel === channel).reduce((sum, row) => sum + row._count._all, 0) })),
      sources: sorted(
        [...new Set([...sources.keys(), ...signupsBy.keys()])].map(key => {
          const [channel, source] = key.split('|') as [TrafficChannel, string];
          const visits = sources.get(key) ?? 0;
          return { channel, source, visits, share: share(visits), signups: signupsBy.get(key) ?? 0 };
        }),
      ).slice(0, 50),
      campaigns: sorted(
        [...campaigns.entries()].map(([key, visits]) => {
          const [source, medium, campaign] = key.split('|') as [string, string, string];
          return { source, medium, campaign, visits };
        }),
      ).slice(0, 50),
      landings: sorted(landingKinds.map(kind => ({ landing: kind, visits: landings.get(kind) ?? 0 })).filter(item => item.visits > 0)),
      markets: sorted([...markets.entries()].map(([code, visits]) => ({ country: code, visits }))),
      daily: Array.from({ length: filter.days }, (_, index) => {
        const key = dayKey(new Date(since.getTime() + index * 86_400_000));
        const day = days.get(key);
        return { day: key, visits: day ? [...day.values()].reduce((sum, value) => sum + value, 0) : 0, ...Object.fromEntries(trafficChannels.map(channel => [channel, day?.get(channel) ?? 0])) } as { day: string; visits: number } & Record<TrafficChannel, number>;
      }),
    };
  }

  /** The daily `marketing` job: totals older than about 13 months go. */
  async purge(now = new Date()) {
    const { count } = await this.prisma.trafficSourceDay.deleteMany({ where: { day: { lt: new Date(now.getTime() - keepDays * 86_400_000) } } });
    return { traffic_days_deleted: count };
  }
}

/** Query parameters as udozo.com sends them: only the ones that say where a visit came from, each cleaned and short. */
export function sourceParams(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const keep = /^(utm_(source|medium|campaign|content|term)|gclid|gbraid|wbraid|gad_source|dclid|msclkid|ttclid|twclid|li_fat_id|sccid|epik|yclid|fbclid|igshid)$/;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 30)) {
    const name = key.toLowerCase();
    if (keep.test(name) && typeof value === 'string') out[name] = name.startsWith('utm_') ? cleanTag(value, 100) || '' : value.slice(0, 8) ? 'x' : '';
  }
  return out;
}
