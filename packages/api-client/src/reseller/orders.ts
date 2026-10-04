import { bitocardApi } from '../base';
import type { CatalogueCategory, QuoteRecipient } from './catalogue';
import { cursorPages, type List, type Mode, params } from './common';

export const orderStatuses = ['processing', 'completed', 'failed', 'refunded'] as const;
/** `processing`: sent to the supplier and not yet confirmed. */
export type OrderStatus = (typeof orderStatuses)[number];

export type OrderDeliveryKind = 'gift_card' | 'token' | 'confirmation' | 'virtual_number';
/**
 * What was delivered. Codes, PINs and tokens are secrets: they appear only on the single order, never in lists or
 * webhooks. A virtual number's phone number is in `details.number` (and `serial`).
 */
export type OrderDelivery = { kind: OrderDeliveryKind; code: string | null; pin: string | null; serial: string | null; details: Record<string, string> };

/** An order (`/v1/orders`). Amounts are in `currency` minor units; the face value is in `face_currency`. */
export type Order = {
  object: 'order';
  id: string;
  mode: Mode;
  status: OrderStatus;
  quote_id: string;
  product: { id: string; name: string; category: CatalogueCategory };
  face_value: number;
  face_currency: string;
  quantity: number;
  currency: string;
  wholesale: number;
  tax: number;
  /** Taken from your wallet: wholesale plus tax. */
  charged: number;
  /** What the customer pays, tax included. */
  price: number;
  reseller_profit: number;
  /** `own`: fulfilled through your own supplier account (you are the seller; `charged` is only BitoCard's fee). */
  source: 'bitocard' | 'own';
  integration: { id: string; name: string } | null;
  recipient: QuoteRecipient | null;
  customer_reference: string | null;
  failure_reason: string | null;
  receipt_number: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
/** The single order, with what was delivered. */
export type OrderDetail = Order & { deliveries: OrderDelivery[] };

export type OrderFilter = { status?: OrderStatus; customer_reference?: string };

/** The customer receipt: BitoCard (the regional Golojan entity) is the seller of record; `sold_through` is your store name. */
export type Receipt = {
  object: 'receipt';
  number: string;
  order_id: string;
  mode: Mode;
  issued_at: string;
  /** Name, registered address and the entity's registration number under its local label (for example `company_number`, `rc_number`). */
  seller: { name: string; registered_address: string; [registration: string]: string };
  sold_through: string;
  currency: string;
  items: Array<{ description: string; quantity: number; unit_price: number; amount: number }>;
  subtotal: number;
  tax: { name: string | null; rate_percent: number; amount: number } | null;
  total: number;
  customer_reference: string | null;
};

/** Orders: placing one from a quote, the list, the single order with its deliveries, receipts and sandbox outcomes. */
export const resellerOrdersApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerOrders: build.infiniteQuery<List<Order>, OrderFilter, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/orders', params: params({ ...queryArg, limit: 25, starting_after: pageParam }) }),
      providesTags: [{ type: 'Order', id: 'LIST' }],
    }),
    resellerOrder: build.query<OrderDetail, string>({ query: id => `/v1/orders/${id}`, providesTags: (_result, _error, id) => [{ type: 'Order', id }] }),
    /** Holds wholesale plus tax from the wallet. A `processing` result means the supplier has not confirmed yet. */
    placeOrder: build.mutation<OrderDetail, { quote_id: string; simulate?: 'completed' | 'failed' | 'pending' }>({
      query: body => ({ url: '/v1/orders', method: 'POST', body }),
      invalidatesTags: [{ type: 'Order', id: 'LIST' }, 'Wallet'],
    }),
    orderReceipt: build.query<Receipt, string>({ query: id => `/v1/orders/${id}/receipt`, providesTags: (_result, _error, id) => [{ type: 'Order', id }] }),
    /** Sandbox only: completes or fails a processing order. */
    simulateOrder: build.mutation<OrderDetail, { id: string; outcome: 'completed' | 'failed' }>({
      query: ({ id, outcome }) => ({ url: `/v1/orders/${id}/simulate`, method: 'POST', body: { outcome } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Wallet'],
    }),
  }),
});

export const { useResellerOrdersInfiniteQuery, useResellerOrderQuery, usePlaceOrderMutation, useOrderReceiptQuery, useLazyOrderReceiptQuery, useSimulateOrderMutation } = resellerOrdersApi;
