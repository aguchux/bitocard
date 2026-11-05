import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SettingsService } from '../../settings/settings.service.js';

const yearMs = 365 * 86_400_000;

export type ReviewSummary = { positive: number; neutral: number; negative: number; counted: number; positive_pct: number | null };

/** The positive share, a whole percentage, once enough positive and negative reviews count (neutral left out). */
export function positivePct(positive: number, negative: number, minShown: number) {
  const counted = positive + negative;
  return counted >= minShown && counted > 0 ? Math.round((positive / counted) * 100) : null;
}

/**
 * Sellers' review summaries (docs/UDOZO_RATINGS_PLAN.md phase 1): the last 12 months' published reviews, **one voice per
 * reviewer** (their latest review of that seller only), the positive share shown from the market's minimum. Only where
 * reviews are open in the market (`classifieds_reviews`); null elsewhere.
 */
@Injectable()
export class ReviewStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Whether reviews are open in a market. */
  open(country: string) {
    return this.settings.isOnForCountry('classifieds_reviews', country);
  }

  async minShown(country: string) {
    return (await this.prisma.classifiedMarketSettings.findUnique({ where: { country }, select: { reviewMinShown: true } }))?.reviewMinShown ?? 3;
  }

  /** Each seller's summary in one market, or null for all while reviews are closed there. */
  async summaries(sellerIds: string[], country: string, now = new Date()): Promise<Map<string, ReviewSummary> | null> {
    if (!(await this.open(country))) return null;
    const ids = [...new Set(sellerIds)];
    const result = new Map<string, ReviewSummary>(ids.map(id => [id, { positive: 0, neutral: 0, negative: 0, counted: 0, positive_pct: null }]));
    if (!ids.length) return result;
    const rows = await this.prisma.$queryRaw<{ seller_id: string; rating: string; n: bigint }[]>`
      SELECT x."seller_id", x."rating", count(*) AS n FROM (
        SELECT DISTINCT ON (r."seller_id", r."reviewer_id") r."seller_id", r."rating"
        FROM "classified_reviews" r
        WHERE r."seller_id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND r."status" = 'published' AND r."created_at" > ${new Date(now.getTime() - yearMs)}
        ORDER BY r."seller_id", r."reviewer_id", r."created_at" DESC
      ) x GROUP BY x."seller_id", x."rating"`;
    for (const row of rows) {
      const summary = result.get(row.seller_id)!;
      if (row.rating === 'positive' || row.rating === 'neutral' || row.rating === 'negative') summary[row.rating] = Number(row.n);
    }
    const min = await this.minShown(country);
    for (const summary of result.values()) {
      summary.counted = summary.positive + summary.negative;
      summary.positive_pct = positivePct(summary.positive, summary.negative, min);
    }
    return result;
  }

  async summary(sellerId: string, country: string) {
    return (await this.summaries([sellerId], country))?.get(sellerId) ?? null;
  }
}
