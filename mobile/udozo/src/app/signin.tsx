import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';

import { SignInMethods, useFinishSignIn } from '@/components/sign-in-methods';
import { ThemedText } from '@/components/themed-text';
import { Button, Field, fieldError, FormError, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { SessionReply } from '@/lib/types';

/**
 * Sign in: the email first (an email with no account goes on to sign up with it; one made with Google, Apple or
 * Facebook says so), then the password. Or Apple, Google, Facebook or WhatsApp.
 */
export default function SignInScreen() {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const finish = useFinishSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'password' | 'social'>('email');

  const lookup = useMutation({
    mutationFn: () => api<{ exists: boolean; password?: boolean }>('/v1/store/account/signin/lookup', { body: { email: email.trim() } }),
    onSuccess: found => {
      if (!found.exists) router.replace({ pathname: '/signup', params: { email: email.trim(), ref } });
      else setStep(found.password === false ? 'social' : 'password');
    },
  });
  const signIn = useMutation({
    mutationFn: () => api<SessionReply>('/v1/store/account/signin', { body: { email: email.trim(), password } }),
    onSuccess: finish,
  });

  return (
    <Page edges={['bottom']}>
      <ThemedText type="subtitle" accessibilityRole="header">
        Sign in to Udozo
      </ThemedText>
      {step === 'email' ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" error={fieldError(lookup.error, 'email')} />
          <FormError error={fieldError(lookup.error, 'email') ? null : lookup.error} />
          <Button title="Continue" disabled={!email.includes('@')} loading={lookup.isPending} onPress={() => lookup.mutate()} />
        </>
      ) : step === 'password' ? (
        <>
          <ThemedText themeColor="textSecondary">{email}</ThemedText>
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" autoFocus />
          <FormError error={signIn.error} />
          <Button title="Sign in" disabled={!password} loading={signIn.isPending} onPress={() => signIn.mutate()} />
          <Button tone="ghost" title="Forgot password" onPress={() => WebBrowser.openBrowserAsync(`https://udozo.com/forgot-password?email=${encodeURIComponent(email.trim())}`)} />
          <Button tone="ghost" title="Use another email" onPress={() => setStep('email')} />
        </>
      ) : (
        <ThemedText>{`${email} signs in with Google, Apple, Facebook or WhatsApp. Choose it below, or set a password with Forgot password on udozo.com.`}</ThemedText>
      )}
      <View style={{ gap: Spacing.two, marginTop: Spacing.three }}>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          or
        </ThemedText>
        <SignInMethods intent="signin" refCode={ref} />
      </View>
      <Button tone="ghost" title="New to Udozo? Create an account" onPress={() => router.replace({ pathname: '/signup', params: { ref } })} />
    </Page>
  );
}
