import { bitocardApi } from '../base';

/** Udozo's Reports > Discovery (operations and support): searches, clicks and personalised against holdout. */
export const discoveryDays = [7, 30, 90] as const;

type QueryCount = { query: string; searches: number; subjects: number };
export type DiscoverySummary = {
  object: 'discovery_summary';
  country: string | null;
  days: number;
  from: string;
  to: string;
  /** Whether the `personalisation` switch is on for the country chosen (or globally, with none). */
  enabled: boolean;
  totals: { subjects: number; events: number; searches: number; zero_result_searches: number; zero_result_rate: number | null };
  top_queries: QueryCount[];
  zero_result_queries: QueryCount[];
  /** Clicks and the contacts (chat, contact, call, offer, order) that followed a click from each source within the visit. */
  sources: Array<{ source: string; impressions: number; clicks: number; contacts: number; click_rate: number | null }>;
  /** For you: personalised against the 10% holdout. */
  for_you: Array<{ group: 'personalised' | 'holdout'; subjects: number; impressions: number; clicks: number; click_rate: number | null; contacts_per_subject: number | null }>;
  daily: Array<{ day: string; events: number; searches: number; subjects: number }>;
  kinds: Array<{ kind: string; events: number }>;
};

export const discoveryApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    discoverySummary: build.query<DiscoverySummary, { country?: string; days?: number }>({
      query: ({ country, days }) => {
        const params = new URLSearchParams();
        if (country) params.set('country', country);
        if (days) params.set('days', String(days));
        const text = params.toString();
        return `/v1/admin/classifieds/discovery${text ? `?${text}` : ''}`;
      },
    }),
  }),
});

export const { useDiscoverySummaryQuery } = discoveryApi;
