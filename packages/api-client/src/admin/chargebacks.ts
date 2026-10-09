import { bitocardApi } from '../base';
import type { List } from './types';

export type ChargebackStatus = 'open' | 'won' | 'lost';

/** A card payment the cardholder disputed with their bank (a chargeback), as `presentChargeback` returns it. Amounts in minor units. */
export type Chargeback = {
  object: 'chargeback';
  id: string;
  payment_id: string;
  reseller_id: string;
  mode: 'live' | 'test';
  provider: string;
  provider_dispute_id: string;
  amount: number;
  currency: string;
  status: ChargebackStatus;
  /** The reseller's plan has chargeback protection: BitoCard bears it and nothing is held. */
  protected: boolean;
  held: number;
  shortfall: number;
  reason: string | null;
  opened_at: string;
  resolved_at: string | null;
  cleared_at: string | null;
};

export type RecordChargebackInput = { payment_id: string; provider_dispute_id: string; amount?: number; reason: string };

/** Card chargebacks (finance): Stripe's arrive by webhook; other gateways' are recorded and decided here. */
export const adminChargebacksApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    chargebacks: build.query<List<Chargeback>, { status?: ChargebackStatus; reseller_id?: string }>({
      query: params => ({ url: '/v1/admin/chargebacks', params }),
      providesTags: ['Chargeback'],
    }),
    recordChargeback: build.mutation<Chargeback, RecordChargebackInput>({
      query: body => ({ url: '/v1/admin/chargebacks', method: 'POST', body }),
      invalidatesTags: ['Chargeback', 'Activity', 'Reseller'],
    }),
    resolveChargeback: build.mutation<Chargeback, { id: string; outcome: 'won' | 'lost'; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/chargebacks/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: ['Chargeback', 'Activity', 'Reseller'],
    }),
    clearChargeback: build.mutation<Chargeback, { id: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/chargebacks/${id}/clear`, method: 'POST', body }),
      invalidatesTags: ['Chargeback', 'Activity', 'Reseller'],
    }),
  }),
});

export const { useChargebacksQuery, useRecordChargebackMutation, useResolveChargebackMutation, useClearChargebackMutation } = adminChargebacksApi;
