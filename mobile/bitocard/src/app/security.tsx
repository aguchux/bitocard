import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Card, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { rememberTransactionPin } from '@/lib/transaction-pin';

/**
 * Security: change the password (the current one first; every other device is signed out), or sign out here. An
 * account with no password yet (made another way) sets one with Forgot password.
 */
export default function SecurityScreen() {
  const { customer, refresh, signOut } = useAccount();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [pin, setPinValue] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const change = useMutation({
    mutationFn: () => api('/v1/store/account/password/change', { body: { current_password: current, password } }),
    onSuccess: () => {
      setCurrent('');
      setPassword('');
      setAgain('');
    },
  });
  const mismatch = again.length > 0 && again !== password;
  const notSet = change.error instanceof ApiError && change.error.code === 'password_not_set';
  const savePin = useMutation({
    mutationFn: () => api('/v1/store/account/transaction-pin', { body: { code: pinCode, pin } }),
    onSuccess: async () => {
      await rememberTransactionPin(pin).catch(() => undefined);
      setPinCode('');
      setPinValue('');
      setPinAgain('');
      await refresh();
    },
  });
  const sendPinCode = useMutation({ mutationFn: () => api<{ sent_to: string }>('/v1/store/account/transaction-pin/code', { body: {} }) });
  const pinMismatch = pinAgain.length > 0 && pinAgain !== pin;
  return (
    <Page>
      <Card>
        <T kind="heading">Change your password</T>
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
        <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 10 characters." />
        <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={mismatch ? 'The two passwords are not the same.' : null} />
        {change.isSuccess ? <Notice tone="good">Password changed. Your other devices are signed out.</Notice> : null}
        {change.isError ? <Notice tone="bad">{change.error instanceof ApiError ? change.error.message : 'Not changed. Check your connection and try again.'}</Notice> : null}
        {notSet ? <Button kind="secondary" label="Set a password" onPress={() => router.push('/forgot-password')} /> : null}
        <Button label="Change password" busy={change.isPending} disabled={!current || password.length < 10 || password !== again} onPress={() => change.mutate()} />
      </Card>
      <Card>
        <T kind="heading">{customer?.transaction_pin_set ? 'Change transaction PIN' : 'Set transaction PIN'}</T>
        <T muted>This six-digit PIN protects payments, wallet movements and other financial transactions. An emailed one-time code is required to {customer?.transaction_pin_set ? 'change' : 'create'} it.</T>
        <Button kind="secondary" label={sendPinCode.isSuccess ? 'Send a new email code' : 'Email me a code'} busy={sendPinCode.isPending} onPress={() => sendPinCode.mutate()} />
        {sendPinCode.isSuccess ? <Notice tone="good">Code sent to {sendPinCode.data.sent_to}. It expires in 30 minutes.</Notice> : null}
        {sendPinCode.isError ? <Notice tone="bad">{sendPinCode.error instanceof ApiError ? sendPinCode.error.message : 'Code not sent. Try again.'}</Notice> : null}
        <Field label="Email code" value={pinCode} onChangeText={value => setPinCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
        <Field label="New transaction PIN" value={pin} onChangeText={value => setPinValue(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" maxLength={6} />
        <Field label="New transaction PIN again" value={pinAgain} onChangeText={value => setPinAgain(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" maxLength={6} error={pinMismatch ? 'The two PINs are not the same.' : null} />
        {savePin.isSuccess ? <Notice tone="good">Transaction PIN saved. Your other signed-in devices were locked out.</Notice> : null}
        {savePin.isError ? <Notice tone="bad">{savePin.error instanceof ApiError ? savePin.error.message : 'PIN not saved. Try again.'}</Notice> : null}
        <Button label={customer?.transaction_pin_set ? 'Change transaction PIN' : 'Set transaction PIN'} busy={savePin.isPending} disabled={pinCode.length !== 6 || pin.length !== 6 || pin !== pinAgain} onPress={() => savePin.mutate()} />
      </Card>
      <Button
        kind="secondary"
        label="Sign out on this phone"
        onPress={async () => {
          await signOut();
          router.replace('/welcome');
        }}
      />
    </Page>
  );
}
