import { bitocardApi } from '../base';

// Udozo on WhatsApp and wanted requests (Udozo's API only: /v1/admin/whatsapp, /v1/admin/classifieds/wanted).

export type WhatsappOverview = {
  object: 'whatsapp_overview';
  configured: boolean;
  number: string | null;
  /** The number as Meta has it, or why it could not be read. */
  meta: { name: string | null; display: string | null; quality: string | null; error: string | null } | null;
  contacts: { total: number; linked: number; opted_out: number };
  week: { received: number; sent: Record<string, number>; failed: number };
  failures: Array<{ id: string; kind: string; template: string | null; error: string | null; phone: string; created_at: string }>;
};

export type WhatsappTemplateStatus = 'approved' | 'pending' | 'rejected' | 'paused' | 'disabled' | 'not_submitted' | string;
export type WhatsappTemplate = { object: 'whatsapp_template'; name: string; purpose: string; body: string; button: string; language: string; status: WhatsappTemplateStatus; rejected_reason: string | null };
export type WhatsappTemplateSubmission = { object: 'whatsapp_template_submission'; submitted: string[]; failed: Array<{ name: string; error: string }>; templates: WhatsappTemplate[] };

export type WhatsappContact = {
  object: 'whatsapp_contact';
  id: string;
  phone: string;
  country: string | null;
  customer: { id: string; name: string; email: string } | null;
  linked_at: string | null;
  opted_in_at: string | null;
  opted_out_at: string | null;
  unreachable_at: string | null;
  last_inbound_at: string | null;
  flow: string | null;
  messages: Array<{ id: string; direction: 'in' | 'out'; kind: string; template: string | null; status: string; error: string | null; created_at: string }>;
};

export type WantedStatus = 'open' | 'fulfilled' | 'closed' | 'expired' | 'removed';
export const wantedStatuses: WantedStatus[] = ['open', 'fulfilled', 'closed', 'expired', 'removed'];
export type AdminWantedRequest = {
  object: 'classified_wanted_request';
  id: string;
  number: string;
  words: string;
  details: string | null;
  country: string;
  category: { id: string; slug: string; name: string };
  place: string | null;
  budget: { min: number | null; max: number | null; currency: string; text: string | null };
  condition_text: string | null;
  status: WantedStatus;
  source: 'web' | 'whatsapp';
  sellers_told: number;
  responses: number;
  expires_at: string;
  created_at: string;
  buyer: { id: string; name: string; email: string };
};

const tag = { type: 'Settings' as const, id: 'WHATSAPP' };
const wantedTag = { type: 'Settings' as const, id: 'WANTED' };

export const adminUdozoWhatsappApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    whatsappOverview: build.query<WhatsappOverview, void>({ query: () => '/v1/admin/whatsapp', providesTags: [tag] }),
    whatsappTemplates: build.query<{ object: 'list'; data: WhatsappTemplate[] }, void>({ query: () => '/v1/admin/whatsapp/templates', providesTags: [tag] }),
    submitWhatsappTemplates: build.mutation<WhatsappTemplateSubmission, { name?: string } | void>({
      query: body => ({ url: '/v1/admin/whatsapp/templates/submit', method: 'POST', body: body ?? {} }),
      invalidatesTags: [tag, 'Activity'],
    }),
    whatsappContact: build.query<WhatsappContact, string>({ query: phone => ({ url: '/v1/admin/whatsapp/contacts', params: { phone } }), providesTags: [tag] }),
    optOutWhatsappContact: build.mutation<WhatsappContact, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/whatsapp/contacts/${id}/opt-out`, method: 'POST', body: { reason } }),
      invalidatesTags: [tag, 'Activity'],
    }),
    wantedRequests: build.query<{ object: 'list'; data: AdminWantedRequest[]; total: number }, { status?: WantedStatus; country?: string; q?: string; limit?: number; offset?: number } | void>({
      query: filter => ({ url: '/v1/admin/classifieds/wanted', params: Object.fromEntries(Object.entries(filter ?? {}).filter(([, value]) => value !== undefined && value !== '')) }),
      providesTags: [wantedTag],
    }),
    removeWantedRequest: build.mutation<AdminWantedRequest, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/classifieds/wanted/${id}/remove`, method: 'POST', body: { reason } }),
      invalidatesTags: [wantedTag, 'Activity'],
    }),
  }),
});

export const {
  useWhatsappOverviewQuery,
  useWhatsappTemplatesQuery,
  useSubmitWhatsappTemplatesMutation,
  useLazyWhatsappContactQuery,
  useOptOutWhatsappContactMutation,
  useWantedRequestsQuery,
  useRemoveWantedRequestMutation,
} = adminUdozoWhatsappApi;
