import { bitocardApi } from '../base';

// Udozo's reviews (Udozo's API only: /v1/admin/classifieds/reviews). Buyers who completed a purchase review the seller;
// reviews are conversations; moderators work the reported and held ones and can block reviewers.

export type AdminReviewStatus = 'published' | 'held' | 'removed' | 'withdrawn';
export type AdminReviewTab = 'reported' | 'held' | 'removed' | 'all';
export type AdminReviewAction = 'publish' | 'remove' | 'restore' | 'lock' | 'unlock';

export type AdminReview = {
  object: 'classified_admin_review';
  id: string;
  status: AdminReviewStatus;
  held_reason: string | null;
  removed_reason: string | null;
  rating: 'positive' | 'neutral' | 'negative';
  aspects: Record<string, 'up' | 'down'>;
  body: string | null;
  country: string;
  source: 'safe_pay' | 'buy_order';
  product: { key: string; label: string };
  listing: { id: string; title: string | null; path: string };
  reviewer: { id: string; name: string };
  seller: { id: string; name: string };
  edits: number;
  edited_after_reply: boolean;
  locked: boolean;
  post_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminReviewListItem = AdminReview & { open_reports: number; threat: boolean };

export type AdminReviewPost = {
  id: string;
  role: 'seller' | 'reviewer' | 'buyer';
  name: string;
  avatar_url: string | null;
  stance: 'agree' | 'disagree' | 'context' | null;
  reply_to: string | null;
  body: string | null;
  removed: boolean;
  edited: boolean;
  created_at: string;
  author: { id: string; name: string };
  status: 'published' | 'removed' | 'deleted';
  removed_reason: string | null;
};

export type AdminReviewReport = {
  id: string;
  post_id: string | null;
  reason: string;
  details: string | null;
  status: 'open' | 'upheld' | 'dismissed';
  note: string | null;
  reporter: { id: string; name: string; email: string };
  decided_at: string | null;
  created_at: string;
};

export type AdminReviewDetail = AdminReview & {
  versions: Array<{ rating: string; aspects: Record<string, 'up' | 'down'>; body: string | null; at: string }>;
  purchase: { source: 'safe_pay' | 'buy_order'; order: { id: string; number: string } | null; buy_order: { id: string; number: string } | null; completed_at: string };
  posts: AdminReviewPost[];
  reports: AdminReviewReport[];
};

export type AdminReviewFilter = { tab?: AdminReviewTab; country?: string; seller?: string; reviewer?: string; limit?: number; offset?: number };

const listTag = { type: 'ClassifiedListing' as const, id: 'REVIEWS' };
const detailTag = (id: string) => ({ type: 'ClassifiedListing' as const, id: `review:${id}` });
const clean = (values: Record<string, string | number | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));

export const adminUdozoReviewsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    reviews: build.query<{ object: 'list'; counts: { reported: number; held: number }; data: AdminReviewListItem[]; total: number }, AdminReviewFilter | void>({
      query: filter => ({ url: '/v1/admin/classifieds/reviews', params: clean({ limit: 50, ...(filter ?? {}) }) }),
      providesTags: [listTag],
    }),
    review: build.query<AdminReviewDetail, string>({
      query: id => `/v1/admin/classifieds/reviews/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [detailTag(id)],
    }),
    /** publish (a held review), remove, restore, lock or unlock, with why; audited. */
    moderateReview: build.mutation<AdminReviewDetail, { id: string; action: AdminReviewAction; reason: string }>({
      query: ({ id, action, reason }) => ({ url: `/v1/admin/classifieds/reviews/${encodeURIComponent(id)}/${action}`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [detailTag(id), listTag, 'Activity'],
    }),
    removeReviewPost: build.mutation<AdminReviewDetail, { reviewId: string; postId: string; reason: string }>({
      query: ({ postId, reason }) => ({ url: `/v1/admin/classifieds/review-posts/${encodeURIComponent(postId)}/remove`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { reviewId }) => [detailTag(reviewId), listTag, 'Activity'],
    }),
    decideReviewReport: build.mutation<AdminReviewDetail, { reviewId: string; reportId: string; decision: 'upheld' | 'dismissed'; note: string }>({
      query: ({ reportId, decision, note }) => ({ url: `/v1/admin/classifieds/review-reports/${encodeURIComponent(reportId)}/decide`, method: 'POST', body: { decision, note } }),
      invalidatesTags: (_result, _error, { reviewId }) => [detailTag(reviewId), listTag, 'Activity'],
    }),
    /** Stops (or lets again) a customer writing reviews: 180 days by default. */
    blockReviewer: build.mutation<{ reviews_blocked_until: string | null }, { customer: string; blocked: boolean; reason: string; days?: number }>({
      query: ({ customer, ...body }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(customer)}/reviews-block`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { customer }) => [{ type: 'ClassifiedSeller', id: customer }, { type: 'ClassifiedSeller', id: 'LIST' }, 'Activity'],
    }),
  }),
});

export const { useReviewsQuery, useReviewQuery, useModerateReviewMutation, useRemoveReviewPostMutation, useDecideReviewReportMutation, useBlockReviewerMutation } = adminUdozoReviewsApi;

// Udozo's private ratings of how sellers deal with buyers before a sale (docs/UDOZO_RATINGS_PLAN.md phase 2): admins see
// who rated whom and the notes; a safety tag flags one; a rating can be left out of the seller's summary.

export type AdminInteractionRating = {
  object: 'classified_admin_interaction_rating';
  id: string;
  channel: 'call' | 'chat' | 'callback' | 'contact';
  country: string;
  responsiveness: number;
  helpfulness: number;
  courtesy: number;
  tags: string[];
  comment: string | null;
  flagged: boolean;
  excluded: { at: string; reason: string | null } | null;
  rater: { id: string; name: string; email: string };
  seller: { id: string; name: string; email: string };
  listing: { id: string; title: string | null; path: string };
  created_at: string;
  updated_at: string;
};

export type AdminInteractionScores = { responsiveness: number | null; helpfulness: number | null; courtesy: number | null };

export type AdminSellerInteractionRatings = {
  object: 'classified_admin_interaction_summary';
  seller_id: string;
  minimum: number;
  shown_to_seller: boolean;
  excluded: number;
  count: number;
  scores: AdminInteractionScores;
  tags: Array<{ tag: string; count: number }>;
  data: AdminInteractionRating[];
};

export type AdminInteractionRatingFilter = { flagged?: boolean; country?: string; seller?: string; rater?: string; limit?: number; offset?: number };

const ratingsTag = { type: 'ClassifiedListing' as const, id: 'INTERACTION_RATINGS' };
const sellerRatingsTag = (id: string) => ({ type: 'ClassifiedListing' as const, id: `interaction_ratings:${id}` });

export const adminUdozoInteractionRatingsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    interactionRatings: build.query<{ object: 'list'; counts: { flagged: number }; data: AdminInteractionRating[]; total: number }, AdminInteractionRatingFilter | void>({
      query: filter => ({ url: '/v1/admin/classifieds/interaction-ratings', params: clean({ limit: 50, ...(filter ?? {}), flagged: filter?.flagged ? 'true' : undefined }) }),
      providesTags: [ratingsTag],
    }),
    sellerInteractionRatings: build.query<AdminSellerInteractionRatings, string>({
      query: id => `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/ratings`,
      providesTags: (_result, _error, id) => [sellerRatingsTag(id)],
    }),
    /** Leaves a rating out of the seller's summary (`excluded: true`) or puts it back, with why; audited. */
    excludeInteractionRating: build.mutation<AdminInteractionRating, { id: string; excluded: boolean; reason: string; seller?: string }>({
      query: ({ id, excluded, reason }) => ({ url: `/v1/admin/classifieds/interaction-ratings/${encodeURIComponent(id)}/${excluded ? 'exclude' : 'restore'}`, method: 'POST', body: { reason } }),
      invalidatesTags: (result, _error, { seller }) => [ratingsTag, sellerRatingsTag(seller ?? result?.seller.id ?? ''), 'Activity'],
    }),
  }),
});

export const { useInteractionRatingsQuery, useSellerInteractionRatingsQuery, useExcludeInteractionRatingMutation } = adminUdozoInteractionRatingsApi;
