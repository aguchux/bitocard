import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';

import { CountryPicker } from '@/components/country-picker';
import { SignInMethods, useFinishSignIn } from '@/components/sign-in-methods';
import { ThemedText } from '@/components/themed-text';
import { Button, Field, fieldError, FormError, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { useMarket } from '@/lib/market';
import type { SessionReply } from '@/lib/types';

type Step = 'email' | 'code' | 'details';

/**
 * Sign up, as udozo.com's wizard: the email and the code emailed to it (so the account starts confirmed), then the first
 * and last name, the country (fixed), the mobile (kept to confirm later, as on udozo.com: sign-up never waits for a
 * text) and the password. Or Apple, Google, Facebook or WhatsApp.
 */
export default function SignUpScreen() {
  const params = useLocalSearchParams<{ email?: string; ref?: string }>();
  const market = useMarket();
  const finish = useFinishSignIn();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [country, setCountry] = useState<string | null>(market.country);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const sendCode = useMutation({ mutationFn: () => api('/v1/store/account/signup/email', { body: { email: email.trim() } }), onSuccess: () => setStep('code') });
  const verify = useMutation({
    mutationFn: () => api<{ signup_token: string }>('/v1/store/account/signup/email/verify', { body: { email: email.trim(), code: code.trim() } }),
    onSuccess: reply => {
      setToken(reply.signup_token);
      setStep('details');
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api<SessionReply>('/v1/store/account/signup', {
        body: { first_name: first.trim(), last_name: last.trim(), email: email.trim(), country, phone: phone.trim(), phone_later: true, password, signup_token: token, ref: params.ref },
      }),
    onSuccess: finish,
    onError: error => {
      // The hour the emailed code gave ran out: confirm the email again.
      if (error instanceof ApiError && error.code === 'signup_token_invalid') setStep('email');
    },
  });
  const taken = sendCode.error instanceof ApiError && (sendCode.error.code === 'email_taken' || sendCode.error.code === 'email_in_use');

  return (
    <Page edges={['bottom']}>
      <ThemedText type="subtitle" accessibilityRole="header">
        Create your Udozo account
      </ThemedText>
      {step === 'email' ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
          <FormError error={sendCode.error} />
          {taken ? <Button tone="secondary" title="Sign in instead" onPress={() => router.replace('/signin')} /> : null}
          <Button title="Email me a code" disabled={!email.includes('@')} loading={sendCode.isPending} onPress={() => sendCode.mutate()} />
        </>
      ) : step === 'code' ? (
        <>
          <ThemedText>{`We emailed a 6-digit code to ${email}.`}</ThemedText>
          <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
          <FormError error={verify.error} />
          <Button title="Continue" disabled={code.trim().length !== 6} loading={verify.isPending} onPress={() => verify.mutate()} />
          <Button tone="ghost" title="Send the code again" loading={sendCode.isPending} onPress={() => sendCode.mutate()} />
        </>
      ) : (
        <>
          <Field label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" error={fieldError(create.error, 'first_name')} hint="As on your ID." />
          <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" error={fieldError(create.error, 'last_name')} />
          <CountryPicker value={country} onChange={setCountry} error={fieldError(create.error, 'country')} />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" error={fieldError(create.error, 'phone')} hint="A mobile from your country. You can confirm it later." />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={fieldError(create.error, 'password')} hint="At least 10 characters." />
          <FormError error={create.error instanceof ApiError && create.error.param ? null : create.error} />
          <ThemedText type="small" themeColor="textSecondary">
            By creating an account you accept Udozo&apos;s terms of use and privacy notice.
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <Button tone="ghost" title="Terms" onPress={() => WebBrowser.openBrowserAsync('https://udozo.com/legal/terms')} />
            <Button tone="ghost" title="Privacy" onPress={() => WebBrowser.openBrowserAsync('https://udozo.com/legal/privacy')} />
          </View>
          <Button title="Create my account" disabled={!first.trim() || !last.trim() || !country || !phone.trim() || password.length < 10} loading={create.isPending} onPress={() => create.mutate()} />
        </>
      )}
      {step === 'email' ? (
        <View style={{ gap: Spacing.two, marginTop: Spacing.three }}>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            or
          </ThemedText>
          <SignInMethods intent="signup" refCode={params.ref} />
          <Button tone="ghost" title="Already have an account? Sign in" onPress={() => router.replace('/signin')} />
        </View>
      ) : null}
    </Page>
  );
}
