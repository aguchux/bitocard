import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Card, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';

type Check = { can_delete: boolean; password_required: boolean; blockers: { code: string; message: string }[] };

const removes = ['Your name, email address and mobile numbers', 'Your password', 'Every phone and browser you are signed in on, signed out and forgotten'];

/**
 * Deleting the account (the App Store and Google Play ask for it in the app): what goes and what the law keeps, what
 * stands in the way (money still held, trades still open), then DELETE typed and the password. Done, the phone forgets
 * the session.
 */
export default function DeleteAccountScreen() {
  const { signOut } = useAccount();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const check = useQuery({ queryKey: ['deletion'], queryFn: () => api<Check>('/v1/store/account/delete') });
  const remove = useMutation({
    mutationFn: () => api('/v1/store/account/delete', { body: { confirm: typed.trim(), ...(password ? { password } : {}) } }),
    onSuccess: async () => {
      await signOut().catch(() => undefined);
      router.replace('/welcome');
    },
  });
  if (check.isPending) return <Page><T muted>Loading…</T></Page>;
  if (!check.data) return <Page><Notice tone="bad">{check.error instanceof ApiError ? check.error.message : 'This could not be checked. Try again.'}</Notice></Page>;
  const data = check.data;
  return (
    <Page>
      <T>Deleting your account happens at once and cannot be undone. You can sign up again later, as a new account.</T>
      <Card>
        {removes.map(item => (
          <T key={item} kind="small">{`• ${item}`}</T>
        ))}
        <T kind="small" muted>
          What the law makes us keep stays, tied to an account with no details: orders, payments and their accounting.
        </T>
      </Card>
      {data.can_delete ? (
        <>
          {data.password_required ? <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" /> : null}
          <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
          {remove.isError ? <Notice tone="bad">{remove.error instanceof ApiError ? remove.error.message : 'Your account was not deleted. Try again.'}</Notice> : null}
          <Button label="Delete my account" onPress={() => remove.mutate()} busy={remove.isPending} disabled={typed.trim() !== 'DELETE' || (data.password_required && !password)} />
        </>
      ) : (
        <Notice tone="bad">
          {`Not yet:\n${data.blockers.map(item => `• ${item.message}`).join('\n')}`}
        </Notice>
      )}
    </Page>
  );
}
