import { buyOrderLabels, shopMoney, type ShopBuyOrder, type ShopBuyOrderAction } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Failed, Field, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { buyActionLabels, buyOrderBody, buyOrderNext, buyOrderPath, buyQuestion } from '@/lib/buy-orders';
import { toMinor } from '@/lib/listing-form';

/** Steps that end or undo something, shown last and in red. */
const stopping: ShopBuyOrderAction[] = ['decline', 'cancel', 'no_show', 'void'];

/**
 * A buy order (udozo.com's /account/buy-orders/<id>): the listing, its status and what happens next, the price (and a
 * seller's counter), the notes, then each step the API offers the reader, asked first. Payment is between buyer and
 * seller when they meet; the chat opens from here.
 */
export default function BuyOrderScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useQuery({ queryKey: ['buy-order', id], queryFn: () => api<ShopBuyOrder>(`/v1/classifieds/buy-orders/${id}`) });
  const [asking, setAsking] = useState<ShopBuyOrderAction | null>(null);
  const [reason, setReason] = useState('');
  const [price, setPrice] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const step = useMutation({
    mutationFn: (action: ShopBuyOrderAction) => api<ShopBuyOrder>(buyOrderPath(id, action), { body: buyOrderBody(action, { price: toMinor(price), reason }) }),
    onSuccess: saved => {
      queries.setQueryData(['buy-order', id], saved);
      queries.invalidateQueries({ queryKey: ['buy-orders'] });
      queries.invalidateQueries({ queryKey: ['my-listings'] });
      setAsking(null);
      setReason('');
      setPrice('');
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError) return <Failed error={order.error} retry={() => void order.refetch()} />;
  const data = order.data;
  const question = asking ? buyQuestion(asking, data) : null;
  const open = (action: ShopBuyOrderAction) => {
    step.reset();
    setProblem(null);
    setAsking(action);
  };
  const confirm = () => {
    if (!asking || !question) return;
    if (question.price && !toMinor(price)) return setProblem('Give your price as an amount, such as 250,000.');
    if (question.reason?.required && !reason.trim()) return setProblem('Say what happened.');
    setProblem(null);
    step.mutate(asking);
  };
  const actions = [...data.actions.filter(action => !stopping.includes(action)), ...data.actions.filter(action => stopping.includes(action))];
  return (
    <>
      <Stack.Screen options={{ title: data.number }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} tintColor={theme.primary} />}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${data.listing.title ?? 'The listing'}. Open it`} onPress={() => router.push({ pathname: '/listing/[ref]', params: { ref: String(data.listing.ref) } })} style={[styles.listing, { borderColor: theme.line }]}>
          {data.listing.cover_url ? <Image source={{ uri: data.listing.cover_url }} style={styles.cover} /> : <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]} />}
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={2}>
              {data.listing.title ?? 'The listing'}
            </ThemedText>
            <ThemedText type="caption">{`${data.role === 'buyer' ? 'From' : 'To'} ${data.with.name}${data.quantity > 1 ? ` · ${data.quantity} of them` : ''}`}</ThemedText>
          </View>
        </Pressable>

        <View accessibilityLiveRegion="polite" style={{ gap: Spacing.one }}>
          <ThemedText type="heading">{buyOrderLabels[data.role][data.status]}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {buyOrderNext(data)}
          </ThemedText>
          {data.end_reason ? <ThemedText type="caption">{data.end_reason}</ThemedText> : null}
        </View>

        <Card>
          <ThemedText type="smallBold">{`${data.counter !== null ? 'Asked' : 'Price'}: ${shopMoney(data.price, data.currency)}`}</ThemedText>
          {data.counter !== null ? <ThemedText type="smallBold">{`${data.role === 'seller' ? 'Your price' : 'The seller’s price'}: ${shopMoney(data.counter, data.currency)}`}</ThemedText> : null}
          {data.note ? <ThemedText type="small">{`Note: ${data.note}`}</ThemedText> : null}
          {data.meet_note ? <ThemedText type="small">{`Where to meet: ${data.meet_note}`}</ThemedText> : null}
          <ThemedText type="caption">Meet in a busy public place. Inspect it before you pay, pay in person, and never pay in advance.</ThemedText>
        </Card>

        {actions.map(action => (
          <Button key={action} title={buyActionLabels[action]} tone={stopping.includes(action) ? 'ghost' : action === 'accept' || action === 'accept_counter' || action === 'complete' || action === 'confirm' || action === 'bought' ? 'money' : 'secondary'} onPress={() => open(action)} />
        ))}
        {data.conversation_id ? <Button title="Open the chat" tone="secondary" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: data.conversation_id! } })} /> : null}
      </ScrollView>

      <ConfirmSheet
        visible={Boolean(asking)}
        onClose={() => setAsking(null)}
        title={question?.title ?? ''}
        body={question?.body}
        action={question?.action ?? 'Go ahead'}
        tone={question?.tone}
        busy={step.isPending}
        error={step.error}
        onConfirm={confirm}>
        {question?.price ? <Field label={`Your price (${data.currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Such as 250,000" /> : null}
        {question?.reason ? <Field label={question.reason.label} value={reason} onChangeText={setReason} multiline maxLength={300} /> : null}
        {problem ? <ThemedText type="small" style={{ color: theme.danger }}>{problem}</ThemedText> : null}
      </ConfirmSheet>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  listing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two },
  cover: { width: 64, height: 64, borderRadius: Radius.small },
});
