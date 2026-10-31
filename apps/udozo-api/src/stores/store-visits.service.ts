import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/** Hosts a reseller store answers on through BitoCard: `<subdomain>.bitocard.com` (and `.localhost` in development). */
const subdomainHost = /^([a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9]))\.(?:bitocard\.com|localhost)$/;
const hostFormat = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** Crawlers, link previews and monitors: not visitors. */
const bots = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|facebookexternalhit|whatsapp|curl|wget|python|axios|node-fetch|go-http/i;
/** Daily totals are kept about 13 months. */
const keepDays = 400;
export const maxTrafficDays = 90;

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

export type VisitInput = { host: string; ip: string; userAgent: string };

/**
 * Visits to reseller stores, counted by the storefront's server for each page (never prefetches or files) without cookies
 * or anything kept about the visitor: daily views per address, and visitors told apart within the day only by an HMAC of
 * their address, browser and the host under that day's random salt. The salt and the hashes are deleted once the day is
 * over (`cleanup`), so nothing links a visitor across days or back to them.
 */
@Injectable()
export class StoreVisitsService {
  private readonly logger = new Logger(StoreVisitsService.name);
  private readonly stores = new Map<string, { id: string | null; at: number }>();
  private salts: { day: string; salt: string } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Records one page view. Never throws: counting must never break a store. */
  async record(input: VisitInput, now = Date.now()) {
    try {
      if (!input.userAgent || bots.test(input.userAgent)) return false;
      const host = input.host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
      if (!hostFormat.test(host) && !/^[a-z0-9-]+\.localhost$/.test(host)) return false;
      const storeId = await this.storeFor(host, now);
      if (!storeId) return false;
      const day = dayOf(now);
      const salt = await this.salt(day);
      const hash = createHmac('sha256', salt).update(`${input.ip}|${input.userAgent}|${host}`).digest('base64url');
      const fresh = await this.prisma.$executeRaw`
        INSERT INTO store_visitors (store_id, day, hash) VALUES (${storeId}::uuid, ${day}::date, ${hash})
        ON CONFLICT DO NOTHING`;
      await this.prisma.$executeRaw`
        INSERT INTO store_visit_days (store_id, host, day, views, visitors) VALUES (${storeId}::uuid, ${host}, ${day}::date, 1, ${fresh})
        ON CONFLICT (store_id, host, day) DO UPDATE SET views = store_visit_days.views + 1, visitors = store_visit_days.visitors + EXCLUDED.visitors`;
      return true;
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Visit not recorded');
      return false;
    }
  }

  /** The published reseller store a host serves (cached a minute), or null. */
  private async storeFor(host: string, now: number) {
    const cached = this.stores.get(host);
    if (cached && now - cached.at < 60_000) return cached.id;
    const sub = subdomainHost.exec(host)?.[1];
    const where = { status: 'published' as const, reseller: { house: false, platform: 'bitocard' as const, status: { not: 'suspended' as const } } };
    const store = sub
      ? await this.prisma.store.findFirst({ where: { ...where, subdomain: sub }, select: { id: true } })
      : (await this.prisma.storeDomain.findFirst({ where: { name: host, status: 'active', store: where }, select: { storeId: true } }))?.storeId ?? null;
    const id = typeof store === 'string' ? store : (store?.id ?? null);
    if (this.stores.size > 5_000) this.stores.clear();
    this.stores.set(host, { id, at: now });
    return id;
  }

  /** Today's random salt, made by whichever instance asks first. */
  private async salt(day: string) {
    if (this.salts?.day === day) return this.salts.salt;
    await this.prisma.$executeRaw`INSERT INTO store_visit_salts (day, salt) VALUES (${day}::date, ${randomBytes(32).toString('base64url')}) ON CONFLICT DO NOTHING`;
    const row = await this.prisma.storeVisitSalt.findUniqueOrThrow({ where: { day: new Date(`${day}T00:00:00.000Z`) } });
    this.salts = { day, salt: row.salt };
    return row.salt;
  }

  /** Deletes past days' salts and visitor hashes, and daily totals older than about 13 months. */
  async cleanup(now = Date.now()) {
    const today = new Date(`${dayOf(now)}T00:00:00.000Z`);
    const hashes = await this.prisma.storeVisitor.deleteMany({ where: { day: { lt: today } } });
    await this.prisma.storeVisitSalt.deleteMany({ where: { day: { lt: today } } });
    const totals = await this.prisma.storeVisitDay.deleteMany({ where: { day: { lt: new Date(today.getTime() - keepDays * 86_400_000) } } });
    return { visitor_hashes: hashes.count, old_days: totals.count };
  }

  /** A store's visits over the last `days` days (today included): totals, per address, and per day. */
  async traffic(storeId: string, days: number, now = Date.now()) {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), maxTrafficDays);
    const from = new Date(`${dayOf(now - (span - 1) * 86_400_000)}T00:00:00.000Z`);
    const rows = await this.prisma.storeVisitDay.findMany({ where: { storeId, day: { gte: from } }, orderBy: { day: 'asc' } });
    const byHost = new Map<string, { host: string; views: number; visitors: number }>();
    const byDay = new Map<string, { date: string; views: number; visitors: number }>();
    for (let index = 0; index < span; index += 1) {
      const date = dayOf(from.getTime() + index * 86_400_000);
      byDay.set(date, { date, views: 0, visitors: 0 });
    }
    for (const row of rows) {
      const host = byHost.get(row.host) ?? { host: row.host, views: 0, visitors: 0 };
      host.views += row.views;
      host.visitors += row.visitors;
      byHost.set(row.host, host);
      const day = byDay.get(dayOf(row.day.getTime()));
      if (day) {
        day.views += row.views;
        day.visitors += row.visitors;
      }
    }
    const hosts = [...byHost.values()].sort((a, b) => b.views - a.views || a.host.localeCompare(b.host));
    return {
      object: 'store_traffic' as const,
      days: span,
      from: dayOf(from.getTime()),
      to: dayOf(now),
      views: hosts.reduce((sum, host) => sum + host.views, 0),
      visitors: hosts.reduce((sum, host) => sum + host.visitors, 0),
      hosts,
      daily: [...byDay.values()],
    };
  }
}
