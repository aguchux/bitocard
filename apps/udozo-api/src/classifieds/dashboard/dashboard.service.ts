import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { ListingsService } from '../listings.service.js';
import { ReviewStatsService } from '../reviews/stats.service.js';
import { BoardService } from './board.service.js';

/** The periods the dashboard reports on, in days ending today (UTC). */
export const dashboardPeriods = [7, 30, 90] as const;
export type DashboardPeriod = (typeof dashboardPeriods)[number];

/** What is counted each day: views of the seller's listings, buyers getting in touch, chats, saves and completed sales. */
export const dashboardMetrics = ['views', 'leads', 'chats', 'saves', 'sales'] as const;
export type DashboardMetric = (typeof dashboardMetrics)[number];

const dayMs = 86_400_000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** The change from the period before, as a whole percentage; null with nothing before to compare with. */
export function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Every day of the period, oldest first, each with every metric (0 for a day with nothing). */
export function emptySeries(since: Date, days: number) {
  return Array.from({ length: days }, (_, index) => ({ day: dayKey(new Date(since.getTime() + index * dayMs)), views: 0, leads: 0, chats: 0, saves: 0, sales: 0 }));
}

/**
 * The account dashboard (8 November 2026, the owner's request; udozo.com's `/account`, My listings moving to
 * `/account/listings`): one customer's own figures for a period (7, 30 or 90 days ending today, UTC) against the period
 * before, a day-by-day series for the charts, their best listings in the period, their listings by state, sales by
 * currency, how often they answered chats, their review summary, and Udozo's message board for their market. Only what
 * is theirs: views and leads of their own listings, their own chats as the seller, their own sales and purchases;
 * never a buyer's name or anything another seller could not see on their own dashboard.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly reviews: ReviewStatsService,
    private readonly board: BoardService,
  ) {}

  async forCustomer(customer: CustomerWithStore, days: DashboardPeriod = 30, now = new Date()) {
    const country = await this.listings.sellerCountry(customer);
    const me = customer.id;
    const today = startOfDay(now);
    const since = new Date(today.getTime() - (days - 1) * dayMs);
    const before = new Date(since.getTime() - days * dayMs);
    const mine = { customerId: me };

    const [byStatus, viewDays, topViews, leads, chats, saves, sold, bought, review, board] = await Promise.all([
      this.prisma.classifiedListing.groupBy({ by: ['status'], where: { ...mine, status: { not: 'deleted' } }, _count: { _all: true }, _sum: { views: true, leads: true } }),
      this.prisma.classifiedListingViewDay.groupBy({ by: ['day'], where: { day: { gte: before }, listing: mine }, _sum: { views: true } }),
      this.prisma.classifiedListingViewDay.groupBy({ by: ['listingId'], where: { day: { gte: since }, listing: mine }, _sum: { views: true }, orderBy: { _sum: { views: 'desc' } }, take: 5 }),
      this.prisma.classifiedLead.findMany({ where: { firstAt: { gte: before }, listing: mine }, select: { firstAt: true, listingId: true }, take: 50_000 }),
      this.prisma.classifiedConversation.findMany({ where: { sellerId: me, createdAt: { gte: before } }, select: { createdAt: true, sellerRepliedAt: true }, take: 50_000 }),
      this.prisma.classifiedFavourite.findMany({ where: { createdAt: { gte: before }, listing: mine }, select: { createdAt: true }, take: 50_000 }),
      this.prisma.classifiedPurchase.findMany({
        where: { sellerId: me, completedAt: { gte: before } },
        select: { completedAt: true, order: { select: { priceMinor: true, currency: true } }, buyOrder: { select: { priceMinor: true, currency: true } } },
        take: 50_000,
      }),
      this.prisma.classifiedPurchase.count({ where: { buyerId: me, completedAt: { gte: since } } }),
      this.reviews.summary(me, country).catch(() => null),
      this.board.showing(country),
    ]);

    const series = emptySeries(since, days);
    const index = new Map(series.map((row, at) => [row.day, at]));
    const previous: Record<DashboardMetric, number> = { views: 0, leads: 0, chats: 0, saves: 0, sales: 0 };
    const add = (metric: DashboardMetric, at: Date, amount = 1) => {
      const key = dayKey(at);
      const row = index.get(key);
      if (row !== undefined) series[row]![metric] += amount;
      else if (at >= before && at < since) previous[metric] += amount;
    };
    for (const row of viewDays) add('views', row.day, row._sum.views ?? 0);
    for (const row of leads) add('leads', row.firstAt);
    for (const row of chats) add('chats', row.createdAt);
    for (const row of saves) add('saves', row.createdAt);
    const value = new Map<string, bigint>();
    for (const row of sold) {
      add('sales', row.completedAt);
      const paid = row.order ?? row.buyOrder;
      if (paid && row.completedAt >= since) value.set(paid.currency, (value.get(paid.currency) ?? 0n) + paid.priceMinor);
    }

    const totals = Object.fromEntries(
      dashboardMetrics.map(metric => {
        const current = series.reduce((sum, row) => sum + row[metric], 0);
        return [metric, { value: current, previous: previous[metric], change_pct: changePct(current, previous[metric]) }];
      }),
    ) as Record<DashboardMetric, { value: number; previous: number; change_pct: number | null }>;

    const periodChats = chats.filter(row => row.createdAt >= since);
    const replied = periodChats.filter(row => row.sellerRepliedAt).length;

    const status = (name: string) => byStatus.find(row => row.status === name)?._count._all ?? 0;
    const topIds = topViews.map(row => row.listingId);
    const topRows = topIds.length ? await this.prisma.classifiedListing.findMany({ where: { id: { in: topIds }, ...mine }, select: { id: true, title: true, status: true } }) : [];
    const leadsBy = new Map<string, number>();
    for (const row of leads) if (row.firstAt >= since) leadsBy.set(row.listingId, (leadsBy.get(row.listingId) ?? 0) + 1);

    return {
      object: 'account_dashboard' as const,
      country,
      days,
      since: dayKey(since),
      until: dayKey(today),
      listings: {
        active: status('active'),
        in_review: status('pending_review'),
        drafts: status('draft'),
        needs_changes: status('rejected'),
        sold: status('sold'),
        expired: status('expired'),
        views: byStatus.reduce((sum, row) => sum + (row._sum.views ?? 0), 0),
        leads: byStatus.reduce((sum, row) => sum + (row._sum.leads ?? 0), 0),
      },
      totals,
      /** Sales completed in the period, by currency (what the buyers paid for the items, in minor units). */
      sales_value: [...value.entries()].map(([currency, amount]) => ({ currency, amount: Number(amount) })),
      /** The share of the period's new chats the seller answered, a whole percentage; null with none. */
      response_rate: periodChats.length ? Math.round((replied / periodChats.length) * 100) : null,
      purchases: bought,
      reviews: review ? { counted: review.counted, positive_pct: review.positive_pct } : null,
      series,
      top_listings: topIds.flatMap(id => {
        const row = topRows.find(item => item.id === id);
        return row ? [{ id: row.id, title: row.title, status: row.status, views: topViews.find(item => item.listingId === id)?._sum.views ?? 0, leads: leadsBy.get(id) ?? 0 }] : [];
      }),
      board,
    };
  }
}
