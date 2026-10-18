"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { ActionDialog, Card, CardHeader, Button, errorMessage, formatDateTime, KeyValue, Notice, StatusBadge } from "@bitocard/admin-ui";
import { type VpnSubscription, useResetVpnPasswordMutation, useVpnSubscriptionsQuery } from "@bitocard/api-client/reseller";

export const vpnStatusLabels: Record<VpnSubscription["status"], string> = {
  provisioning: "Setting up",
  active: "Active",
  expired: "Ended",
  revoked: "Stopped (refunded)",
  suspended: "Suspended",
  failed: "Not set up",
  needs_review: "Needs support",
};

/**
 * An order's VPN access: its state, when it ends (it never renews), and resetting its password. The username and
 * password are in the order's deliveries above; a reset updates them there.
 */
export function VpnCard({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const subs = useVpnSubscriptionsQuery({ order_id: orderId });
  const [reset, state] = useResetVpnPasswordMutation();
  const [confirming, setConfirming] = useState<string | null>(null);
  const sub = subs.data?.data[0];
  if (!sub) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand-600" aria-hidden /> VPN access
          </span>
        }
        description={`${sub.term_days} days on up to ${sub.devices} devices. It does not renew automatically: sell another order for more time.`}
        actions={
          canManage && sub.status === "active" ? (
            <Button variant="secondary" size="sm" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setConfirming(sub.id)}>
              Reset password
            </Button>
          ) : null
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {state.isSuccess ? <Notice tone="green">The password was reset. The new one is in the delivery above; the old one no longer works.</Notice> : null}
        <KeyValue
          items={[
            { label: "Status", value: <StatusBadge status={sub.status === "expired" ? "expired" : sub.status} label={vpnStatusLabels[sub.status]} /> },
            { label: sub.status === "active" || sub.status === "provisioning" ? "Ends" : "Was due to end", value: sub.expires_at ? formatDateTime(sub.expires_at) : "—" },
            ...(sub.ended_at ? [{ label: "Stopped", value: formatDateTime(sub.ended_at) }] : []),
            ...(sub.password_changed_at ? [{ label: "Password last reset", value: formatDateTime(sub.password_changed_at) }] : []),
          ]}
        />
      </div>
      <ActionDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Reset the VPN password"
        description="A new password is set now and every device signed in with the old one is disconnected. Give your customer the new password from this order."
        confirmLabel="Reset password"
        requireReason={false}
        onConfirm={async () => {
          if (confirming) await reset(confirming).unwrap();
        }}
      />
      {state.error && !confirming ? <div className="px-5 pb-5 sm:px-6"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
    </Card>
  );
}
