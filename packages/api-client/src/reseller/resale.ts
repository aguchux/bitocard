import { bitocardApi } from '../base';
import { type List, params } from './common';

/**
 * B2B reselling (`/v1/resale`): BitoCard Shop suppliers' resale listings, sold on the reseller's Resale shop stores at
 * their own price inside each supplier's limits; notes the supplier approves, auto-listing rules, and suppliers with
 * their chat and deals. Money is in minor units of `currency`; rates in basis points (100 = 1%).
 */

export type ResaleGateReason = 'switch_off' | 'house_account' | 'not_verified' | 'no_country' | 'resale_closed';

export type ResaleAccount = {
  object: 'resale_account';
  available: boolean;
  reason: ResaleGateReason | null;
  country: string | null;
  stores: Array<{ id: string; name: string; subdomain: string; published: boolean }>;
  reseller_fee_bps: number | null;
  reseller_fee_cap: number | null;
};

export type ResaleCategory = { slug: string; name: string; children: Array<{ slug: string; name: string }> };

export type ResaleBadge = 'phone_confirmed' | 'id_checked';
export type ResaleSupplierSummary = { id: string; name: string; member_since: string; badges: ResaleBadge[] };
export type ResalePhoto = { url: string; width: number | null; height: number | null };
export type ResaleRange = { min: number; max: number };

export type ResaleCatalogueListing = {
  object: 'resale_catalogue_listing';
  id: string;
  ref: number;
  title: string;
  condition: 'new' | 'used' | 'untested' | 'parts' | null;
  category: { slug: string; name: string } | null;
  area: { name: string; state: string | null } | null;
  cover: ResalePhoto | null;
  delivery: 'none' | 'state' | 'nationwide';
  currency: string;
  supplier_price: number;
  available: number;
  discount_bps: number;
  floor_bps: number;
  markup_max_bps: number;
  deal_id: string | null;
  price_range: ResaleRange;
  earnings_at_max: number | null;
  supplier: ResaleSupplierSummary;
  in_stores: Array<{ store_id: string; resale_listing_id: string }>;
  published_at: string | null;
};

export type ResaleCatalogueDetail = Omit<ResaleCatalogueListing, 'object'> & {
  object: 'resale_catalogue_listing_detail';
  description: string | null;
  features: Array<{ key: string; name: string; unit: string | null; value: string | number | boolean | null }>;
  photos: ResalePhoto[];
  video: { url: string; poster_url: string | null; duration_ms: number | null } | null;
};

export type ResaleCatalogueQuery = {
  category?: string;
  q?: string;
  condition?: string;
  supplier_id?: string;
  store_id?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  offset?: number;
  limit?: number;
};

export type ResalePage<T> = { object: 'list'; data: T[]; total: number; offset: number; limit: number };

export type ResalePrice = {
  object: 'resale_price';
  currency: string;
  supplier_price: number;
  price: number;
  price_range: ResaleRange;
  in_range: boolean;
  discount_bps: number;
  floor_bps: number;
  markup_max_bps: number;
  deal_id: string | null;
  margin: number;
  reseller_fee: number;
  earnings: number;
  buyer_fee: number;
  buyer_pays: number;
};

export type ResaleState = 'selling' | 'paused' | 'removed' | 'supplier_stopped' | 'unavailable' | 'supplier_paused' | 'sold_out' | 'price_out_of_range';
export type ResaleNoteStatus = 'pending' | 'approved' | 'refused' | 'withdrawn';

export type ResaleListing = {
  object: 'resale_listing';
  id: string;
  store_id: string;
  listing_id: string;
  supplier_relationship_id: string;
  status: 'active' | 'paused' | 'removed';
  state: ResaleState;
  title: string;
  cover: ResalePhoto | null;
  currency: string;
  supplier_price: number | null;
  markup_bps: number | null;
  fixed_price: number | null;
  price: number;
  price_range: ResaleRange;
  discount_bps: number;
  floor_bps: number;
  markup_max_bps: number;
  deal_id: string | null;
  margin: number;
  reseller_fee: number;
  earnings: number;
  available: number;
  note: { text: string; status: ResaleNoteStatus; reason: string | null; submitted_at: string | null; decided_at: string | null } | null;
  supplier: ResaleSupplierSummary;
  rule_id: string | null;
  created_at: string;
  updated_at: string;
};

/** A price: a markup that follows the supplier's price, or a fixed price (send null to clear the other). */
export type ResalePricing = { markup_bps?: number | null; fixed_price?: number | null };

export type ResaleRule = {
  object: 'resale_rule';
  id: string;
  store_id: string;
  category: { slug: string; name: string } | null;
  markup_bps: number;
  excluded_supplier_ids: string[];
  active: boolean;
  listings_added: number;
  last_run_at: string | null;
  created_at: string;
};

export type ResaleDealStatus = 'offered' | 'active' | 'declined' | 'withdrawn' | 'ended';
export type ResaleDeal = {
  object: 'resale_deal';
  id: string;
  supplier_relationship_id: string;
  listing: { id: string; title: string } | null;
  discount_bps: number;
  floor_bps: number;
  status: ResaleDealStatus;
  ends_at: string | null;
  responded_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  created_at: string;
};

export type ResaleSupplier = {
  object: 'resale_supplier';
  id: string;
  supplier: ResaleSupplierSummary & { phone: string | null };
  stopped_by_supplier: boolean;
  closed_by_you: boolean;
  listings_in_stores: number;
  unread: number;
  deals: ResaleDeal[];
  last_message_at: string | null;
  created_at: string;
};

export type ResaleMessage = {
  object: 'resale_message';
  id: string;
  author: 'supplier' | 'reseller' | 'system';
  author_name: string;
  mine: boolean;
  body: string;
  deal: ResaleDeal | null;
  created_at: string;
};

const listingTags = (id: string) => [{ type: 'ResaleListing' as const, id }, { type: 'ResaleListing' as const, id: 'LIST' }];

export type ResaleOrderStatus = 'locked' | 'paid' | 'sent' | 'disputed' | 'released' | 'refunded' | 'partly_refunded' | 'declined' | 'cancelled' | 'lapsed';

/** An order on the reseller's Resale shops, without the buyer's details (as lists and webhook events carry it). */
export type ResaleOrder = {
  object: 'resale_order';
  id: string;
  number: string;
  mode: 'test' | 'live';
  store_id: string;
  status: ResaleOrderStatus;
  listing: { id: string; ref: number; title: string };
  quantity: number;
  currency: string;
  price: number;
  delivery_fee: number;
  buyer_fee: number;
  total: number;
  supplier_net: number;
  margin: number;
  reseller_fee: number | null;
  earnings: number | null;
  refund: number | null;
  deal_id: string | null;
  fulfilment: 'meet_up' | 'delivery';
  courier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivered_at: string | null;
  accept_by: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ResaleShipmentStatus = 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed_attempt' | 'returned';

/** One order with the buyer's details once the supplier accepts (every view logged), its shipment and timeline. */
export type ResaleOrderDetail = ResaleOrder & {
  supplier: { name: string };
  buyer: { name: string; email: string; phone: string | null; address: string | null } | null;
  note_shown: string | null;
  shipment: {
    courier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    delivered_at: string | null;
    events: Array<{ status: ResaleShipmentStatus; note: string | null; reported_by: 'seller' | 'courier' | 'bitocard'; at: string }>;
    dispatch_photos: Array<{ id: string; url: string; content_type: string; width: number | null; height: number | null }>;
  } | null;
  deadlines: { accept_by: string; pay_by: string | null; handover_by: string | null; confirm_by: string | null };
  timeline: { requested_at: string; locked_at: string | null; accepted_at: string | null; paid_at: string | null; sent_at: string | null; released_at: string | null; refunded_at: string | null; closed_at: string | null };
  ended_by: 'buyer' | 'seller' | 'reseller' | 'bitocard' | null;
  end_reason: string | null;
  dispute: { id: string; status: 'open' | 'decided'; reason: 'not_received' | 'not_as_described' | 'damaged' | 'other'; decision: 'refund' | 'partial' | 'release' | null } | null;
};

export type ResaleOrderThread = 'order' | 'trade';
export type ResaleOrderMessage = {
  object: 'resale_order_message';
  id: string;
  thread: ResaleOrderThread;
  /** `me` (your team), `buyer`, `supplier` or `bitocard`. */
  from: 'me' | 'buyer' | 'supplier' | 'reseller' | 'bitocard';
  name: string;
  body: string;
  created_at: string;
};

export const resaleOrderStatusText: Record<ResaleOrderStatus, string> = {
  locked: 'Waiting for the supplier',
  paid: 'Accepted: to hand over',
  sent: 'Shipped',
  disputed: 'In dispute',
  released: 'Completed',
  refunded: 'Refunded',
  partly_refunded: 'Partly refunded',
  declined: 'Declined by the supplier',
  cancelled: 'Cancelled',
  lapsed: 'Not accepted in time',
};

export const resaleApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    /** BitoCard Shop's categories in a country (public), for rules and filters. */
    resaleCategories: build.query<{ object: 'list'; data: ResaleCategory[] }, string>({ query: country => ({ url: '/v1/classifieds/categories', params: { country } }) }),
    resaleAccount: build.query<ResaleAccount, void>({ query: () => '/v1/resale', providesTags: [{ type: 'ResaleListing', id: 'ACCOUNT' }] }),
    resaleCatalogue: build.query<ResalePage<ResaleCatalogueListing>, ResaleCatalogueQuery>({
      query: query => ({ url: '/v1/resale/catalogue', params: params(query) }),
      providesTags: [{ type: 'ResaleListing', id: 'CATALOGUE' }],
    }),
    resaleCatalogueListing: build.query<ResaleCatalogueDetail, string>({ query: id => `/v1/resale/catalogue/${id}`, providesTags: [{ type: 'ResaleListing', id: 'CATALOGUE' }] }),
    resalePricePreview: build.query<ResalePrice, { listing_id: string; markup_bps?: number; fixed_price?: number }>({ query: query => ({ url: '/v1/resale/price-preview', params: params(query) }) }),
    resaleListings: build.query<ResalePage<ResaleListing>, { store_id?: string; status?: 'active' | 'paused' | 'removed'; offset?: number; limit?: number }>({
      query: query => ({ url: '/v1/resale/listings', params: params({ limit: 100, ...query }) }),
      providesTags: [{ type: 'ResaleListing', id: 'LIST' }],
    }),
    resaleListing: build.query<ResaleListing, string>({ query: id => `/v1/resale/listings/${id}`, providesTags: (_result, _error, id) => [{ type: 'ResaleListing', id }] }),
    addResaleListing: build.mutation<ResaleListing, { store_id: string; listing_id: string } & ResalePricing>({
      query: body => ({ url: '/v1/resale/listings', method: 'POST', body }),
      invalidatesTags: [{ type: 'ResaleListing', id: 'LIST' }, { type: 'ResaleListing', id: 'CATALOGUE' }, { type: 'ResaleSupplier', id: 'LIST' }],
    }),
    updateResaleListing: build.mutation<ResaleListing, { id: string; status?: 'active' | 'paused' } & ResalePricing>({
      query: ({ id, ...body }) => ({ url: `/v1/resale/listings/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => listingTags(id),
    }),
    removeResaleListing: build.mutation<{ id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/resale/listings/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [...listingTags(id), { type: 'ResaleListing', id: 'CATALOGUE' }],
    }),
    setResaleNote: build.mutation<ResaleListing, { id: string; note: string }>({
      query: ({ id, note }) => ({ url: `/v1/resale/listings/${id}/note`, method: 'PUT', body: { note } }),
      invalidatesTags: (_result, _error, { id }) => listingTags(id),
    }),
    clearResaleNote: build.mutation<ResaleListing, string>({
      query: id => ({ url: `/v1/resale/listings/${id}/note`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => listingTags(id),
    }),
    resaleRules: build.query<List<ResaleRule>, void>({ query: () => '/v1/resale/rules', providesTags: [{ type: 'ResaleRule', id: 'LIST' }] }),
    createResaleRule: build.mutation<ResaleRule, { store_id: string; category?: string | null; markup_bps: number; excluded_supplier_ids?: string[] }>({
      query: body => ({ url: '/v1/resale/rules', method: 'POST', body }),
      invalidatesTags: [{ type: 'ResaleRule', id: 'LIST' }, { type: 'ResaleListing', id: 'LIST' }, { type: 'ResaleListing', id: 'CATALOGUE' }],
    }),
    updateResaleRule: build.mutation<ResaleRule, { id: string; markup_bps?: number; active?: boolean; excluded_supplier_ids?: string[] }>({
      query: ({ id, ...body }) => ({ url: `/v1/resale/rules/${id}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ResaleRule', id: 'LIST' }, { type: 'ResaleListing', id: 'LIST' }],
    }),
    deleteResaleRule: build.mutation<{ id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/resale/rules/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'ResaleRule', id: 'LIST' }],
    }),
    resaleSuppliers: build.query<List<ResaleSupplier>, void>({ query: () => '/v1/resale/suppliers', providesTags: [{ type: 'ResaleSupplier', id: 'LIST' }] }),
    resaleSupplier: build.query<ResaleSupplier, string>({ query: id => `/v1/resale/suppliers/${id}`, providesTags: (_result, _error, id) => [{ type: 'ResaleSupplier', id }] }),
    startResaleSupplier: build.mutation<ResaleSupplier, string>({
      query: supplierId => ({ url: '/v1/resale/suppliers', method: 'POST', body: { supplier_id: supplierId } }),
      invalidatesTags: [{ type: 'ResaleSupplier', id: 'LIST' }],
    }),
    resaleMessages: build.query<List<ResaleMessage> & { closed: boolean }, string>({
      query: id => `/v1/resale/suppliers/${id}/messages`,
      // Reading marks them read; the supplier list catches up on its own refresh.
      providesTags: (_result, _error, id) => [{ type: 'ResaleSupplier', id: `MESSAGES:${id}` }],
    }),
    sendResaleMessage: build.mutation<ResaleMessage, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `/v1/resale/suppliers/${id}/messages`, method: 'POST', body: { body } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ResaleSupplier', id: `MESSAGES:${id}` }, { type: 'ResaleSupplier', id: 'LIST' }],
    }),
    setResaleChatClosed: build.mutation<ResaleSupplier, { id: string; closed: boolean }>({
      query: ({ id, closed }) => ({ url: `/v1/resale/suppliers/${id}/${closed ? 'close' : 'reopen'}`, method: 'POST' }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ResaleSupplier', id }, { type: 'ResaleSupplier', id: 'LIST' }, { type: 'ResaleSupplier', id: `MESSAGES:${id}` }],
    }),
    resaleOrders: build.query<List<ResaleOrder> & { total: number }, { status?: ResaleOrderStatus; store_id?: string; offset?: number; limit?: number } | void>({
      query: filter => ({ url: '/v1/resale/orders', params: params(filter ?? {}) }),
      providesTags: [{ type: 'ResaleOrder', id: 'LIST' }],
    }),
    resaleOrder: build.query<ResaleOrderDetail, string>({ query: id => `/v1/resale/orders/${id}`, providesTags: (_result, _error, id) => [{ type: 'ResaleOrder', id }] }),
    cancelResaleOrder: build.mutation<ResaleOrderDetail, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({ url: `/v1/resale/orders/${id}/cancel`, method: 'POST', body: reason ? { reason } : {} }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ResaleOrder', id }, { type: 'ResaleOrder', id: 'LIST' }, { type: 'ResaleOrder', id: `MESSAGES:${id}` }],
    }),
    resaleOrderMessages: build.query<List<ResaleOrderMessage> & { thread: ResaleOrderThread }, { id: string; thread: ResaleOrderThread }>({
      query: ({ id, thread }) => `/v1/resale/orders/${id}/messages?thread=${thread}`,
      providesTags: (_result, _error, { id }) => [{ type: 'ResaleOrder', id: `MESSAGES:${id}` }],
    }),
    sendResaleOrderMessage: build.mutation<ResaleOrderMessage, { id: string; thread: ResaleOrderThread; body: string }>({
      query: ({ id, thread, body }) => ({ url: `/v1/resale/orders/${id}/messages`, method: 'POST', body: { thread, body } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ResaleOrder', id: `MESSAGES:${id}` }],
    }),
    answerResaleDeal: build.mutation<ResaleDeal, { id: string; supplierId: string; answer: 'accept' | 'decline' | 'end' }>({
      query: ({ id, answer }) => ({ url: `/v1/resale/deals/${id}/${answer}`, method: 'POST' }),
      invalidatesTags: (_result, _error, { supplierId }) => [
        { type: 'ResaleSupplier', id: supplierId },
        { type: 'ResaleSupplier', id: 'LIST' },
        { type: 'ResaleSupplier', id: `MESSAGES:${supplierId}` },
        { type: 'ResaleListing', id: 'LIST' },
        { type: 'ResaleListing', id: 'CATALOGUE' },
      ],
    }),
  }),
});

export const {
  useResaleAccountQuery,
  useResaleCategoriesQuery,
  useResaleCatalogueQuery,
  useResaleCatalogueListingQuery,
  useResalePricePreviewQuery,
  useResaleListingsQuery,
  useResaleListingQuery,
  useAddResaleListingMutation,
  useUpdateResaleListingMutation,
  useRemoveResaleListingMutation,
  useSetResaleNoteMutation,
  useClearResaleNoteMutation,
  useResaleRulesQuery,
  useCreateResaleRuleMutation,
  useUpdateResaleRuleMutation,
  useDeleteResaleRuleMutation,
  useResaleSuppliersQuery,
  useResaleSupplierQuery,
  useStartResaleSupplierMutation,
  useResaleMessagesQuery,
  useSendResaleMessageMutation,
  useSetResaleChatClosedMutation,
  useAnswerResaleDealMutation,
  useResaleOrdersQuery,
  useResaleOrderQuery,
  useCancelResaleOrderMutation,
  useResaleOrderMessagesQuery,
  useSendResaleOrderMessageMutation,
} = resaleApi;

/** What a state means for the reseller, in a few words. */
export const resaleStateText: Record<ResaleState, string> = {
  selling: 'Selling',
  paused: 'Paused by you',
  removed: 'Removed',
  supplier_stopped: 'Supplier stopped you',
  unavailable: 'No longer open to resellers',
  supplier_paused: 'Paused by the supplier',
  sold_out: 'Sold out',
  price_out_of_range: 'Reprice to sell',
};

/** A basis-points rate as people read it: 1500 → "15%", 250 → "2.5%". */
export const bpsPercent = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
