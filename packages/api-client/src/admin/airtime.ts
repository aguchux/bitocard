import { bitocardApi } from '../base';
import type { StoreAirtimePurchase, StoreAirtimeSale } from '../storefront';
import type { List } from './types';

/** A network's rates and limits with its pool per mode, as `AirtimeExchangeService.adminOverview` returns it. Minor units. */
export type AdminAirtimeNetwork = {
  country: string;
  network: string;
  name: string;
  currency: string;
  enabled: boolean;
  sell_rate_bps: number;
  buy_rate_bps: number;
  min_amount: number;
  max_amount: number;
  seller_daily: number;
  /** A new seller's daily limit, until `established_after` of their sales are complete. */
  new_seller_daily: number;
  established_after: number;
  credit_hold_hours: number;
  /** The most a reseller's store may take of these rates (their airtime markup, capped), in basis points. */
  reseller_cap_bps: number;
  transfer_steps: string;
  pools: Array<{ mode: 'live' | 'test'; available: number; reserved: number; cost: number; bought_total: number; sold_total: number }>;
};

/** One of BitoCard's collector lines, with today's counts (live trades only). */
export type AdminAirtimeLine = {
  object: 'airtime_line';
  id: string;
  country: string;
  network: string;
  number: string;
  label: string | null;
  active: boolean;
  daily_receive: number;
  daily_send: number;
  received_today: number;
  sent_today: number;
  balance: number;
};

export type AdminAirtimeOverview = { object: 'airtime_overview'; mode: 'live' | 'test'; open: Record<string, boolean>; networks: AdminAirtimeNetwork[]; lines: AdminAirtimeLine[] };

type Who = { id: string; name: string | null; email: string };
/** A seller's standing: strikes (a sent sale never received, or reversed) pause selling at `strike_limit`. */
export type AdminAirtimeSellerStanding = { strikes: number; strike_limit: number; paused: boolean; completed_sales: number; cleared_at: string | null };
export type AdminAirtimeSale = StoreAirtimeSale & { customer: Who; seller: AdminAirtimeSellerStanding; line: { id: string; number: string } };
export type AdminAirtimePurchase = StoreAirtimePurchase & { cost: number | null; customer: Who; line: { id: string; number: string } | null };

export type AdminAirtimeNetworkInput = Partial<Pick<AdminAirtimeNetwork, 'sell_rate_bps' | 'buy_rate_bps' | 'min_amount' | 'max_amount' | 'seller_daily' | 'new_seller_daily' | 'established_after' | 'credit_hold_hours' | 'reseller_cap_bps' | 'transfer_steps' | 'enabled'>>;

/** Operations and finance: the airtime exchange's rates, collector lines, sales to check and purchases to send. */
export const adminAirtimeApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    airtimeOverview: build.query<AdminAirtimeOverview, void>({
      query: () => '/v1/admin/airtime',
      providesTags: ['Airtime'],
    }),
    airtimeSales: build.query<List<AdminAirtimeSale>, { status?: string; mode?: 'live' | 'test' }>({
      query: params => ({ url: '/v1/admin/airtime/sales', params }),
      providesTags: ['Airtime'],
    }),
    airtimePurchases: build.query<List<AdminAirtimePurchase>, { status?: string; mode?: 'live' | 'test' }>({
      query: params => ({ url: '/v1/admin/airtime/purchases', params }),
      providesTags: ['Airtime'],
    }),
    /** Finance, after step-up. */
    updateAirtimeNetwork: build.mutation<AdminAirtimeOverview, { country: string; network: string } & AdminAirtimeNetworkInput>({
      query: ({ country, network, ...body }) => ({ url: `/v1/admin/airtime/networks/${country}/${network}`, method: 'PATCH', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    addAirtimeLine: build.mutation<AdminAirtimeLine, { country: string; network: string; number: string; label?: string; daily_receive?: number; daily_send?: number }>({
      query: body => ({ url: '/v1/admin/airtime/lines', method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    updateAirtimeLine: build.mutation<AdminAirtimeLine, { id: string; active?: boolean; label?: string | null; daily_receive?: number; daily_send?: number; balance?: number; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/lines/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimeSaleReceived: build.mutation<StoreAirtimeSale, { id: string; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/sales/${id}/received`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimeSaleNotReceived: build.mutation<StoreAirtimeSale, { id: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/sales/${id}/not-received`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimeSaleReverse: build.mutation<StoreAirtimeSale, { id: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/sales/${id}/reverse`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimeSellerClear: build.mutation<AdminAirtimeSellerStanding & { object: 'airtime_seller_standing'; customer_id: string }, { customer: string; reason: string }>({
      query: ({ customer, ...body }) => ({ url: `/v1/admin/airtime/sellers/${customer}/clear`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimePurchaseClaim: build.mutation<StoreAirtimePurchase, { id: string; line_id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/purchases/${id}/claim`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimePurchaseDelivered: build.mutation<StoreAirtimePurchase, { id: string; line_id?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/purchases/${id}/delivered`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
    airtimePurchaseRefund: build.mutation<StoreAirtimePurchase, { id: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/airtime/purchases/${id}/refund`, method: 'POST', body }),
      invalidatesTags: ['Airtime', 'Activity'],
    }),
  }),
});

export const {
  useAirtimeOverviewQuery,
  useAirtimeSalesQuery,
  useAirtimePurchasesQuery,
  useUpdateAirtimeNetworkMutation,
  useAddAirtimeLineMutation,
  useUpdateAirtimeLineMutation,
  useAirtimeSaleReceivedMutation,
  useAirtimeSaleNotReceivedMutation,
  useAirtimeSaleReverseMutation,
  useAirtimeSellerClearMutation,
  useAirtimePurchaseClaimMutation,
  useAirtimePurchaseDeliveredMutation,
  useAirtimePurchaseRefundMutation,
} = adminAirtimeApi;
