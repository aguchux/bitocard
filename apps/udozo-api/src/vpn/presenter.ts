import type { VpnSubscription } from '../generated/prisma/client.js';
import { vpnDeviceLimit, vpnTermDays } from '../suppliers/vpnresellers.adapter.js';

export const vpnStatuses = ['provisioning', 'active', 'expired', 'revoked', 'suspended', 'failed', 'needs_review'] as const;
export type VpnStatus = (typeof vpnStatuses)[number];

/** What resellers, customers and webhooks see: never the supplier, its account ID or the credentials. */
export function presentVpn(sub: VpnSubscription) {
  return {
    object: 'vpn_subscription' as const,
    id: sub.id,
    order_id: sub.orderId,
    mode: sub.mode,
    status: sub.status as VpnStatus,
    term_days: vpnTermDays,
    devices: vpnDeviceLimit,
    renews_automatically: false as const,
    starts_at: sub.startsAt?.toISOString() ?? null,
    expires_at: sub.expiresAt?.toISOString() ?? null,
    ended_at: sub.disabledAt?.toISOString() ?? null,
    password_changed_at: sub.passwordChangedAt?.toISOString() ?? null,
    created_at: sub.createdAt.toISOString(),
    updated_at: sub.updatedAt.toISOString(),
  };
}

/** Admins also see the supplier's own state, the last check and its error (never the credentials). */
export function presentVpnForAdmin(sub: VpnSubscription & { order?: { status: string } | null }) {
  return {
    ...presentVpn(sub),
    reseller_id: sub.resellerId,
    order_status: sub.order?.status ?? null,
    supplier: sub.supplierCode,
    supplier_account_id: sub.supplierAccountId,
    supplier_status: sub.supplierStatus,
    last_synced_at: sub.lastSyncedAt?.toISOString() ?? null,
    next_sync_at: sub.nextSyncAt?.toISOString() ?? null,
    sync_failures: sub.syncFailures,
    last_error: sub.lastError,
    password_reset_pending: Boolean(sub.pendingPasswordEncrypted),
  };
}

