import { useMutation, useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { Codes } from '@/components/codes';
import { Button, Card, Line, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { inProgress, recipientOf, statusOf, stepsOf } from '@/lib/orders';
import type { CheckoutWithCodes } from '@/lib/types';

/** One order: its status and timeline (asked again every 4 seconds while it moves), what was paid and for what. */
export default function OrderScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useQuery({
    queryKey: ['orders', id],
    queryFn: () => api<CheckoutWithCodes>(`/v1/store/checkouts/${id}`),
    refetchInterval: query => (query.state.data && inProgress(query.state.data.status) ? 4000 : false),
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'succeeded' | 'failed') => api<CheckoutWithCodes>(`/v1/store/checkouts/${id}/simulate`, { body: { outcome } }),
    onSuccess: () => void order.refetch(),
  });

  if (order.isPending) {
    return (
      <Page>
        <T muted>Loading…</T>
      </Page>
    );
  }
  if (order.isError) {
    return (
      <Page>
        <Notice tone="bad">{order.error instanceof ApiError ? order.error.message : 'This order could not be read. Check your connection.'}</Notice>
        <Button kind="secondary" label="Try again" onPress={() => void order.refetch()} />
      </Page>
    );
  }
  const checkout = order.data;
  const status = statusOf(checkout.status);
  const tone = { good: [theme.goodSoft, theme.good], warn: [theme.warnSoft, theme.warn], bad: [theme.badSoft, theme.bad], neutral: [theme.line, theme.text] }[status.tone];
  const recipient = recipientOf(checkout);

  return (
    <Page>
      <Stack.Screen options={{ title: checkout.order?.receipt_number ?? 'Order' }} />
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <T kind="heading">{checkout.product.name}</T>
          {recipient ? <T muted>To {recipient}</T> : null}
        </View>
        <T kind="heading">{formatMoney(checkout.amount, checkout.currency)}</T>
      </View>
      <View style={[styles.badge, { backgroundColor: tone[0] }]} accessibilityLiveRegion="polite">
        <T kind="label" color={tone[1]}>
          {status.label}
        </T>
      </View>

      <Card>
        {stepsOf(checkout).map((step, index) => {
          const color = step.state === 'done' ? theme.good : step.state === 'now' ? theme.pink : step.state === 'failed' ? theme.bad : theme.field;
          return (
            <View key={index} style={styles.step}>
              <View style={[styles.dot, step.state === 'todo' ? { borderWidth: 2, borderColor: color } : { backgroundColor: color }]} />
              <T muted={step.state === 'todo'}>{step.label}</T>
            </View>
          );
        })}
      </Card>

      {checkout.status === 'completed' && checkout.order?.deliveries?.length ? <Codes deliveries={checkout.order.deliveries} instructions={checkout.order.redeem_instructions} /> : null}

      <Card>
        <Line label="Paid" value={formatMoney(checkout.amount, checkout.currency)} />
        {checkout.charged ? <Line label="Charged" value={formatMoney(checkout.charged.amount, checkout.charged.currency)} /> : null}
        <Line label="Value" value={`${formatMoney(checkout.face_value, checkout.face_currency)}${checkout.quantity > 1 ? ` × ${checkout.quantity}` : ''}`} />
        <Line label="Paid with" value={checkout.method.id === 'wallet' ? 'Your wallet' : checkout.method.label} />
        {checkout.order?.receipt_number ? <Line label="Receipt" value={checkout.order.receipt_number} /> : null}
        <Line label="Ordered" value={new Date(checkout.created_at).toLocaleString()} />
      </Card>

      {checkout.failure_reason ? <Notice tone="bad">{checkout.failure_reason}</Notice> : null}
      {checkout.status === 'refunded' ? <Notice tone="good">Your money is back where it came from.</Notice> : null}
      {checkout.checkout_url ? <Button label="Open the payment page" onPress={() => void WebBrowser.openBrowserAsync(checkout.checkout_url!).finally(() => void order.refetch())} /> : null}
      <Button kind="secondary" label="Ask us about this order" onPress={() => router.push({ pathname: '/help/new', params: { checkout: checkout.id } })} />
      {checkout.mode === 'test' && inProgress(checkout.status) ? (
        <Card>
          <T kind="small" muted>
            Sandbox order: choose how it ends.
          </T>
          <Button kind="secondary" label="Simulate delivered" onPress={() => simulate.mutate('succeeded')} busy={simulate.isPending} />
          <Button kind="secondary" label="Simulate failed" onPress={() => simulate.mutate('failed')} />
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
