import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { ClassifiedSellerScore } from '../../generated/prisma/client.js';
import { SettingsService } from '../../settings/settings.service.js';
import { bandLabels, type Band, metricKeys, type Metrics, minSamples, publicScores } from './metrics.js';

/** The line under every summary, linking to how Anjio rates sellers. */
export const summaryCredit = "Written by Anjio, Udozo's AI assistant, from Udozo's figures. It can be imperfect.";
export const howItWorksPath = '/help/how-anjio-rates-sellers';

export type ScoreDetails = { tips?: string[]; flags?: string[] };

const emptyMetrics = (): Metrics => Object.fromEntries(metricKeys.map(key => [key, null])) as Metrics;
export const metricsOf = (row: Pick<ClassifiedSellerScore, 'metrics'> | null): Metrics => ({ ...emptyMetrics(), ...((row?.metrics ?? {}) as Partial<Metrics>) });
export const detailsOf = (row: Pick<ClassifiedSellerScore, 'details'> | null): ScoreDetails => (row?.details ?? {}) as ScoreDetails;

/**
 * Anjio's scores as each audience sees them (docs/UDOZO_RATINGS_PLAN.md phase 3), read from the nightly row. The public
 * sees words only where `seller_scores` is on for the market, and the summary only where `seller_score_summaries` is
 * (never in metadata). The seller sees their numbers and tips whatever the switches say; admins everything.
 */
@Injectable()
export class SellerScoreReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  publicOn(country: string) {
    return this.settings.isOnForCountry('seller_scores', country);
  }

  async summariesOn(country: string) {
    return (await this.settings.isOnForCountry('seller_score_summaries', country)) && (await this.settings.isOnForCountry('classifieds_assistant', country));
  }

  row(sellerId: string) {
    return this.prisma.classifiedSellerScore.findUnique({ where: { sellerId } });
  }

  private summaryOf(row: ClassifiedSellerScore | null) {
    return row?.summaryText && !row.summaryHiddenAt ? { text: row.summaryText, credit: summaryCredit, how_it_works: howItWorksPath, written_at: row.summaryWrittenAt?.toISOString() ?? null } : null;
  }

  /** On a seller's public page: null where scores are not public in the market. */
  async forPublic(sellerId: string, country: string) {
    if (!(await this.publicOn(country))) return null;
    const row = await this.row(sellerId);
    return { ...publicScores(metricsOf(row), row?.overallScore ?? null), summary: (await this.summariesOn(country)) ? this.summaryOf(row) : null, how_it_works: howItWorksPath };
  }

  /** The seller's own view: every number with its sample and minimum, tips, the summary and whether it is public yet. */
  async forSeller(sellerId: string, country: string) {
    const [row, isPublic, summaries] = await Promise.all([this.row(sellerId), this.publicOn(country), this.summariesOn(country)]);
    const metrics = metricsOf(row);
    return {
      object: 'classified_seller_scores' as const,
      public: isPublic,
      computed_at: row?.computedAt.toISOString() ?? null,
      overall: row?.overallScore ?? null,
      band: (row?.band as Band | null) ?? null,
      band_label: row?.band ? bandLabels[row.band as Band] : null,
      metrics: metricKeys.map(key => ({ key, score: metrics[key]?.score ?? null, n: metrics[key]?.n ?? 0, minimum: minSamples[key], public: key !== 'salesmanship' })),
      tips: detailsOf(row).tips ?? [],
      public_view: publicScores(metrics, row?.overallScore ?? null),
      summary: summaries ? this.summaryOf(row) : null,
      summary_reported: Boolean(row?.summaryReportedAt),
      how_it_works: howItWorksPath,
    };
  }

  /** Admins: the row as it is, flags and the summary's cost included. */
  async forAdmin(sellerId: string) {
    const row = await this.row(sellerId);
    const metrics = metricsOf(row);
    return {
      object: 'classified_admin_seller_scores' as const,
      seller_id: sellerId,
      country: row?.country ?? null,
      computed_at: row?.computedAt.toISOString() ?? null,
      overall: row?.overallScore ?? null,
      band: row?.band ?? null,
      metrics: metricKeys.map(key => ({ key, ...(metrics[key] ?? { score: null, n: 0 }), minimum: minSamples[key] })),
      tips: detailsOf(row).tips ?? [],
      flags: detailsOf(row).flags ?? [],
      public_view: publicScores(metrics, row?.overallScore ?? null),
      summary: row?.summaryText
        ? {
            text: row.summaryText,
            provider: row.summaryProvider,
            model: row.summaryModel,
            tokens: { input: row.summaryInputTokens, output: row.summaryOutputTokens },
            cost_usd: row.summaryCostMicros === null ? null : Number(row.summaryCostMicros) / 1_000_000,
            written_at: row.summaryWrittenAt?.toISOString() ?? null,
            hidden: row.summaryHiddenAt ? { at: row.summaryHiddenAt.toISOString(), reason: row.summaryHiddenReason } : null,
            reported: row.summaryReportedAt ? { at: row.summaryReportedAt.toISOString(), details: row.summaryReport } : null,
          }
        : null,
    };
  }
}
