import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { CountryPicker } from '@/components/country-picker';
import { ThemedText } from '@/components/themed-text';
import { Button, Field, fieldError, FormError, Loading, Page } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import type { Customer } from '@/lib/types';

/**
 * Finish your account, one thing at a time, as udozo.com's `/verify`: the code emailed to the account (Facebook's
 * sign-ups, and older accounts), then for a Google, Apple, Facebook or WhatsApp sign-up its name, country and mobile,
 * then the mobile's texted code, or Confirm it later.
 */
export default function VerifyScreen() {
  const { customer, pending, refresh, signOut } = useAccount();

  useEffect(() => {
    if (customer && !pending) router.replace('/');
    if (customer === null) router.replace('/signin');
  }, [customer, pending]);

  if (!customer) return <Loading />;
  return (
    <Page edges={['bottom']}>
      {!customer.email_verified ? <EmailCode customer={customer} onDone={refresh} /> : !customer.country ? <AboutYou customer={customer} onDone={refresh} /> : <Mobile customer={customer} onDone={refresh} />}
      <Button tone="ghost" title="Sign out" onPress={() => signOut().then(() => router.replace('/'))} />
    </Page>
  );
}

function EmailCode({ customer, onDone }: { customer: Customer; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const verify = useMutation({ mutationFn: () => api<Customer>('/v1/store/account/email/verify', { body: { code: code.trim() } }), onSuccess: onDone });
  const resend = useMutation({ mutationFn: () => api('/v1/store/account/email/resend', { body: {} }) });
  return (
    <>
      <ThemedText type="subtitle" accessibilityRole="header">
        Confirm your email
      </ThemedText>
      <ThemedText>{`Enter the 6-digit code we emailed to ${customer.email}.`}</ThemedText>
      <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
      <FormError error={verify.error ?? resend.error} />
      <Button title="Confirm" disabled={code.trim().length !== 6} loading={verify.isPending} onPress={() => verify.mutate()} />
      <Button tone="ghost" title={resend.isSuccess ? 'Sent again' : 'Send the code again'} loading={resend.isPending} onPress={() => resend.mutate()} />
    </>
  );
}

function AboutYou({ customer, onDone }: { customer: Customer; onDone: () => Promise<void> }) {
  const [first, setFirst] = useState(customer.first_name ?? '');
  const [last, setLast] = useState(customer.last_name ?? '');
  const [country, setCountry] = useState<string | null>(null);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const save = useMutation({
    mutationFn: async () => {
      await api<Customer>('/v1/store/account/profile', { body: { first_name: first.trim(), last_name: last.trim(), country } });
      // Kept as typed, to confirm later: sending it again is safe while it is unconfirmed.
      await api<Customer>('/v1/store/account/phone/later', { body: { phone: phone.trim() } });
    },
    onSuccess: onDone,
  });
  return (
    <>
      <ThemedText type="subtitle" accessibilityRole="header">
        About you
      </ThemedText>
      <ThemedText themeColor="textSecondary">Your name as on your ID, your country and your mobile.</ThemedText>
      <Field label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" error={fieldError(save.error, 'first_name')} />
      <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" error={fieldError(save.error, 'last_name')} />
      <CountryPicker value={country} onChange={setCountry} error={fieldError(save.error, 'country')} />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" error={fieldError(save.error, 'phone')} hint="You can confirm it later." />
      <FormError error={save.error} />
      <Button title="Continue" disabled={!first.trim() || !last.trim() || !country || !phone.trim()} loading={save.isPending} onPress={() => save.mutate()} />
    </>
  );
}

function Mobile({ customer, onDone }: { customer: Customer; onDone: () => Promise<void> }) {
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({ mutationFn: () => api('/v1/store/account/phone', { body: { phone: phone.trim() } }), onSuccess: () => setSent(true) });
  const verify = useMutation({ mutationFn: () => api<Customer>('/v1/store/account/phone/verify', { body: { code: code.trim() } }), onSuccess: onDone });
  const later = useMutation({ mutationFn: () => api<Customer>('/v1/store/account/phone/later', { body: { phone: phone.trim() } }), onSuccess: onDone });
  return (
    <>
      <ThemedText type="subtitle" accessibilityRole="header">
        Your mobile
      </ThemedText>
      <ThemedText themeColor="textSecondary">We text a code to confirm it. You can do it later: calls and some purchases ask for it.</ThemedText>
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" error={fieldError(send.error, 'phone')} />
      {sent ? <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" /> : null}
      <FormError error={verify.error ?? later.error ?? (fieldError(send.error, 'phone') ? null : send.error)} />
      {sent ? <Button title="Confirm" disabled={code.trim().length !== 6} loading={verify.isPending} onPress={() => verify.mutate()} /> : <Button title="Text me a code" disabled={!phone.trim()} loading={send.isPending} onPress={() => send.mutate()} />}
      <Button tone="secondary" title="Confirm it later" loading={later.isPending} onPress={() => later.mutate()} />
    </>
  );
}
