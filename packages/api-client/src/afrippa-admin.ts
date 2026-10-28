import { bitocardApi } from './base';

/**
 * Afrippa's own admin routes (admin.afrippa.com, realm `afrippa_admin`): P2P orders and their appeals, the order room,
 * traders' reports, fee rates and standing. Signing in, the session, step-up, the inbox, tickets, chats, integrations and
 * activity reuse the admin hooks (`@bitocard/api-client/admin`) with `setAdminProduct('afrippa')`.
 */

type Mode = 'live' | 'test';
type List<T> = { object: 'list'; data: T[] };
const clean = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));

export type P2pOrderStatus = 'pending_payment' | 'paid' | 'appealed' | 'released' | 'cancelled' | 'returned';

/** An order as Afrippa's admins see it: both sides, the seller's account while open, the decision's note. */
export type AdminP2pOrder = {
  object: 'p2p_order';
  id: string;
  number: string;
  mode: Mode;
  ad_id: string;
  market: string;
  asset: string;
  decimals: number;
  currency: string;
  side: null;
  status: P2pOrderStatus;
  price: number;
  amount: string;
  fiat: number;
  buyer_fee: string;
  seller_fee: string;
  received: string;
  escrow: string;
  payment_window: number;
  pay_by: string;
  buyer: { nickname: string };
  seller: { nickname: string };
  payment_method: { kind: string; label: string; currency: string; hint: string; holder_name: string; details: Record<string, string | null> | null };
  payer_name: string;
  paid_from: { kind: string; label: string; hint: string; holder_name: string } | null;
  warnings: string[];
  paid_at: string | null;
  appealed_at: string | null;
  appealed_by: 'buyer' | 'seller' | null;
  appeal_reason: string | null;
  closed_at: string | null;
  cancel_reason: string | null;
  decision: { fault: 'buyer' | 'seller' | 'none'; note: string | null } | null;
  created_at: string;
  updated_at: string;
};

export type OrderRoomMessage = {
  object: 'p2p_order_message';
  id: string;
  from: 'buyer' | 'seller' | 'afrippa' | 'system';
  body: string | null;
  file: { name: string; content_type: string; size: number } | null;
  created_at: string;
};

export type P2pReport = {
  object: 'p2p_report';
  id: string;
  number: string;
  mode: Mode;
  reported: string;
  reason: 'fraud' | 'fake_payment' | 'third_party_payment' | 'off_platform' | 'abuse' | 'other';
  details: string;
  order_id: string | null;
  status: 'open' | 'upheld' | 'dismissed';
  decided_at: string | null;
  created_at: string;
  reporter: string;
  reporter_id: string;
  reported_id: string;
  decision_note: string | null;
};

export type P2pFeeRate = { object: 'p2p_fee_rate'; asset: string; market: string | null; buyer_bps: number; seller_bps: number; warnings?: string[] };

export const afrippaAdminApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    p2pOrders: build.query<List<AdminP2pOrder>, { mode?: Mode; status?: P2pOrderStatus; customer_id?: string; limit?: number }>({
      query: args => ({ url: '/v1/afrippa/admin/p2p/orders', params: clean(args) }),
      providesTags: [{ type: 'P2p', id: 'ORDERS' }],
    }),
    p2pOrder: build.query<AdminP2pOrder, string>({ query: id => `/v1/afrippa/admin/p2p/orders/${id}`, providesTags: (_result, _error, id) => [{ type: 'P2p', id }] }),
    orderRoom: build.query<{ object: 'list'; open: boolean; data: OrderRoomMessage[] }, string>({
      query: id => `/v1/afrippa/admin/p2p/orders/${id}/messages`,
      providesTags: (_result, _error, id) => [{ type: 'P2p', id: `ROOM-${id}` }],
    }),
    writeInOrderRoom: build.mutation<OrderRoomMessage, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `/v1/afrippa/admin/p2p/orders/${id}/messages`, method: 'POST', body: { body } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'P2p', id: `ROOM-${id}` }],
    }),
    decideOrder: build.mutation<AdminP2pOrder, { id: string; outcome: 'release' | 'return'; fault: 'buyer' | 'seller' | 'none'; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/p2p/orders/${id}/decide`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'P2p', id }, { type: 'P2p', id: 'ORDERS' }, { type: 'P2p', id: `ROOM-${id}` }],
    }),
    p2pReports: build.query<List<P2pReport>, { status?: 'open' | 'upheld' | 'dismissed'; mode?: Mode }>({
      query: args => ({ url: '/v1/afrippa/admin/p2p/reports', params: clean(args) }),
      providesTags: [{ type: 'P2p', id: 'REPORTS' }],
    }),
    decideReport: build.mutation<P2pReport, { id: string; decision: 'upheld' | 'dismissed'; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/p2p/reports/${id}/decide`, method: 'POST', body }),
      invalidatesTags: [{ type: 'P2p', id: 'REPORTS' }],
    }),
    p2pFeeRates: build.query<List<P2pFeeRate> & { max_bps: number }, void>({ query: () => '/v1/afrippa/admin/p2p/fee-rates', providesTags: [{ type: 'P2p', id: 'FEES' }] }),
    setP2pFeeRate: build.mutation<P2pFeeRate, { asset: string; market: string | null; buyer_bps: number; seller_bps: number }>({
      query: body => ({ url: '/v1/afrippa/admin/p2p/fee-rates', method: 'PUT', body }),
      invalidatesTags: [{ type: 'P2p', id: 'FEES' }],
    }),
    removeP2pFeeRate: build.mutation<P2pFeeRate, { asset: string; market: string | null }>({
      query: ({ asset, market }) => ({ url: `/v1/afrippa/admin/p2p/fee-rates/${asset}/${market ?? 'all'}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'P2p', id: 'FEES' }],
    }),
  }),
});

export const {
  useP2pOrdersQuery,
  useP2pOrderQuery,
  useOrderRoomQuery,
  useWriteInOrderRoomMutation,
  useDecideOrderMutation,
  useP2pReportsQuery,
  useDecideReportMutation,
  useP2pFeeRatesQuery,
  useSetP2pFeeRateMutation,
  useRemoveP2pFeeRateMutation,
} = afrippaAdminApi;
