import { bitocardApi } from '../base';
import type { VpnSubscription } from '../reseller/vpn';
import type { List } from './types';

/** VPN access as admins see it: the supplier's own state, the last check and its error (never the credentials). */
export type AdminVpnSubscription = VpnSubscription & {
  reseller_id: string;
  order_status: string | null;
  supplier: string;
  supplier_account_id: string | null;
  supplier_status: string | null;
  last_synced_at: string | null;
  next_sync_at: string | null;
  sync_failures: number;
  last_error: string | null;
  password_reset_pending: boolean;
};

/** A daily check of the VPN supplier account. Credit in US cents. */
export type VpnReconciliation = {
  object: 'vpn_reconciliation';
  id: string;
  balance_usd_cents: number | null;
  spent_usd_cents: number | null;
  supplier_active: number;
  expected_active: number;
  runway_days: number | null;
  unexpected: { id: string; username: string }[];
  missing: { id: string; supplier_account_id: string }[];
  complete: boolean;
  error: string | null;
  created_at: string;
};

type StatusCounts = Record<VpnSubscription['status'], number>;

export type VpnHealth = {
  object: 'vpn_health';
  live: StatusCounts;
  test: StatusCounts;
  needs_attention: number;
  ending_in_3_days: number;
  reconciliation: VpnReconciliation | null;
  low_balance_usd: number;
};

export const adminVpnApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    vpnHealth: build.query<VpnHealth, void>({ query: () => '/v1/admin/vpn/health', providesTags: [{ type: 'Vpn', id: 'HEALTH' }] }),
    adminVpnSubscriptions: build.query<List<AdminVpnSubscription>, { status?: string; mode?: 'live' | 'test'; q?: string }>({
      query: params => ({ url: '/v1/admin/vpn/subscriptions', params }),
      providesTags: [{ type: 'Vpn', id: 'LIST' }],
    }),
    vpnReconciliations: build.query<List<VpnReconciliation>, void>({ query: () => '/v1/admin/vpn/reconciliations', providesTags: [{ type: 'Vpn', id: 'RECONCILIATIONS' }] }),
    runVpnReconciliation: build.mutation<VpnReconciliation | { skipped: 'not_configured' }, void>({
      query: () => ({ url: '/v1/admin/vpn/reconciliations/run', method: 'POST' }),
      invalidatesTags: [{ type: 'Vpn', id: 'RECONCILIATIONS' }, { type: 'Vpn', id: 'HEALTH' }, { type: 'Vpn', id: 'LIST' }],
    }),
    syncVpn: build.mutation<AdminVpnSubscription, string>({
      query: id => ({ url: `/v1/admin/vpn/subscriptions/${id}/sync`, method: 'POST' }),
      invalidatesTags: [{ type: 'Vpn', id: 'LIST' }, { type: 'Vpn', id: 'HEALTH' }],
    }),
    suspendVpn: build.mutation<AdminVpnSubscription, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/vpn/subscriptions/${id}/suspend`, method: 'POST', body: { reason } }),
      invalidatesTags: [{ type: 'Vpn', id: 'LIST' }, { type: 'Vpn', id: 'HEALTH' }],
    }),
    enableVpn: build.mutation<AdminVpnSubscription, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/vpn/subscriptions/${id}/enable`, method: 'POST', body: { reason } }),
      invalidatesTags: [{ type: 'Vpn', id: 'LIST' }, { type: 'Vpn', id: 'HEALTH' }],
    }),
    adminResetVpnPassword: build.mutation<{ vpn_subscription: AdminVpnSubscription }, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/vpn/subscriptions/${id}/password-reset`, method: 'POST', body: { reason } }),
      invalidatesTags: [{ type: 'Vpn', id: 'LIST' }],
    }),
  }),
});

export const {
  useVpnHealthQuery,
  useAdminVpnSubscriptionsQuery,
  useVpnReconciliationsQuery,
  useRunVpnReconciliationMutation,
  useSyncVpnMutation,
  useSuspendVpnMutation,
  useEnableVpnMutation,
  useAdminResetVpnPasswordMutation,
} = adminVpnApi;
