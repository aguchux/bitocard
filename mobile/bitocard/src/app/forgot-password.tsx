import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import type { SessionReply } from '@/lib/types';

/**
 * Forgot password: the email first (the API sends a 6-digit code, and says the same whether or not there is an
 * account), then the code and a new password, which signs the customer in (every other session is ended).
 */
export default function ForgotPassword() {
  const { signedIn } = useAccount();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter the email you sign in with.');
    setBusy(true);
    try {
      await api('/v1/store/account/password/forgot', { body: { email: email.trim() } });
      setSent(true);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No answer. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    if (password.length < 10) return setError('Choose a password of at least 10 characters.');
    setBusy(true);
    try {
      const customer = await signedIn(await api<SessionReply>('/v1/store/account/password/reset', { body: { email: email.trim(), code: code.trim(), password } }));
      router.replace(customer.email_verified ? '/' : '/verify');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No answer. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Reset your password
      </T>
      {!sent ? (
        <>
          <T muted>We email you a code to choose a new password.</T>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" onSubmitEditing={send} />
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Button label="Email me a code" onPress={send} busy={busy} />
        </>
      ) : (
        <>
          <Notice tone="good">If {email.trim()} has a BitoCard account, a code is on its way. It works for 30 minutes.</Notice>
          <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 10 characters." />
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Button label="Set password and sign in" onPress={reset} busy={busy} />
          <Button kind="secondary" label="Send another code" onPress={send} disabled={busy} />
        </>
      )}
    </Page>
  );
}
