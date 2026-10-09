import { bitocardApi } from '../base';
import type { Dispute, DisputeAction, DisputeKind, DisputeStatus, DisputeSummary } from '../reseller/disputes';
import type { List } from './types';

export type { Dispute, DisputeAction, DisputeKind, DisputeMessage, DisputeOutcome, DisputeStatus, DisputeSummary, DisputeTopic } from '../reseller/disputes';

/** As admins see it: with the reseller it belongs to. */
export type AdminDisputeSummary = DisputeSummary & { reseller_id: string };
export type AdminDispute = Dispute & { reseller_id: string };

const tags = (id: string) => [{ type: 'Dispute' as const, id }, { type: 'Dispute' as const, id: 'LIST' }, 'Activity' as const];

/** Disputes escalated to BitoCard: read, reply, send back to the reseller, or decide and execute. */
export const adminDisputesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminDisputes: build.query<List<AdminDisputeSummary>, { status?: DisputeStatus; kind?: DisputeKind; reseller_id?: string }>({
      query: params => ({ url: '/v1/admin/disputes', params: { limit: 100, ...params } }),
      providesTags: [{ type: 'Dispute', id: 'LIST' }],
    }),
    adminDispute: build.query<AdminDispute, string>({ query: id => `/v1/admin/disputes/${id}`, providesTags: (_result, _error, id) => [{ type: 'Dispute', id }] }),
    replyAdminDispute: build.mutation<AdminDispute, { id: string; body: string; visibility: 'all' | 'staff' }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/disputes/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    returnDispute: build.mutation<AdminDispute, { id: string; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/disputes/${id}/return`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    executeDispute: build.mutation<AdminDispute, { id: string; action: DisputeAction; amount?: number; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/disputes/${id}/execute`, method: 'POST', body }),
      // A refund or credit changes the order, the wallet and chargebacks too.
      invalidatesTags: (_result, _error, { id }) => [...tags(id), 'Order', 'Reseller', 'Chargeback'],
    }),
  }),
});

export const { useAdminDisputesQuery, useAdminDisputeQuery, useReplyAdminDisputeMutation, useReturnDisputeMutation, useExecuteDisputeMutation } = adminDisputesApi;
