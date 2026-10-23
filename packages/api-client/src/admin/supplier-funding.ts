import { bitocardApi } from '../base';
import type { ConfirmMethod, List, Mode } from './types';

export type SupplierFundingStatus = 'awaiting_code' | 'expired' | 'completed' | 'cancelled';

/** Money an admin recorded as sent to a supplier outside BitoCard, as `SupplierFundingService.present` returns it. */
export type SupplierFundingMovement = {
  object: 'supplier_funding_movement';
  id: string;
  /** SF-000123. */
  number: string;
  mode: Mode;
  supplier: { code: string; name: string };
  currency: string;
  /** Minor units. */
  amount: number;
  reason: string;
  status: SupplierFundingStatus;
  requested_by: { id: string; name: string | null };
  cancelled_by: { id: string; name: string | null } | null;
  code_expires_at: string | null;
  code_sent_at: string | null;
  created_at: string;
  completed_at: string | null;
  /** On the request's answer only: how the admin can confirm it (the authenticator app when set up; the emailed code always). */
  confirm_with?: ConfirmMethod[];
};

export type SupplierFundingInput = { mode: Mode; supplier_code: string; currency?: string; amount: number; reason: string };

/** Funded, drawn down (`cost_of_sales` over the asked period) and remaining, per supplier and currency. */
/** `funded` and `consumed` are over the asked period; `remaining` is the float's balance over all time. */
export type SupplierFloat = { object: 'supplier_float'; supplier_code: string; supplier_name: string; currency: string; funded: number; consumed: number; remaining: number };

/** Finance: recording money sent to a supplier (its float), and tracking what has been funded against what orders have drawn down. */
export const adminSupplierFundingApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    supplierFloat: build.query<List<SupplierFloat>, { mode: Mode; from: string; to: string }>({
      query: params => ({ url: '/v1/admin/suppliers/float', params }),
      providesTags: ['SupplierFunding'],
    }),
    supplierFundingMovements: build.query<List<SupplierFundingMovement>, { mode?: Mode; supplier_code?: string; status?: SupplierFundingStatus }>({
      query: params => ({ url: '/v1/admin/suppliers/funding', params: { ...params, limit: 25 } }),
      providesTags: ['SupplierFunding'],
    }),
    /** Emails a code to the signed-in admin; nothing is recorded until it is confirmed. */
    requestSupplierFunding: build.mutation<SupplierFundingMovement, SupplierFundingInput>({
      query: body => ({ url: '/v1/admin/suppliers/funding', method: 'POST', body }),
      invalidatesTags: ['SupplierFunding', 'Activity'],
    }),
    /** `method`: the admin's authenticator app or the emailed code (the API's default). */
    confirmSupplierFunding: build.mutation<SupplierFundingMovement, { id: string; code: string; method?: ConfirmMethod }>({
      query: ({ id, code, method }) => ({ url: `/v1/admin/suppliers/funding/${id}/confirm`, method: 'POST', body: { code, ...(method ? { method } : {}) } }),
      invalidatesTags: ['SupplierFunding', 'Activity'],
    }),
    resendSupplierFundingCode: build.mutation<SupplierFundingMovement, string>({
      query: id => ({ url: `/v1/admin/suppliers/funding/${id}/resend-code`, method: 'POST' }),
      invalidatesTags: ['SupplierFunding'],
    }),
    cancelSupplierFunding: build.mutation<SupplierFundingMovement, string>({
      query: id => ({ url: `/v1/admin/suppliers/funding/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['SupplierFunding', 'Activity'],
    }),
  }),
});

export const {
  useSupplierFloatQuery,
  useSupplierFundingMovementsQuery,
  useRequestSupplierFundingMutation,
  useConfirmSupplierFundingMutation,
  useResendSupplierFundingCodeMutation,
  useCancelSupplierFundingMutation,
} = adminSupplierFundingApi;
