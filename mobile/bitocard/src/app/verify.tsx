import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { Button, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';

/** The 6-digit code emailed at sign-up (30 minutes); Send again asks for a new one, at most once a minute. */
export default function Verify() {
  const { customer, refresh, signOut } = useAccount();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'bad' | 'good'; text: string } | null>(null);

  if (customer === null) return <Redirect href="/welcome" />;

  const confirm = async () => {
    setMessage(null);
    if (!/^\d{6}$/.test(code)) return setMessage({ tone: 'bad', text: 'Enter the 6-digit code.' });
    setBusy(true);
    try {
      await api('/v1/store/account/email/verify', { body: { code } });
      await refresh();
      router.replace('/');
    } catch (failure) {
      setMessage({ tone: 'bad', text: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setMessage(null);
    try {
      await api('/v1/store/account/email/resend', { body: {} });
      setMessage({ tone: 'good', text: 'We sent a new code. Check your inbox, and spam too.' });
    } catch (failure) {
      setMessage({ tone: 'bad', text: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.' });
    }
  };

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Check your email
      </T>
      <T muted>We sent a 6-digit code to {customer?.email ?? 'your email'}. It works for 30 minutes.</T>
      <Field label="Code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} onSubmitEditing={confirm} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button label="Confirm" onPress={confirm} busy={busy} />
      <Button kind="secondary" label="Send the code again" onPress={resend} />
      <Button
        kind="secondary"
        label="Use another account"
        onPress={async () => {
          await signOut();
          router.replace('/welcome');
        }}
      />
    </Page>
  );
}
