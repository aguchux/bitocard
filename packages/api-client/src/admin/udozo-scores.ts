import { bitocardApi } from '../base';

// Anjio's seller scores (Udozo's API only; docs/UDOZO_RATINGS_PLAN.md phase 3): a seller's numbers, flags and summary,
// Recompute, hiding or rewriting the summary, and Reports > Seller ratings.

export type AdminScoreKey = 'response' | 'attention' | 'pricing' | 'costing' | 'reliability' | 'satisfaction' | 'salesmanship';

export type AdminSellerScores = {
  object: 'classified_admin_seller_scores';
  seller_id: string;
  country: string | null;
  computed_at: string | null;
  overall: number | null;
  band: string | null;
  metrics: Array<{ key: AdminScoreKey; score: number | null; n: number; minimum: number; [extra: string]: number | string | null }>;
  tips: string[];
  flags: string[];
  public_view: { new_seller: boolean; response: string | null; attention: string | null; band: string | null; band_label: string | null; highlights: Array<{ key: AdminScoreKey; words: string }> };
  summary: {
    text: string;
    provider: string | null;
    model: string | null;
    tokens: { input: number | null; output: number | null };
    cost_usd: number | null;
    written_at: string | null;
    hidden: { at: string; reason: string | null } | null;
    reported: { at: string; details: string | null } | null;
  } | null;
};

export type AdminScoresReport = {
  object: 'classified_seller_scores_report';
  sellers: number;
  bands: Array<{ band: string | null; label: string; count: number }>;
  summaries: { written: number; hidden: number; reported: number; this_month: { count: number; cost_usd: number } };
  /** The last 90 days. */
  moderation?: {
    reviews: { total: number; held: AdminRate; removed: AdminRate; reported: AdminRate };
    ratings: { total: number; flagged: AdminRate; excluded: AdminRate };
  };
};
export type AdminRate = { count: number; pct: number };

const tag = (id: string) => ({ type: 'ClassifiedSeller' as const, id: `scores:${id}` });
const reportTag = { type: 'ClassifiedSeller' as const, id: 'SCORES_REPORT' };

export const adminUdozoScoresApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    sellerScores: build.query<AdminSellerScores, string>({
      query: id => `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/scores`,
      providesTags: (_result, _error, id) => [tag(id)],
    }),
    scoresReport: build.query<AdminScoresReport, { country?: string } | void>({
      query: filter => ({ url: '/v1/admin/classifieds/scores/report', params: filter?.country ? { country: filter.country } : {} }),
      providesTags: [reportTag],
    }),
    /** recompute (now), regenerate (the summary), or hide and unhide the summary (with why); audited. */
    sellerScoresAction: build.mutation<AdminSellerScores, { id: string; action: 'recompute' | 'regenerate' | 'hide' | 'unhide'; reason?: string }>({
      query: ({ id, action, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/scores/${action === 'recompute' ? 'recompute' : `summary/${action}`}`, method: 'POST', body: reason ? { reason } : {} }),
      invalidatesTags: (_result, _error, { id }) => [tag(id), reportTag, 'Activity'],
    }),
  }),
});

export const { useSellerScoresQuery, useScoresReportQuery, useSellerScoresActionMutation } = adminUdozoScoresApi;
