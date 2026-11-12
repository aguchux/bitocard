import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Failed, Field, fieldError, FormError, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

type Check = { can_delete: boolean; password_required: boolean; blockers: { code: string; message: string }[] };

const removes = [
  'Your name, email address, mobile number, profile photo, cover and username',
  'Where you live, your date of birth and sex',
  'Your sign-in with Google, Facebook or Apple, and your password',
  'Your listings, taken down',
  'Every phone and browser you are signed in on, signed out and forgotten',
];

/**
 * Deleting the account (the App Store and Google Play ask for it in the app): what goes and what the law keeps, what
 * stands in the way, then DELETE typed (and the password when the account has one). Done, the phone forgets the session.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const { forget } = useAccount();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const check = useQuery({ queryKey: ['deletion'], queryFn: () => api<Check>('/v1/store/account/delete') });
  const remove = useMutation({
    mutationFn: () => api('/v1/store/account/delete', { body: { confirm: typed.trim(), ...(password ? { password } : {}) } }),
    onSuccess: async () => {
      await forget();
      router.replace('/');
    },
  });
  if (check.isPending) return <Loading />;
  if (check.isError) return <Failed error={check.error} retry={() => void check.refetch()} />;
  return (
    <Page edges={['bottom']}>
      <ThemedText>Deleting your account happens at once and cannot be undone. You can sign up again later, as a new account.</ThemedText>
      <Card>
        {removes.map(item => (
          <ThemedText key={item} type="small">{`• ${item}`}</ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          What the law makes us keep stays, tied to an account with no details: orders, payments and their accounting, usually for six years.
        </ThemedText>
      </Card>
      {check.data.can_delete ? (
        <View style={{ gap: Spacing.three }}>
          {check.data.password_required ? <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" error={fieldError(remove.error, 'password')} /> : null}
          <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
          <FormError error={fieldError(remove.error, 'password') ? null : remove.error} />
          <Button tone="danger" title="Delete my account" disabled={typed.trim() !== 'DELETE' || (check.data.password_required && !password)} loading={remove.isPending} onPress={() => remove.mutate()} />
        </View>
      ) : (
        <Card style={{ borderColor: theme.danger }}>
          <ThemedText type="heading">Not yet</ThemedText>
          {check.data.blockers.map(item => (
            <ThemedText key={item.code} type="small">{`• ${item.message}`}</ThemedText>
          ))}
        </Card>
      )}
    </Page>
  );
}
