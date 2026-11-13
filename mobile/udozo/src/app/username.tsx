import { usernamePattern, type UsernameAvailability, type UsernameStatus } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useDialog, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Failed, Field, FormError, Loading, Page, fieldError } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

const reasons: Record<NonNullable<UsernameAvailability['reason']>, string> = {
  taken: 'Someone else has it.',
  reserved: 'That one is kept by Udozo.',
  refused: 'That one is not allowed.',
  invalid: 'Use 3 to 24 lower-case letters, digits and underscores, starting with a letter.',
  own: 'It is already yours.',
};

/**
 * Choosing a username (udozo.com's Profile > Username): open once the seller has posted the market's minimum of ads;
 * availability checked as they type, with free ones suggested; changed at most once every 30 days.
 */
export default function UsernameScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const ask = useDialog();
  const toast = useToast();
  const status = useQuery({ queryKey: ['username'], queryFn: () => api<UsernameStatus>('/v1/store/account/username') });
  const [now] = useState(() => Date.now());
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState('');
  const wanted = typed.trim().toLowerCase();

  // Asked about a moment after typing stops, and only for something that could be a username.
  useEffect(() => {
    const timer = setTimeout(() => setChecked(usernamePattern.test(wanted) ? wanted : ''), 450);
    return () => clearTimeout(timer);
  }, [wanted]);
  const availability = useQuery({
    queryKey: ['username', 'availability', checked],
    enabled: Boolean(checked),
    queryFn: () => api<UsernameAvailability>(`/v1/store/account/username/availability?username=${encodeURIComponent(checked)}`),
  });
  const save = useMutation({
    mutationFn: (username: string) => api<UsernameStatus>('/v1/store/account/username', { method: 'PUT', body: { username } }),
    onSuccess: saved => {
      queries.setQueryData(['username'], saved);
      queries.invalidateQueries({ queryKey: ['account'] });
      // Back to where they came from, with the toast (drawn at the root) still showing there.
      toast({ message: `Saved. Your seller page now goes by @${saved.username}.`, tone: 'success' });
      router.back();
    },
  });

  if (status.isPending) return <Loading />;
  if (status.isError) return <Failed error={status.error} retry={() => void status.refetch()} />;
  const data = status.data;
  if (!data.eligible) {
    return (
      <Page edges={[]}>
        <Card style={{ backgroundColor: theme.backgroundElement }}>
          <ThemedText type="smallBold">{`Post ${Math.max(0, data.required - data.posted)} more ads to choose a username`}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {`A username names your seller page. It opens once you have posted ${data.required} ads (you have posted ${data.posted}).`}
          </ThemedText>
        </Card>
      </Page>
    );
  }
  const locked = data.change_after && Date.parse(data.change_after) > now;
  const answer = availability.data && availability.data.username === wanted ? availability.data : null;
  const typedProblem = wanted && !usernamePattern.test(wanted) ? reasons.invalid : null;
  const submit = () => {
    if (data.username) {
      void ask({
        title: 'Change your username?',
        body: 'Your old address keeps working for 90 days, then anyone may take it. You can change it again in 30 days.',
        actions: [{ key: 'change', label: 'Change it' }],
      }).then(answer => answer === 'change' && save.mutate(wanted));
    } else save.mutate(wanted);
  };
  return (
    <Page edges={[]}>
      {data.username ? <ThemedText>{`Your username is @${data.username}.`}</ThemedText> : <ThemedText>Choose the name your seller page goes by.</ThemedText>}
      {locked ? (
        <ThemedText type="small" themeColor="textSecondary">{`You can change it again on ${new Date(data.change_after!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`}</ThemedText>
      ) : (
        <>
          <Field
            label="Username"
            value={typed}
            onChangeText={text => setTyped(text.replace(/\s/g, ''))}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            placeholder="such as ada_gadgets"
            error={typedProblem ?? fieldError(save.error, 'username')}
            hint={answer ? (answer.available ? `@${answer.username} is free.` : reasons[answer.reason ?? 'taken']) : 'Lower-case letters, digits and underscores.'}
          />
          {answer && !answer.available && answer.suggestions.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              {answer.suggestions.map(item => (
                <Chip key={item} label={`@${item}`} onPress={() => setTyped(item)} />
              ))}
            </View>
          ) : null}
          <FormError error={save.error && !fieldError(save.error, 'username') ? save.error : null} />
          <Button title={data.username ? 'Change my username' : 'Save username'} loading={save.isPending} disabled={!answer?.available} onPress={submit} />
        </>
      )}
    </Page>
  );
}
