import { bitocardApi } from '../base';
import type { ListingReviewCode } from './classifieds';

/** Udozo's posting journeys (Reports > Posting journeys, operations and support): `PostingInsightsService` in Udozo's API. */
export const postingSellSources = ['header', 'header_phone', 'my_listings', 'empty_state', 'start_here', 'invite', 'pwa', 'reseller', 'username', 'direct'] as const;
export const postingSources = [...postingSellSources, 'api', 'resumed', 'unknown'] as const;
export const postingMilestones = ['opened', 'draft', 'step_media', 'step_details', 'step_where', 'step_place', 'step_post', 'submitted', 'live', 'first_view', 'first_contact', 'first_lead', 'sold'] as const;
export const postingStuckMilestones = ['opened', 'draft', 'step_media', 'step_details', 'step_where', 'step_place', 'step_post', 'submitted', 'resubmitted'] as const;
export const postingStatuses = ['in_progress', 'stuck', 'in_review', 'sent_back', 'live', 'sold', 'abandoned', 'removed'] as const;
export const postingSummaryDays = [7, 30, 90, 365] as const;

export type PostingSource = (typeof postingSources)[number];
export type PostingMilestone = (typeof postingMilestones)[number];
export type PostingStuckMilestone = (typeof postingStuckMilestones)[number];
export type PostingStatus = (typeof postingStatuses)[number];

export type PostingJourney = {
  object: 'posting_journey';
  id: string;
  status: PostingStatus;
  stage: 'composing' | 'in_review' | 'sent_back' | 'live' | 'abandoned' | 'removed';
  /** Where an unfinished journey is (or got stuck); null once submitted (or sent back, `resubmitted`). */
  stuck_at: PostingStuckMilestone | null;
  source: PostingSource | string;
  country: string | null;
  device: string | null;
  seller: { id: string; name: string; email: string };
  /** The ad, once there is a draft; `status: 'deleted'` once a draft is gone. */
  listing: { id: string; ref: number | null; sku: string | null; title: string | null; status: string } | null;
  category: { id: string; name: string | null } | null;
  /** The furthest step of Post an ad reached. */
  furthest_step: 'basics' | 'media' | 'details' | 'where' | 'place' | 'post' | null;
  milestones: Record<'opened' | 'draft' | 'first_photo' | 'submitted' | 'review_queued' | 'reviewed' | 'sent_back' | 'resubmitted' | 'live' | 'first_view' | 'first_chat' | 'first_call' | 'first_lead' | 'sold' | 'ended', string | null>;
  live_via: 'direct' | 'review' | null;
  ended_reason: 'never_drafted' | 'draft_deleted' | 'deleted' | 'removed' | null;
  review_flags: string[];
  reviews: number;
  sent_back_count: number;
  last_reject_code: ListingReviewCode | null;
  last_error: { step: string | null; code: string } | null;
  refusals: number;
  submit_attempts: number;
  steps: number;
  started_at: string;
  last_event_at: string;
  /** When Udozo deletes it: 30 days after its last step if never live, else 90 days after going live (30 after selling). */
  deletes_at: string;
};

/** A step: from the API (`api`), Post an ad's wizard (`client`: never what was typed) or Udozo itself (`system`). */
export type PostingJourneyEvent = { id: string; origin: 'api' | 'client' | 'system'; step: string; outcome: 'ok' | 'refused'; code: string | null; param: string | null; device: string | null; at: string };
export type PostingJourneyDetail = PostingJourney & { events: PostingJourneyEvent[] };

export type PostingBreakdown = { key: string; label: string | null; started: number; submitted: number; live: number };
export type PostingSummary = {
  object: 'posting_summary';
  days: number;
  country: string | null;
  source: string | null;
  category: string | null;
  from: string;
  to: string;
  visits: { signed_in: number; signed_out: number };
  totals: {
    started: number;
    submitted: number;
    live: number;
    sold: number;
    abandoned: number;
    removed: number;
    post_rate: number | null;
    in_progress: number;
    stuck: number;
    in_review_now: number;
    sent_back_now: number;
    median_minutes_to_submit: number | null;
    median_minutes_to_live: number | null;
    median_minutes_to_first_contact: number | null;
    average_minutes_to_submit: number | null;
    average_minutes_to_live: number | null;
    average_minutes_to_first_contact: number | null;
  };
  funnel: Array<{ milestone: PostingMilestone; count: number }>;
  live_split: { direct: number; after_review: number };
  stuck_at: Array<{ milestone: PostingStuckMilestone; count: number }>;
  review: {
    queued: number;
    approved: number;
    sent_back: number;
    removed: number;
    approval_rate: number | null;
    median_minutes_to_review: number | null;
    average_minutes_to_review: number | null;
    reasons: Array<{ code: ListingReviewCode | string; count: number }>;
    flags: Array<{ flag: string; count: number }>;
  };
  blockers: Array<{ origin: 'api' | 'client' | string; step: string; code: string; param: string | null; refusals: number; journeys: number }>;
  daily: Array<{ day: string; visits: number; started: number; submitted: number; live: number }>;
  sources: PostingBreakdown[];
  categories: PostingBreakdown[];
  devices: PostingBreakdown[];
  countries: PostingBreakdown[];
};

export type PostingSummaryFilters = { days?: number; country?: string; source?: string; category?: string };
export type PostingJourneyFilters = { status?: PostingStatus; stuck_at?: PostingStuckMilestone; code?: string; source?: string; category?: string; country?: string; q?: string; limit?: number; offset?: number };

const withQuery = (path: string, filters: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  const text = params.toString();
  return `${path}${text ? `?${text}` : ''}`;
};

export const postingJourneysApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    postingSummary: build.query<PostingSummary, PostingSummaryFilters>({ query: filters => withQuery('/v1/admin/posting-journeys/summary', filters) }),
    postingJourneys: build.query<{ object: 'list'; data: PostingJourney[]; total: number; has_more: boolean }, PostingJourneyFilters>({ query: filters => withQuery('/v1/admin/posting-journeys', filters) }),
    postingJourney: build.query<PostingJourneyDetail, string>({ query: id => `/v1/admin/posting-journeys/${id}` }),
  }),
});

export const { usePostingSummaryQuery, usePostingJourneysQuery, usePostingJourneyQuery } = postingJourneysApi;
