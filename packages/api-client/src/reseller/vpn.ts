import { bitocardApi } from '../base';
import { type List, type Mode, params } from './common';

/**
 * `provisioning`: being set up; `active`: works until `expires_at`; `expired`: its term ended; `revoked`: stopped after
 * a refund; `suspended`: stopped by BitoCard; `failed`: never set up; `needs_review`: BitoCard is checking it.
 */
export type VpnStatus = 'provisioning' | 'active' | 'expired' | 'revoked' | 'suspended' | 'failed' | 'needs_review';

/** VPN access an order bought (`/v1/vpn-subscriptions`). Its username and password are only on the order. */
export type VpnSubscription = {
  object: 'vpn_subscription';
  id: string;
  order_id: string;
  mode: Mode;
  status: VpnStatus;
  term_days: number;
  devices: number;
  renews_automatically: false;
  starts_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A reset's answer: the access and its new password (the order shows it from then on). */
export type VpnPasswordReset = { vpn_subscription: VpnSubscription; credentials: { username: string; password: string } };

export const resellerVpnApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    /** An order's VPN access (or all of it, newest first). */
    vpnSubscriptions: build.query<List<VpnSubscription>, { order_id?: string } | void>({
      query: filter => ({ url: '/v1/vpn-subscriptions', params: params({ limit: 50, order_id: filter?.order_id }) }),
      providesTags: [{ type: 'Vpn', id: 'LIST' }],
    }),
    resetVpnPassword: build.mutation<VpnPasswordReset, string>({
      query: id => ({ url: `/v1/vpn-subscriptions/${id}/password-reset`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Vpn', id: 'LIST' }, { type: 'Vpn', id }, 'Order'],
    }),
  }),
});

export const { useVpnSubscriptionsQuery, useResetVpnPasswordMutation } = resellerVpnApi;
