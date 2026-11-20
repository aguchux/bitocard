import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Line, Notice, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirmOnPhone } from '@/lib/biometrics';
import type { StoreVpn } from '@/lib/types';

/** bitocard.com's words for each state of VPN access. */
export const vpnStatusLabels: Record<StoreVpn['status'], string> = {
  provisioning: 'Setting up',
  active: 'Active',
  expired: 'Ended',
  revoked: 'Stopped (refunded)',
  suspended: 'Suspended',
  failed: 'Not set up',
  needs_review: 'Needs support',
};

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * An order's VPN access: whether it works, when it ends (it never renews), and a new password on request (after Face
 * ID or the PIN), which signs out every device using the old one and is shown here once.
 */
export function VpnAccess({ checkoutId }: { checkoutId: string }) {
  const access = useQuery({ queryKey: ['orders', checkoutId, 'vpn'], queryFn: () => api<{ vpn_subscription: StoreVpn | null }>(`/v1/store/checkouts/${checkoutId}/vpn`) });
  const [confirming, setConfirming] = useState(false);
  const reset = useMutation({
    mutationFn: async () => {
      if (!(await confirmOnPhone('Change your VPN password'))) return null;
      return api<{ credentials: { username: string; password: string } }>(`/v1/store/checkouts/${checkoutId}/vpn/password-reset`, { body: {} });
    },
    onSuccess: () => {
      setConfirming(false);
      void access.refetch();
    },
  });
  const vpn = access.data?.vpn_subscription;
  if (!vpn) return null;
  const active = vpn.status === 'active';
  const fresh = reset.data?.credentials;
  return (
    <Card>
      <T kind="heading">VPN access</T>
      <Line label="Status" value={vpnStatusLabels[vpn.status]} />
      <Line label={active || vpn.status === 'provisioning' ? 'Access ends' : 'Was due to end'} value={vpn.expires_at ? when(vpn.expires_at) : 'When it is set up'} />
      <Line label="Devices" value={`Up to ${vpn.devices} at once`} />
      <T kind="small" muted>
        Does not renew automatically. Access stops on the date above; to keep using it, buy VPN access again.
      </T>
      {vpn.status === 'needs_review' || vpn.status === 'suspended' ? <Notice>This access is paused while it is checked. Contact us if you need help.</Notice> : null}
      {fresh ? (
        <View style={{ gap: 8 }}>
          <Notice tone="good">Your password was changed. Sign in again on each device with these.</Notice>
          <Line label="Username" value={fresh.username} />
          <Line label="New password" value={fresh.password} />
          <Button kind="secondary" label="Copy new password" onPress={() => void Clipboard.setStringAsync(fresh.password)} />
        </View>
      ) : null}
      {active && !fresh ? (
        confirming ? (
          <>
            <T kind="small">A new password signs out every device using the old one. Continue?</T>
            <Button label="Change password" busy={reset.isPending} onPress={() => reset.mutate()} />
            <Button kind="secondary" label="Cancel" onPress={() => setConfirming(false)} />
          </>
        ) : (
          <Button kind="secondary" label="Reset password" onPress={() => setConfirming(true)} />
        )
      ) : null}
      {reset.isError ? <Notice tone="bad">{reset.error instanceof ApiError ? reset.error.message : 'No answer. Try again.'}</Notice> : null}
    </Card>
  );
}
