import { bitocardApi } from '../base';
import type { Chat, ChatStatus, ChatSummary, Ticket, TicketCategory, TicketPriority, TicketQueue, TicketRequester, TicketStatus, TicketSummary } from '../reseller/support';
import type { List } from './types';

export type { Ticket, TicketCategory, TicketMessage, TicketPriority, TicketQueue, TicketRequester, TicketStatus, TicketSummary } from '../reseller/support';
export { ticketCategories, ticketPriorities } from '../reseller/support';

/** As admins see it: with the reseller it belongs to. */
export type AdminTicketSummary = TicketSummary & { reseller_id: string };
export type TicketIssue = { number: number; url: string | null; state: string | null };
export type AdminTicket = Ticket & { reseller_id: string; github_issue: TicketIssue | null };

const tags = (id: string) => [{ type: 'SupportTicket' as const, id }, { type: 'SupportTicket' as const, id: 'LIST' }, 'Activity' as const];

/** BitoCard's support queue: resellers' tickets, tickets stores passed on, and bitocard.com's customers. */
export const adminSupportApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminTickets: build.query<List<AdminTicketSummary>, { status?: TicketStatus; queue?: TicketQueue; requester?: TicketRequester; reseller_id?: string }>({
      query: params => ({ url: '/v1/admin/support/tickets', params: { limit: 100, ...params } }),
      providesTags: [{ type: 'SupportTicket', id: 'LIST' }],
    }),
    adminTicket: build.query<AdminTicket, string>({ query: id => `/v1/admin/support/tickets/${id}`, providesTags: (_result, _error, id) => [{ type: 'SupportTicket', id }] }),
    replyAdminTicket: build.mutation<AdminTicket, { id: string; body: string; visibility: 'all' | 'staff' }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    returnTicket: build.mutation<AdminTicket, { id: string; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}/return`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    resolveAdminTicket: build.mutation<AdminTicket, { id: string; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    ticketIssueDraft: build.query<{ title: string; body: string; drafted_by: 'ai' | 'template' }, string>({ query: id => `/v1/admin/support/tickets/${id}/github-issue/draft`, keepUnusedDataFor: 0 }),
    createTicketIssue: build.mutation<AdminTicket, { id: string; title: string; body: string; kind: 'bug' | 'feature' }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}/github-issue`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    sendAdminTicketDraft: build.mutation<AdminTicket, { id: string; draft: string; body?: string }>({
      query: ({ id, draft, ...body }) => ({ url: `/v1/admin/support/tickets/${id}/drafts/${draft}/send`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    discardAdminTicketDraft: build.mutation<AdminTicket, { id: string; draft: string }>({
      query: ({ id, draft }) => ({ url: `/v1/admin/support/tickets/${id}/drafts/${draft}/discard`, method: 'POST' }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    updateAdminTicket: build.mutation<AdminTicket, { id: string; priority?: TicketPriority; assignee_id?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
  }),
});

export const {
  useAdminTicketsQuery,
  useAdminTicketQuery,
  useReplyAdminTicketMutation,
  useReturnTicketMutation,
  useResolveAdminTicketMutation,
  useUpdateAdminTicketMutation,
  useSendAdminTicketDraftMutation,
  useDiscardAdminTicketDraftMutation,
  useLazyTicketIssueDraftQuery,
  useCreateTicketIssueMutation,
} = adminSupportApi;

export type { Chat, ChatMessage, ChatStatus, ChatSummary } from '../reseller/support';

export type AdminChatSummary = ChatSummary & { reseller_id: string };
export type AdminChat = Chat & { reseller_id: string };

const chatTags = (id: string) => [{ type: 'SupportChat' as const, id }, { type: 'SupportChat' as const, id: 'LIST' }];

/** BitoCard's chats: resellers' teams and bitocard.com's customers. */
export const adminChatsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminChats: build.query<List<AdminChatSummary>, { status?: ChatStatus } | void>({
      query: params => ({ url: '/v1/admin/support/chats', params: { limit: 100, ...(params ?? {}) } }),
      providesTags: [{ type: 'SupportChat', id: 'LIST' }],
    }),
    adminChat: build.query<AdminChat, string>({ query: id => `/v1/admin/support/chats/${id}`, providesTags: (_result, _error, id) => [{ type: 'SupportChat', id }] }),
    replyAdminChat: build.mutation<AdminChat, { id: string; body: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/chats/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => chatTags(id),
    }),
    takeAdminChat: build.mutation<AdminChat, string>({ query: id => ({ url: `/v1/admin/support/chats/${id}/take`, method: 'POST' }), invalidatesTags: (_result, _error, id) => chatTags(id) }),
    closeAdminChat: build.mutation<AdminChat, string>({ query: id => ({ url: `/v1/admin/support/chats/${id}/close`, method: 'POST' }), invalidatesTags: (_result, _error, id) => chatTags(id) }),
    adminChatTicket: build.mutation<AdminChat, { id: string; subject: string; category: TicketCategory }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/chats/${id}/ticket`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [...chatTags(id), { type: 'SupportTicket', id: 'LIST' }],
    }),
  }),
});

export const { useAdminChatsQuery, useAdminChatQuery, useReplyAdminChatMutation, useTakeAdminChatMutation, useCloseAdminChatMutation, useAdminChatTicketMutation } = adminChatsApi;

export type { AiProviderName, AiUsageList, AiUsageRow } from '../reseller/support';

export const adminAiApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminSupportAi: build.query<{ object: 'support_ai_admin'; bitocard_models: Array<{ provider: import('../reseller/support').AiProviderName; model: string }>; replies_per_store: number }, void>({
      query: () => '/v1/admin/support/ai',
      providesTags: [{ type: 'SupportAi', id: 'OVERVIEW' }],
    }),
    adminAiUsage: build.query<import('../reseller/support').AiUsageList, { month?: string } | void>({
      query: filter => ({ url: '/v1/admin/support/ai/usage', params: { ...(filter ?? {}) } }),
      providesTags: [{ type: 'SupportAi', id: 'USAGE' }],
    }),
  }),
});

export const { useAdminAiUsageQuery, useAdminSupportAiQuery } = adminAiApi;
