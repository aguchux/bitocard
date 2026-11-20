import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, Card, Field, Line, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { Checkout, Dispute } from '@/lib/types';

/** Report a problem with one order: what went wrong, in the customer's words. BitoCard answers on the report. */
export default function NewDispute() {
  const queries = useQueryClient();
  const { checkout } = useLocalSearchParams<{ checkout?: string }>();
  const order = useQuery({ queryKey: ['orders', checkout], enabled: Boolean(checkout), queryFn: () => api<Checkout>(`/v1/store/checkouts/${checkout}`) });
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const open = useMutation({
    mutationFn: () => api<Dispute>('/v1/store/account/disputes', { body: { checkout_id: checkout, subject: subject.trim(), message: message.trim() } }),
    onSuccess: dispute => {
      void queries.invalidateQueries({ queryKey: ['disputes'] });
      router.replace({ pathname: '/disputes/[id]', params: { id: dispute.id } });
    },
  });
  if (!checkout) {
    return (
      <Page>
        <Notice>Open the order with the problem, then choose Report a problem.</Notice>
        <Button label="Your orders" onPress={() => router.replace('/orders')} />
      </Page>
    );
  }
  return (
    <Page>
      {order.data ? (
        <Card>
          <Line label="Order" value={order.data.product.name} />
          <Line label="Paid" value={formatMoney(order.data.amount, order.data.currency)} />
          <Line label="On" value={new Date(order.data.created_at).toLocaleDateString()} />
        </Card>
      ) : null}
      <Field label="What went wrong" value={subject} onChangeText={setSubject} maxLength={200} placeholder="The code did not work" />
      <Field label="Tell us more" value={message} onChangeText={setMessage} multiline maxLength={5000} hint="What happened, and what you tried. Never send your codes, PIN or password." />
      {open.isError ? <Notice tone="bad">{open.error instanceof ApiError ? open.error.message : 'Your report was not sent. Try again.'}</Notice> : null}
      <Button label="Send report" onPress={() => open.mutate()} busy={open.isPending} disabled={subject.trim().length < 3 || message.trim().length < 3} />
      <T kind="small" muted>
        For a question rather than a problem, use Ask us about this order instead.
      </T>
    </Page>
  );
}
