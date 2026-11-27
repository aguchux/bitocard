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
  const [pinPassword, setPinPassword] = useState('');
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
    mutationFn: () => api('/v1/store/account/transaction-pin', { body: { current_password: pinPassword, pin } }),
    onSuccess: async () => {
      await rememberTransactionPin(pin).catch(() => undefined);
      setPinPassword('');
      setPinValue('');
      setPinAgain('');
      await refresh();
    },
  });
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
        <T muted>This six-digit PIN protects payments, wallet movements and other financial transactions. Face ID, fingerprint or your device passcode can unlock it on this phone.</T>
        <Field label="Current account password" value={pinPassword} onChangeText={setPinPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
        <Field label="New transaction PIN" value={pin} onChangeText={value => setPinValue(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" maxLength={6} />
        <Field label="New transaction PIN again" value={pinAgain} onChangeText={value => setPinAgain(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" maxLength={6} error={pinMismatch ? 'The two PINs are not the same.' : null} />
        {savePin.isSuccess ? <Notice tone="good">Transaction PIN saved. Your other signed-in devices were locked out.</Notice> : null}
        {savePin.isError ? <Notice tone="bad">{savePin.error instanceof ApiError ? savePin.error.message : 'PIN not saved. Try again.'}</Notice> : null}
        <Button label={customer?.transaction_pin_set ? 'Change transaction PIN' : 'Set transaction PIN'} busy={savePin.isPending} disabled={!pinPassword || pin.length !== 6 || pin !== pinAgain} onPress={() => savePin.mutate()} />
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
