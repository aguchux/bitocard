import { bitocardApi } from '../base';
import type { List } from './types';

export type ManualTopUpSource = 'received' | 'goodwill';
export type ManualTopUpStatus = 'awaiting_code' | 'expired' | 'completed' | 'cancelled';

/** A finance admin's manual top-up of a wallet, as `ManualTopUpsService.present` returns it. Amounts in minor units. */
export type ManualTopUp = {
  object: 'manual_top_up';
  id: string;
  /** MT-000123. */
  number: string;
  mode: 'live' | 'test';
  target: { type: 'reseller' | 'customer'; id: string; name: string; email: string | null; store: string | null };
  currency: string;
  amount: number;
  /** received: money BitoCard received outside its gateways; goodwill: BitoCard's expense. */
  source: ManualTopUpSource;
  external_reference: string | null;
  reason: string;
  status: ManualTopUpStatus;
  requested_by: { id: string; name: string | null };
  cancelled_by: { id: string; name: string | null } | null;
  code_expires_at: string | null;
  code_sent_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ManualTopUpInput = {
  /** Resellers only (customers are topped up in their store's mode). Default live. */
  mode?: 'live' | 'test';
  /** The country's currency (default) or USD. */
  currency?: string;
  amount: number;
  source: ManualTopUpSource;
  external_reference?: string;
  reason: string;
};

/** What a confirmed top-up changes: the reseller's wallet or the customer's page, and the activity log. */
const credited = (result: ManualTopUp | undefined) =>
  [
    'TopUp',
    'Activity',
    'Overview',
    ...(result?.target.type === 'reseller' ? [{ type: 'Reseller' as const, id: result.target.id }] : []),
    ...(result?.target.type === 'customer' ? ['StoreCustomer' as const] : []),
  ] as const;

/** Finance: manual top-ups of reseller and customer wallets, each confirmed with a code emailed to the admin. */
export const adminTopUpsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    manualTopUps: build.query<List<ManualTopUp>, { reseller_id?: string; customer_id?: string; status?: 'awaiting_code' | 'completed' | 'cancelled' }>({
      query: params => ({ url: '/v1/admin/top-ups', params: { ...params, limit: 10 } }),
      providesTags: ['TopUp'],
    }),
    /** Emails a code to the signed-in admin; nothing moves until it is confirmed. */
    requestResellerTopUp: build.mutation<ManualTopUp, { id: string } & ManualTopUpInput>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/resellers/${id}/top-ups`, method: 'POST', body }),
      invalidatesTags: ['TopUp', 'Activity'],
    }),
    requestCustomerTopUp: build.mutation<ManualTopUp, { id: string } & ManualTopUpInput>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/customers/${id}/top-ups`, method: 'POST', body }),
      invalidatesTags: ['TopUp', 'Activity'],
    }),
    confirmTopUp: build.mutation<ManualTopUp, { id: string; code: string }>({
      query: ({ id, code }) => ({ url: `/v1/admin/top-ups/${id}/confirm`, method: 'POST', body: { code } }),
      invalidatesTags: result => [...credited(result)],
    }),
    resendTopUpCode: build.mutation<ManualTopUp, string>({
      query: id => ({ url: `/v1/admin/top-ups/${id}/resend-code`, method: 'POST' }),
      invalidatesTags: ['TopUp'],
    }),
    cancelTopUp: build.mutation<ManualTopUp, string>({
      query: id => ({ url: `/v1/admin/top-ups/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['TopUp', 'Activity'],
    }),
  }),
});

export const {
  useManualTopUpsQuery,
  useRequestResellerTopUpMutation,
  useRequestCustomerTopUpMutation,
  useConfirmTopUpMutation,
  useResendTopUpCodeMutation,
  useCancelTopUpMutation,
} = adminTopUpsApi;
