import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Field, Notice, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import type { VerificationStatus } from '@/lib/types';

/**
 * The identity check gift cards need (once): the customer's names as on their ID and their consent to the ID and face
 * check, then BitoCard Verify (or the market's provider) in an in-app browser; on return the status is read again.
 */
export default function Identity() {
  const theme = useTheme();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const status = useQuery({ queryKey: ['verification', country], queryFn: () => api<VerificationStatus>(`/v1/store/account/verification?country=${country}`) });
  const names = (customer?.name ?? '').split(/\s+/);
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [bvn, setBvn] = useState('');
  const [consent, setConsent] = useState(false);
  const firstName = first ?? names[0] ?? '';
  const lastName = last ?? names.slice(1).join(' ');
  // Nigeria checks the BVN only where its provider is not BitoCard Verify (as bitocard.com's own page).
  const needsBvn = country === 'NG' && Boolean(status.data) && status.data?.provider !== 'bitocard';

  const start = useMutation({
    mutationFn: async (restart: boolean) => {
      if (!consent) throw new Error('Tick the box to agree to the check.');
      const check = await api<{ url: string | null; status: string }>('/v1/store/account/verification', {
        body: { country, first_name: firstName.trim(), last_name: lastName.trim(), redirect_url: `${siteUrl}/account/verification`, consent: true, ...(needsBvn ? { bvn } : {}), ...(restart ? { restart: true } : {}) },
      });
      if (check.url) await WebBrowser.openBrowserAsync(check.url).catch(() => undefined);
      await status.refetch();
    },
  });

  const latest = status.data?.latest;
  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Identity check
      </T>
      {status.data?.verified ? (
        <>
          <Notice tone="good">Your identity is checked. You can buy and sell gift cards.</Notice>
          <Button label="Done" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Card>
            <T kind="heading">Check your ID once to trade gift cards</T>
            <T muted>Airtime and data need no check. You will need your ID (NIN slip, voter&apos;s card, driver&apos;s licence or passport) and a quick selfie. It takes about 3 minutes.</T>
          </Card>
          {latest?.status === 'in_review' ? <Notice>Your check is being reviewed. We will tell you once it is decided.</Notice> : null}
          {latest?.reason ? <Notice tone="bad">{latest.reason}</Notice> : null}
          <Field label="First name (as on your ID)" value={firstName} onChangeText={setFirst} autoComplete="given-name" />
          <Field label="Last name (as on your ID)" value={lastName} onChangeText={setLast} autoComplete="family-name" />
          {needsBvn ? <Field label="BVN" value={bvn} onChangeText={value => setBvn(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" hint="Checked with your bank, never kept." /> : null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(value => !value)} style={styles.consent}>
            <View style={[styles.box, { borderColor: theme.navy, backgroundColor: consent ? theme.navy : 'transparent' }]}>{consent ? <T color="#ffffff">✓</T> : null}</View>
            <T style={{ flex: 1 }}>I agree that BitoCard checks my ID and face to confirm who I am, as its privacy notice explains.</T>
          </Pressable>
          {start.isError ? <Notice tone="bad">{start.error instanceof ApiError || start.error instanceof Error ? start.error.message : 'Something went wrong.'}</Notice> : null}
          <Button label={latest?.status === 'in_progress' ? 'Continue the check' : 'Start the check'} onPress={() => start.mutate(false)} busy={start.isPending} />
          {latest?.status === 'in_progress' ? <Button kind="secondary" label="Start again" onPress={() => start.mutate(true)} /> : null}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  consent: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
