import { bitocardApi } from '../base';
import { type List, type Mode, params } from './common';

export type DisputeKind = 'customer' | 'reseller' | 'chargeback';
export type DisputeTopic = 'order' | 'payment' | 'funding' | 'trade' | 'other';
export type DisputeStatus = 'open' | 'escalated' | 'contested' | 'resolved';
/** What a reseller recommends when escalating, and what BitoCard can execute. */
export type DisputeAction = 'refund_customer' | 'credit_reseller' | 'reject' | 'contest_chargeback' | 'accept_chargeback';
export type DisputeOutcome = 'resolved_by_reseller' | 'refunded_customer' | 'credited_reseller' | 'rejected' | 'chargeback_won' | 'chargeback_lost';

export type DisputeMessage = {
  id: string;
  author: 'customer' | 'reseller' | 'bitocard' | 'system';
  author_name: string | null;
  /** `all`: the customer sees it too; `staff`: the store and BitoCard only. */
  visibility: 'all' | 'staff';
  body: string;
  created_at: string;
};

/** A dispute in a list (no messages). Amounts are minor units of `currency`. */
export type DisputeSummary = {
  object: 'dispute';
  id: string;
  reference: string;
  mode: Mode;
  kind: DisputeKind;
  topic: DisputeTopic;
  status: DisputeStatus;
  subject: string;
  customer_reference: string | null;
  customer_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  checkout_id: string | null;
  chargeback_id: string | null;
  currency: string;
  recommendation: DisputeAction | null;
  recommended_amount: number | null;
  report: string | null;
  escalated_at: string | null;
  outcome: DisputeOutcome | null;
  outcome_amount: number | null;
  outcome_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Dispute = DisputeSummary & { messages: DisputeMessage[] };

export type OpenDisputeInput = {
  kind: 'customer' | 'reseller';
  topic: DisputeTopic;
  subject: string;
  message: string;
  order_id?: string;
  top_up_id?: string;
  customer_reference?: string;
};

const tags = (id: string) => [{ type: 'Dispute' as const, id }, { type: 'Dispute' as const, id: 'LIST' }];

/**
 * Disputes (`/v1/disputes`): customers' disputes the reseller investigates, their own disputes with BitoCard and
 * chargebacks. The reseller resolves customer disputes or escalates them to BitoCard with a report and a recommendation.
 */
export const resellerDisputesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    disputes: build.query<List<DisputeSummary>, { status?: DisputeStatus; kind?: DisputeKind } | void>({
      query: filter => ({ url: '/v1/disputes', params: params({ limit: 100, ...(filter ?? {}) }) }),
      providesTags: [{ type: 'Dispute', id: 'LIST' }],
    }),
    dispute: build.query<Dispute, string>({ query: id => `/v1/disputes/${id}`, providesTags: (_result, _error, id) => [{ type: 'Dispute', id }] }),
    openDispute: build.mutation<Dispute, OpenDisputeInput>({
      query: body => ({ url: '/v1/disputes', method: 'POST', body }),
      invalidatesTags: [{ type: 'Dispute', id: 'LIST' }],
    }),
    replyDispute: build.mutation<Dispute, { id: string; body: string; visibility: 'all' | 'staff' }>({
      query: ({ id, ...body }) => ({ url: `/v1/disputes/${id}/messages`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    escalateDispute: build.mutation<Dispute, { id: string; recommendation: DisputeAction; amount?: number; report: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/disputes/${id}/escalate`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
    resolveDispute: build.mutation<Dispute, { id: string; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/disputes/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => tags(id),
    }),
  }),
});

export const { useDisputesQuery, useDisputeQuery, useOpenDisputeMutation, useReplyDisputeMutation, useEscalateDisputeMutation, useResolveDisputeMutation } = resellerDisputesApi;
