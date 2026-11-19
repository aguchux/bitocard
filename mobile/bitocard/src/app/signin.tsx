import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import type { SessionReply } from '@/lib/types';

/** Sign in with the bitocard.com account's email and password; an unconfirmed email goes on to its code. */
export default function SignIn() {
  const { signedIn } = useAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      const customer = await signedIn(await api<SessionReply>('/v1/store/account/signin', { body: { email: email.trim(), password } }));
      router.replace(customer.email_verified ? '/' : '/verify');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Welcome back
      </T>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label="Sign in" onPress={submit} busy={busy} />
      <Button kind="secondary" label="Create an account" onPress={() => router.replace('/signup')} />
      <T kind="small" muted>
        Forgot your password? Reset it on bitocard.com, then sign in here.
      </T>
    </Page>
  );
}

