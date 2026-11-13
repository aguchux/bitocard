import { useMutation, useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Failed, Field, FormError, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

type Status = { verified: boolean; provider: string; latest: { status: string; reason: string | null; url: string | null } | null };
type Verification = { status: string; url: string | null };

/** A declined check's reason in words (Udozo Verify's codes and the older ones), else the code. */
const reasons: Record<string, string> = {
  not_verified: 'We could not confirm your identity',
  name_mismatch: 'The name did not match',
  expired: 'The check was not finished in time',
  document_unreadable: 'The ID photo could not be read',
  document_expired: 'The ID has expired',
  face_mismatch: 'The selfie did not match the ID',
  liveness_failed: 'The live check did not pass',
};

/** Where Udozo Verify sends the customer back to: udozo.com's own page, which the app also opens. */
const returnUrl = 'https://udozo.com/account/verification';

/**
 * The identity check (udozo.com's /account/verification): once, before a UdozoPay seller is paid out where the market
 * needs it. Udozo Verify runs in an in-app browser (its links work once, so a check in progress gets a fresh one);
 * the status is read again when the customer comes back.
 */
export default function IdentityScreen() {
  const theme = useTheme();
  const { customer } = useAccount();
  const country = customer?.country ?? '';
  const status = useQuery({ queryKey: ['identity', country], enabled: Boolean(country), queryFn: () => api<Status>(`/v1/store/account/verification?country=${country}`) });
  const [first, setFirst] = useState(customer?.first_name ?? '');
  const [last, setLast] = useState(customer?.last_name ?? '');
  const [consent, setConsent] = useState(false);
  const start = useMutation({
    mutationFn: async () => {
      const check = await api<Verification>('/v1/store/account/verification', { body: { country, first_name: first.trim() || customer?.first_name, last_name: last.trim() || customer?.last_name || '', consent: true, redirect_url: returnUrl } });
      if (check.url) await WebBrowser.openBrowserAsync(check.url).catch(() => undefined);
      return check;
    },
    onSettled: () => void status.refetch(),
  });

  if (customer === undefined) return <AccountPending />;
  if (!customer) {
    return (
      <Page>
        <SignedOut title="Identity check" body="Sign in to check your identity." />
      </Page>
    );
  }
  if (!country) {
    return (
      <Page edges={[]}>
        <ThemedText>Finish your account and choose your country first.</ThemedText>
      </Page>
    );
  }
  if (status.isPending) return <Loading />;
  if (status.isError) return <Failed error={status.error} retry={() => void status.refetch()} />;
  const data = status.data;
  if (data.verified) {
    return (
      <Page edges={[]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <ShieldCheck size={24} color={theme.success} />
          <ThemedText type="heading" style={{ color: theme.success }}>
            You are verified.
          </ThemedText>
        </View>
      </Page>
    );
  }
  if (data.latest?.status === 'in_review') {
    return (
      <Page edges={[]}>
        <ThemedText>Your check is being reviewed by a person. We will tell you by email and here.</ThemedText>
        <Button title="Check again" tone="secondary" onPress={() => void status.refetch()} />
      </Page>
    );
  }
  const resume = data.latest?.status === 'in_progress';
  return (
    <Page edges={[]}>
      <ThemedText themeColor="textSecondary">Once, before you are paid for a UdozoPay sale. It protects buyers and sellers from fraud.</ThemedText>
      {data.latest?.reason ? (
        <Card style={{ backgroundColor: theme.backgroundElement }}>
          <ThemedText type="small">{`Your last check did not pass: ${reasons[data.latest.reason] ?? data.latest.reason}.`}</ThemedText>
        </Card>
      ) : null}
      {resume ? null : (
        <>
          <Field label="First name, as on your ID" value={first} onChangeText={setFirst} autoComplete="given-name" />
          <Field label="Last name, as on your ID" value={last} onChangeText={setLast} autoComplete="family-name" />
          <ThemedText type="small">You take photos of your ID and a short selfie video. Udozo’s reviewers check them; the photos are kept sealed and deleted when no longer needed.</ThemedText>
          <Chip label={consent ? 'I agree to the face check ✓' : 'I agree to the face check'} selected={consent} onPress={() => setConsent(value => !value)} />
          <Button tone="ghost" title="How Udozo uses it (privacy notice)" onPress={() => WebBrowser.openBrowserAsync('https://udozo.com/legal/privacy').catch(() => undefined)} />
        </>
      )}
      <FormError error={start.error} />
      <Button title={resume ? 'Continue my check' : 'Start the check'} loading={start.isPending} disabled={!resume && (!consent || !first.trim() || !last.trim())} onPress={() => start.mutate()} />
    </Page>
  );
}
