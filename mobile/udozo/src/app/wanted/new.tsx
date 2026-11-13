import { regionWord, type ShopState, type ShopTopCategory } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { ListingCard } from '@/components/listing-card';
import { CategoryPicker, PickerRow, PlacePicker } from '@/components/pickers';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Field, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWantedOpen } from '@/hooks/use-wanted';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { emptyWanted, wantedBody, wantedConditionChoices, wantedRefusal, wantedToldText, type WantedCreated, type WantedForm, type WantedProblem } from '@/lib/wanted';

/**
 * Post a request (udozo.com's /<cc>/wanted/new): a signed-in buyer says what they need, its category, where (anywhere,
 * a state or an area of it), the most they would pay and the condition; Udozo tells sellers who sell it and shows what
 * may already fit. Only in their own market, while requests are open there.
 */
export default function NewWantedScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer, pending } = useAccount();
  const country = customer?.country ?? null;
  const open = useWantedOpen(country);
  const tree = useQuery({ queryKey: ['categories', country], enabled: Boolean(country), staleTime: 10 * 60_000, queryFn: () => api<{ data: ShopTopCategory[] }>(`/v1/classifieds/categories?country=${country}`) });
  const places = useQuery({ queryKey: ['areas', country], enabled: Boolean(country), staleTime: 10 * 60_000, queryFn: () => api<{ data: ShopState[] }>(`/v1/classifieds/areas?country=${country}`) });
  const categories = useMemo(() => (tree.data?.data ?? []).filter(top => !top.shop_only), [tree.data]);
  const [form, setForm] = useState<WantedForm>(emptyWanted);
  const [picker, setPicker] = useState<'category' | 'place' | null>(null);
  const [problem, setProblem] = useState<WantedProblem | null>(null);
  const post = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<WantedCreated>('/v1/classifieds/wanted', { body }),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['wanted'] }),
    onError: error => {
      if (error instanceof ApiError) setProblem({ message: wantedRefusal(error.code, error.message), param: error.param ?? '' });
      else setProblem({ message: 'Your request could not be posted. Check your connection and try again.', param: '' });
    },
  });

  if (customer === undefined) return <AccountPending />;
  if (customer === null) {
    return (
      <Page edges={[]}>
        <SignedOut title="Post a request" body="Sign in to tell sellers what you need. Those who have it answer in your chats." />
      </Page>
    );
  }
  if (pending) {
    return (
      <Page edges={[]}>
        <ThemedText themeColor="textSecondary">Finish your account first, then you can post a request.</ThemedText>
        <Button title="Finish my account" onPress={() => router.push('/verify')} />
      </Page>
    );
  }
  if (!open) {
    return (
      <Page edges={[]}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Post a request
        </ThemedText>
        <ThemedText themeColor="textSecondary">Requests are not open in your country yet.</ThemedText>
      </Page>
    );
  }

  const created = post.data;
  if (created) {
    return (
      <Page edges={[]}>
        <Card style={{ backgroundColor: theme.backgroundElement }}>
          <CheckCircle2 size={28} color={theme.success} />
          <ThemedText type="heading" accessibilityRole="header">{`Request ${created.number} is up for 14 days`}</ThemedText>
          <ThemedText themeColor="textSecondary">{wantedToldText(created.sellers_told)}</ThemedText>
        </Card>
        {created.matches.length ? (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="heading" accessibilityRole="header">
              Already on Udozo, and may fit
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {created.matches.map(card => (
                <ListingCard key={card.id} listing={card} width={160} />
              ))}
            </ScrollView>
          </View>
        ) : null}
        <Button title="See your request" onPress={() => router.replace({ pathname: '/wanted/[id]', params: { id: created.id } })} />
        <Button tone="secondary" title="My wanted requests" onPress={() => router.replace('/wanted')} />
      </Page>
    );
  }

  const change = (patch: Partial<WantedForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setProblem(null);
  };
  const submit = () => {
    const built = wantedBody(form);
    if ('problem' in built) return setProblem(built.problem);
    setProblem(null);
    post.mutate(built.body);
  };
  const on = (param: string) => (problem?.param === param ? problem.message : null);
  let categoryName: string | null = null;
  for (const top of categories) for (const child of top.children) if (child.id === form.categoryId) categoryName = child.name;
  const state = places.data?.data.find(item => item.id === form.stateId) ?? null;
  const area = state?.areas.find(item => item.id === form.areaId) ?? null;
  const place = area && state ? `${area.name}, ${state.name}` : state ? `Anywhere in ${state.name}` : null;
  const general = problem && !['words', 'category_id', 'budget_max', 'area_id', 'state_id', 'details'].includes(problem.param) ? problem.message : null;

  return (
    <Page edges={[]}>
      <ThemedText themeColor="textSecondary">Can&apos;t find it? Tell sellers what you need, and those who have it answer in your chats.</ThemedText>
      <Field label="What are you looking for?" value={form.words} onChangeText={words => change({ words })} placeholder="For example: Toyota Corolla 2012, iPhone 13 Pro" maxLength={80} error={on('words')} />
      <PickerRow label="Category" value={categoryName} placeholder={tree.isPending ? 'Loading categories…' : 'Choose a category'} onPress={() => setPicker('category')} error={on('category_id')} />
      <PickerRow label={`Where (${country ? regionWord(country) : 'state'})`} value={place} placeholder="Anywhere" onPress={() => setPicker('place')} error={on('area_id') ?? on('state_id')} />
      {place ? <Button tone="ghost" title="Anywhere instead" onPress={() => change({ stateId: null, areaId: null })} /> : null}
      <Field
        label={customer.currency ? `Most you would pay (${customer.currency}, optional)` : 'Most you would pay (optional)'}
        value={form.budget}
        onChangeText={budget => change({ budget })}
        keyboardType="decimal-pad"
        placeholder="450,000"
        error={on('budget_max')}
      />
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">Condition</ThemedText>
        <View style={styles.chips}>
          {wantedConditionChoices.map(choice => (
            <Chip key={choice.value} label={choice.label} selected={form.condition === choice.value} onPress={() => change({ condition: choice.value })} />
          ))}
        </View>
      </View>
      <Field label="Anything else sellers should know (optional)" value={form.details} onChangeText={details => change({ details })} placeholder="Colour, size, when you need it…" multiline maxLength={300} error={on('details')} />
      {general ? (
        <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.danger }}>
          {general}
        </ThemedText>
      ) : null}
      <ThemedText type="caption">Sellers see what you wrote and your first name and initial, never your number. They answer with a listing, in your chats.</ThemedText>
      <Button title="Post request" loading={post.isPending} onPress={submit} />

      <CategoryPicker visible={picker === 'category'} onClose={() => setPicker(null)} categories={categories} selected={form.categoryId} onChoose={categoryId => change({ categoryId })} />
      {country && places.data ? (
        <PlacePicker
          visible={picker === 'place'}
          onClose={() => setPicker(null)}
          country={country}
          states={places.data.data}
          stateId={form.stateId}
          areaId={form.areaId}
          onChoose={(chosenState, chosenArea) => change({ stateId: chosenState.id, areaId: chosenArea.id })}
          onChooseState={chosenState => change({ stateId: chosenState.id, areaId: null })}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  rail: { gap: Spacing.two, paddingRight: Spacing.three },
});
