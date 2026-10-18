import { bitocardApi } from '../base';
import type { Ticket, TicketPriority, TicketQueue, TicketRequester, TicketStatus, TicketSummary } from '../reseller/support';
import type { List } from './types';

export type { Ticket, TicketCategory, TicketMessage, TicketPriority, TicketQueue, TicketRequester, TicketStatus, TicketSummary } from '../reseller/support';
export { ticketCategories, ticketPriorities } from '../reseller/support';

/** As admins see it: with the reseller it belongs to. */
export type AdminTicketSummary = TicketSummary & { reseller_id: string };
export type AdminTicket = Ticket & { reseller_id: string };

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
    updateAdminTicket: build.mutation<AdminTicket, { id: string; priority?: TicketPriority; assignee_id?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/support/tickets/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
  }),
});

export const { useAdminTicketsQuery, useAdminTicketQuery, useReplyAdminTicketMutation, useReturnTicketMutation, useResolveAdminTicketMutation, useUpdateAdminTicketMutation } = adminSupportApi;
