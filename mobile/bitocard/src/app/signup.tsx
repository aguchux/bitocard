import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Field, Notice, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import type { Market, SessionReply } from '@/lib/types';

/**
 * Create a bitocard.com account: name, email, the country (fixed for good: the wallet is in its currency) and a
 * password. The API emails a 6-digit code at once; the next screen takes it.
 */
export default function SignUp() {
  const theme = useTheme();
  const { signedIn } = useAccount();
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api<{ data: Market[] }>('/v1/countries'), staleTime: 60 * 60_000 });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; param?: string } | null>(null);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError({ message: 'Enter your name.', param: 'name' });
    if (!email.trim()) return setError({ message: 'Enter your email.', param: 'email' });
    if (!country) return setError({ message: 'Choose your country.', param: 'country' });
    if (password.length < 10) return setError({ message: 'Use at least 10 characters.', param: 'password' });
    setBusy(true);
    try {
      await signedIn(await api<SessionReply>('/v1/store/account/signup', { body: { name: name.trim(), email: email.trim(), country, password } }));
      router.replace('/verify');
    } catch (failure) {
      setError(failure instanceof ApiError ? { message: failure.message, param: failure.param } : { message: 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (param: string) => (error?.param === param ? error.message : null);

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Create your account
      </T>
      <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={fieldError('name')} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" error={fieldError('email')} />

      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Country">
        <T kind="label">Country</T>
        {markets.data?.data.map(market => {
          const on = market.code === country;
          return (
            <Pressable
              key={market.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${market.name}, ${market.currency}`}
              onPress={() => setCountry(market.code)}
              style={[styles.option, { backgroundColor: theme.card, borderColor: on ? theme.pink : theme.line, borderWidth: on ? 2 : 1 }]}>
              <T style={{ flex: 1 }}>{market.name}</T>
              <T kind="small" muted>
                {market.currency}
              </T>
            </Pressable>
          );
        })}
        {markets.isError ? <Notice tone="bad">The countries could not be loaded. Check your connection.</Notice> : null}
        <T kind="small" color={fieldError('country') ? theme.bad : theme.textSecondary}>
          {fieldError('country') ?? "Your wallet is in this country's currency. It can't be changed later."}
        </T>
      </View>

      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 10 characters." error={fieldError('password')} />
      {error && !error.param ? <Notice tone="bad">{error.message}</Notice> : null}
      <T kind="small" muted>
        By continuing you accept BitoCard&apos;s terms of use and privacy notice (legals.bitocard.com).
      </T>
      <Button label="Continue" onPress={submit} busy={busy} />
    </Page>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 52, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
