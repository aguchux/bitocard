import { bitocardApi } from '../base';

// Udozo's buy orders (Udozo's API only: /v1/admin/classifieds/buy-orders). A buyer asks to buy a listing at a price;
// the seller accepts (holding it), counters or declines; they meet and pay in person, off Udozo. Admins read them and
// pause or unpause a seller's buy orders.

export const buyOrderStatuses = ['requested', 'countered', 'accepted', 'completed', 'declined', 'cancelled', 'lapsed', 'expired', 'no_show', 'voided'] as const;
export type BuyOrderStatus = (typeof buyOrderStatuses)[number];
/** A status, or `open`: requested, countered and accepted. */
export type BuyOrderStatusFilter = BuyOrderStatus | 'open';
export type BuyOrderParty = 'buyer' | 'seller' | 'udozo';

export type AdminBuyOrder = {
  object: 'classified_admin_buy_order';
  id: string;
  /** BO-000123. */
  number: string;
  status: BuyOrderStatus;
  country: string;
  currency: string;
  /** The total asked, in minor units. */
  price: number;
  /** The seller's counter, in minor units, or null. */
  counter: number | null;
  quantity: number;
  note: string | null;
  meet_note: string | null;
  /** `path` is udozo.com's own path for the listing (`/ng/l/100004-slug`). */
  listing: { id: string; ref: number; title: string | null; path: string; status: string };
  buyer: { id: string; name: string; email: string };
  seller: { id: string; name: string; email: string };
  respond_by: string | null;
  meet_by: string | null;
  accepted_at: string | null;
  bought_at: string | null;
  completed_at: string | null;
  completed_by: 'seller' | 'buyer' | 'auto' | null;
  voided_at: string | null;
  void_reason: string | null;
  ended_by: BuyOrderParty | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminBuyOrderDetail = AdminBuyOrder & { steps: Array<{ by: BuyOrderParty; text: string; at: string }> };

export type AdminBuyOrderFilter = { status?: BuyOrderStatusFilter; country?: string; seller?: string; buyer?: string; limit?: number; offset?: number };

/** Whether a seller's new buy orders are paused, until when and why (nulls when not). */
export type BuyOrderPause = { paused_until: string | null; reason: string | null };

const listTag = { type: 'ClassifiedOrder' as const, id: 'BUY_ORDERS' };

/** Drops empty values so query strings stay clean. */
const clean = (values: Record<string, string | number | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));

export const adminUdozoBuyOrdersApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    buyOrders: build.query<{ object: 'list'; data: AdminBuyOrder[]; total: number }, AdminBuyOrderFilter | void>({
      query: filter => ({ url: '/v1/admin/classifieds/buy-orders', params: clean({ limit: 50, ...(filter ?? {}) }) }),
      providesTags: [listTag],
    }),
    buyOrder: build.query<AdminBuyOrderDetail, string>({
      query: id => `/v1/admin/classifieds/buy-orders/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: 'ClassifiedOrder', id: `buy:${id}` }],
    }),
    /** Pauses a seller's new buy orders (default 30 days), with why; audited. */
    pauseSellerBuyOrders: build.mutation<BuyOrderPause, { customer: string; reason: string; days?: number }>({
      query: ({ customer, ...body }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(customer)}/buy-orders/pause`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { customer }) => [{ type: 'ClassifiedSeller', id: customer }, { type: 'ClassifiedSeller', id: 'LIST' }, listTag, 'Activity'],
    }),
    /** Lets the seller take buy orders again, with why; audited. */
    unpauseSellerBuyOrders: build.mutation<BuyOrderPause, { customer: string; reason: string }>({
      query: ({ customer, ...body }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(customer)}/buy-orders/unpause`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { customer }) => [{ type: 'ClassifiedSeller', id: customer }, { type: 'ClassifiedSeller', id: 'LIST' }, listTag, 'Activity'],
    }),
  }),
});

export const { useBuyOrdersQuery, useBuyOrderQuery, usePauseSellerBuyOrdersMutation, useUnpauseSellerBuyOrdersMutation } = adminUdozoBuyOrdersApi;
