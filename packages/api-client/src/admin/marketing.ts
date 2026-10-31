import { bitocardApi } from '../base';

/** Udozo's Marketing pipeline (Marketplace > Marketing, every admin role): `MarketingService` in Udozo's API. */
export const marketingStages = ['reach_out', 'invitation', 'onboarding', 'follow_up', 'feedback'] as const;
export const marketingStatuses = ['not_started', 'in_progress', 'waiting', 'done', 'skipped', 'failed'] as const;
export const marketingOutcomes = ['signed_up', 'first_post', 'declined', 'no_response'] as const;
export const marketingChannels = ['whatsapp', 'jiji_chat', 'call', 'sms', 'email', 'in_person', 'other'] as const;
export const marketingLoggedKinds = ['message', 'call', 'invite', 'follow_up', 'note'] as const;

export type MarketingStage = (typeof marketingStages)[number];
export type MarketingStatus = (typeof marketingStatuses)[number];
export type MarketingOutcome = (typeof marketingOutcomes)[number];
export type MarketingChannel = (typeof marketingChannels)[number];
export type MarketingLoggedKind = (typeof marketingLoggedKinds)[number];

export type MarketingAdvert = { url: string; title: string | null; price: string | null; category: string | null; location: string | null };

export type MarketingProspect = {
  object: 'marketing_prospect';
  id: string;
  name: string;
  store_name: string | null;
  phones: string[];
  email: string | null;
  country: string;
  location: string | null;
  categories: string[];
  adverts: MarketingAdvert[];
  source: string;
  source_notes: string | null;
  stage: MarketingStage;
  stage_status: MarketingStatus;
  status_reason: string | null;
  outcome: MarketingOutcome | null;
  owner: { id: string; name: string } | null;
  next_action: string | null;
  next_action_at: string | null;
  last_contact_at: string | null;
  follow_ups: number;
  invite_code: string;
  /** udozo.com/i/<code>: records the click, then opens sign-up carrying the code. */
  invite_link: string;
  invited_at: string | null;
  invite_emailed_at: string | null;
  clicked_at: string | null;
  clicks: number;
  do_not_contact: boolean;
  customer_id: string | null;
  linked_at: string | null;
  feedback: { rating: number | null; would_recommend: boolean | null; notes: string | null; advocacy: 'advocate' | 'nurture' | null };
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingActivity = {
  object: 'marketing_activity';
  id: string;
  kind: string;
  channel: MarketingChannel | null;
  template: string | null;
  body: string | null;
  replied: boolean | null;
  outcome: MarketingOutcome | null;
  stage: MarketingStage | null;
  status: MarketingStatus | null;
  actor: { id: string; name: string } | null;
  created_at: string;
};

/** The linked Udozo account's onboarding, worked out from the account itself. */
export type MarketingAccount = {
  object: 'marketing_account';
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  listings: { posted: number; live: number };
  checks: Array<{ key: string; label: string; done: boolean; at: string | null }>;
};

export type MarketingProspectDetail = MarketingProspect & { account: MarketingAccount | null; activities: MarketingActivity[] };

export type MarketingSummary = {
  object: 'marketing_summary';
  total: number;
  funnel: { reached: number; invited: number; clicked: number; signed_up: number; posted: number; feedback: number };
  stages: Array<{ stage: MarketingStage; total: number; statuses: Record<MarketingStatus, number> }>;
  due: { overdue: number; today: number };
  unassigned: number;
  owners: Array<{ id: string; name: string }>;
};

export type MarketingFilters = Partial<{
  stage: MarketingStage;
  status: MarketingStatus;
  owner: string;
  due: 'overdue' | 'today' | 'week' | 'none';
  outcome: MarketingOutcome | 'none';
  linked: 'yes' | 'no';
  category: string;
  q: string;
  limit: number;
  offset: number;
}>;

/** One row of a list as the import maps it. */
export type MarketingImportRow = Partial<Record<'name' | 'store_name' | 'phone' | 'email' | 'category' | 'location' | 'advert_url' | 'title' | 'price' | 'notes', string>>;
export type MarketingImportResult = { object: 'marketing_import'; rows: number; created: number; merged: number; skipped: Array<{ row: number; reason: string }> };

export type MarketingPatch = Partial<{
  name: string;
  store_name: string | null;
  phones: string[];
  email: string | null;
  location: string | null;
  categories: string[];
  notes: string | null;
  owner_id: string | null;
  next_action: string | null;
  next_action_at: string | null;
  outcome: MarketingOutcome | null;
  do_not_contact: boolean;
}>;

export type MarketingEmailSent = 'outbox' | 'resend' | 'mailersend' | string;

const query = (filters: MarketingFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return `/v1/admin/marketing/prospects${text ? `?${text}` : ''}`;
};

export const marketingApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    marketingSummary: build.query<MarketingSummary, void>({ query: () => '/v1/admin/marketing/summary', providesTags: ['Marketing'] }),
    marketingProspects: build.query<{ object: 'list'; data: MarketingProspect[]; total: number; has_more: boolean }, MarketingFilters>({ query, providesTags: ['Marketing'] }),
    marketingProspect: build.query<MarketingProspectDetail, string>({ query: id => `/v1/admin/marketing/prospects/${id}`, providesTags: (_result, _error, id) => [{ type: 'Marketing', id }] }),
    createMarketingProspect: build.mutation<MarketingProspectDetail, { name: string; store_name?: string; phones?: string[]; email?: string; location?: string; categories?: string[]; source?: string; notes?: string; owner_id?: string }>({
      query: body => ({ url: '/v1/admin/marketing/prospects', method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    importMarketingProspects: build.mutation<MarketingImportResult, { rows: MarketingImportRow[]; owner_id?: string; source?: string }>({
      query: body => ({ url: '/v1/admin/marketing/prospects/import', method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    updateMarketingProspect: build.mutation<MarketingProspectDetail, { id: string } & MarketingPatch>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Marketing'],
    }),
    logMarketingActivity: build.mutation<
      MarketingProspectDetail,
      { id: string; kind: MarketingLoggedKind; channel?: MarketingChannel; template?: string; body?: string; replied?: boolean; outcome?: MarketingOutcome; next_action?: string | null; next_action_at?: string | null }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}/activities`, method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    setMarketingStage: build.mutation<MarketingProspectDetail, { id: string; stage: MarketingStage; status: MarketingStatus; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}/stage`, method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    saveMarketingFeedback: build.mutation<
      MarketingProspectDetail,
      { id: string; rating?: number | null; would_recommend?: boolean | null; notes?: string | null; reason?: string | null; advocacy?: 'advocate' | 'nurture' | null }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}/feedback`, method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    linkMarketingAccount: build.mutation<MarketingProspectDetail, { id: string; email?: string; phone?: string; unlink?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}/link`, method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    emailMarketingInvite: build.mutation<MarketingProspectDetail & { email_sent: MarketingEmailSent }, { id: string; email?: string; message?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/marketing/prospects/${id}/invite-email`, method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
    /** Invites anyone by email to sign up and sell on Udozo; they are added to Marketing to track. */
    inviteByEmail: build.mutation<MarketingProspectDetail & { email_sent: MarketingEmailSent }, { email: string; name?: string; message?: string; owner_id?: string }>({
      query: body => ({ url: '/v1/admin/marketing/invites', method: 'POST', body }),
      invalidatesTags: ['Marketing'],
    }),
  }),
});

export const {
  useMarketingSummaryQuery,
  useMarketingProspectsQuery,
  useMarketingProspectQuery,
  useCreateMarketingProspectMutation,
  useImportMarketingProspectsMutation,
  useUpdateMarketingProspectMutation,
  useLogMarketingActivityMutation,
  useSetMarketingStageMutation,
  useSaveMarketingFeedbackMutation,
  useLinkMarketingAccountMutation,
  useEmailMarketingInviteMutation,
  useInviteByEmailMutation,
} = marketingApi;
