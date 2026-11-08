import { bitocardApi } from '../base';

/** Udozo's sign-up journeys (Reports > Sign-up journeys, operations and support): `SignupInsightsService` in Udozo's API. */
export const signupSurfaces = ['udozo', 'shq'] as const;
export const signupMilestones = ['email_entered', 'email_verified', 'phone_entered', 'phone_verified', 'account_created', 'completed'] as const;
export const signupJourneyStatuses = ['in_progress', 'stuck', 'completed'] as const;
export const signupSummaryDays = [7, 30, 90, 365] as const;

export type SignupSurface = (typeof signupSurfaces)[number];
export type SignupMilestone = (typeof signupMilestones)[number];
export type SignupJourneyStatus = (typeof signupJourneyStatuses)[number];

export type SignupJourney = {
  object: 'signup_journey';
  id: string;
  surface: SignupSurface;
  email: string;
  method: 'email' | 'google' | 'facebook' | 'whatsapp' | string;
  country: string | null;
  device: string | null;
  status: SignupJourneyStatus;
  /** The first milestone not reached (where the person is, or got stuck); null once completed. */
  stuck_at: SignupMilestone | null;
  milestones: Record<Exclude<SignupMilestone, 'completed'> | 'signed_in' | 'completed', string | null>;
  phone_skipped: boolean;
  last_error: { step: string | null; code: string } | null;
  refusals: number;
  steps: number;
  started_at: string;
  last_event_at: string;
  /** When Udozo deletes it: 7 days after completing, 30 days after the last step otherwise. */
  deletes_at: string;
};

export type SignupJourneyEvent = { id: string; step: string; outcome: 'ok' | 'refused'; code: string | null; param: string | null; device: string | null; at: string };
export type SignupJourneyDetail = SignupJourney & { account: { kind: 'customer' | 'user'; id: string } | null; events: SignupJourneyEvent[] };

type Split = { started: number; completed: number };
export type SignupSummary = {
  object: 'signup_summary';
  surface: SignupSurface;
  days: number;
  country: string | null;
  from: string;
  to: string;
  visits: number;
  totals: { started: number; completed: number; completion_rate: number | null; average_minutes_to_complete: number | null; in_progress: number; stuck: number };
  funnel: Array<{ milestone: SignupMilestone; count: number }>;
  stuck_at: Array<{ milestone: SignupMilestone; count: number }>;
  blockers: Array<{ step: string; code: string; refusals: number; journeys: number }>;
  daily: Array<{ day: string; visits: number; started: number; completed: number }>;
  methods: Array<Split & { method: string }>;
  countries: Array<Split & { country: string | null }>;
  devices: Array<Split & { device: string }>;
};

export type SignupJourneyFilters = { surface?: SignupSurface; status?: SignupJourneyStatus; stuck_at?: SignupMilestone; code?: string; country?: string; q?: string; limit?: number; offset?: number };

const withQuery = (path: string, filters: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  const text = params.toString();
  return `${path}${text ? `?${text}` : ''}`;
};

export const signupJourneysApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    signupSummary: build.query<SignupSummary, { surface: SignupSurface; days?: number; country?: string }>({ query: filters => withQuery('/v1/admin/signup-journeys/summary', filters) }),
    signupJourneys: build.query<{ object: 'list'; data: SignupJourney[]; total: number; has_more: boolean }, SignupJourneyFilters>({ query: filters => withQuery('/v1/admin/signup-journeys', filters) }),
    signupJourney: build.query<SignupJourneyDetail, string>({ query: id => `/v1/admin/signup-journeys/${id}` }),
  }),
});

export const { useSignupSummaryQuery, useSignupJourneysQuery, useSignupJourneyQuery } = signupJourneysApi;
