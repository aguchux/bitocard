import { bitocardApi } from '../base';
import { type List, type Mode, params } from './common';

/** `ready`: delivered, not installed; `installed`; `active`: in use; `used_up`: top it up; `expired`; `cancelled` (refunded); `revoked`/`suspended`: stopped by the network. */
export type EsimStatus = 'ready' | 'installed' | 'active' | 'used_up' | 'expired' | 'cancelled' | 'revoked' | 'suspended';

/** An eSIM an order delivered (`/v1/esims`): status, data use (bytes) and expiry. Its activation code is only on the order. */
export type Esim = {
  object: 'esim';
  id: string;
  order_id: string;
  mode: Mode;
  iccid: string;
  status: EsimStatus;
  data: { total: number | null; used: number | null; remaining: number | null; updated_at: string | null };
  expires_at: string | null;
  top_ups: 'none' | 'data' | 'days';
  /** Never installed: cancelling it refunds its order. */
  cancellable: boolean;
  created_at: string;
  updated_at: string;
};

/** A top-up the eSIM takes now, at BitoCard's price to you (or, on a store's order page, the store's price). */
export type EsimTopUpOption = { object: 'esim_top_up_option'; id: string; name: string; data: string; days: number; amount: number; currency: string };

export type EsimTopUp = {
  object: 'esim_top_up';
  id: string;
  esim_id: string;
  mode: Mode;
  name: string;
  status: 'pending' | 'completed' | 'failed';
  amount: number;
  currency: string;
  paid_by: 'reseller' | 'customer';
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export const resellerEsimsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    /** An order's eSIMs (or every eSIM, newest first). */
    esims: build.query<List<Esim>, { order_id?: string } | void>({
      query: filter => ({ url: '/v1/esims', params: params({ limit: 50, order_id: filter?.order_id }) }),
      providesTags: [{ type: 'Esim', id: 'LIST' }],
    }),
    esimTopUpOptions: build.query<{ object: 'list'; data: EsimTopUpOption[] }, string>({
      query: id => `/v1/esims/${id}/top-up-options`,
      providesTags: (_result, _error, id) => [{ type: 'Esim', id }],
    }),
    /** Paid from your wallet; `completed` once the supplier added it. */
    topUpEsim: build.mutation<EsimTopUp, { id: string; option_id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/esims/${id}/top-ups`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Esim', id: 'LIST' }, { type: 'Esim', id }, 'Wallet'],
    }),
    /** Cancels every eSIM of the order (none installed) and refunds it. */
    cancelEsim: build.mutation<{ object: 'list'; data: Esim[]; refunded: boolean }, string>({
      query: id => ({ url: `/v1/esims/${id}/cancel`, method: 'POST' }),
      invalidatesTags: [{ type: 'Esim', id: 'LIST' }, 'Order', 'Wallet'],
    }),
  }),
});

export const { useEsimsQuery, useEsimTopUpOptionsQuery, useTopUpEsimMutation, useCancelEsimMutation } = resellerEsimsApi;
