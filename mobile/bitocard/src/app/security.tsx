import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Card, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';

/**
 * Security: change the password (the current one first; every other device is signed out), or sign out here. An
 * account with no password yet (made another way) sets one with Forgot password.
 */
export default function SecurityScreen() {
  const { signOut } = useAccount();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
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
