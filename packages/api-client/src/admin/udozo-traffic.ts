import { bitocardApi } from '../base';

// Reports > Traffic sources on Udozo's admin (Udozo's API only: /v1/admin/traffic/summary).

export const trafficDays = [7, 30, 90, 365] as const;
export type TrafficChannel = 'paid' | 'social' | 'search' | 'messaging' | 'email' | 'referral' | 'campaign' | 'direct';
export type TrafficLanding = 'home' | 'market' | 'listing' | 'category' | 'search' | 'place' | 'seller' | 'brand' | 'start_here' | 'invite' | 'signup' | 'sell' | 'help' | 'other';

/** Landings on udozo.com by where they came from, and sign-ups credited to them (only those whose visitors chose Accept all). */
export type TrafficSummary = {
  object: 'traffic_summary';
  days: number;
  country: string | null;
  since: string;
  until: string;
  visits: number;
  previous_visits: number;
  signups: number;
  signups_attributed: number;
  channels: Array<{ channel: TrafficChannel; visits: number; share: number; signups: number }>;
  sources: Array<{ channel: TrafficChannel; source: string; visits: number; share: number; signups: number }>;
  campaigns: Array<{ source: string; medium: string; campaign: string; visits: number }>;
  landings: Array<{ landing: TrafficLanding; visits: number }>;
  markets: Array<{ country: string; visits: number }>;
  daily: Array<{ day: string; visits: number } & Record<TrafficChannel, number>>;
};

export const adminUdozoTrafficApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    trafficSummary: build.query<TrafficSummary, { days: number; country?: string }>({
      query: ({ days, country }) => ({ url: '/v1/admin/traffic/summary', params: { days, ...(country ? { country } : {}) } }),
    }),
  }),
});

export const { useTrafficSummaryQuery } = adminUdozoTrafficApi;
