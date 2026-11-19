import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket, TicketCategory } from '@/lib/types';

const categories: { key: TicketCategory; label: string }[] = [
  { key: 'order', label: 'An order' },
  { key: 'payment', label: 'A payment' },
  { key: 'account', label: 'My account' },
  { key: 'product', label: 'A product' },
  { key: 'technical', label: 'The app' },
  { key: 'other', label: 'Something else' },
];

/** A question to BitoCard: what it is about, a title and the message (an order's page fills in which order). */
export default function NewTicket() {
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ checkout?: string }>();
  const [category, setCategory] = useState<TicketCategory>(params.checkout ? 'order' : 'other');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const open = useMutation({
    mutationFn: () => api<SupportTicket>('/v1/store/support/tickets', { body: { category, subject: subject.trim(), message: message.trim(), ...(params.checkout ? { checkout_id: params.checkout } : {}) } }),
    onSuccess: ticket => {
      void queries.invalidateQueries({ queryKey: ['support-tickets'] });
      router.replace({ pathname: '/help/ticket/[id]', params: { id: ticket.id } });
    },
  });
  return (
    <Page>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="What it is about">
        <T kind="label">What it is about</T>
        <View style={styles.wrap}>
          {categories.map(item => (
            <Chip key={item.key} label={item.label} selected={item.key === category} onPress={() => setCategory(item.key)} />
          ))}
        </View>
      </View>
      <Field label="Title" value={subject} onChangeText={setSubject} maxLength={200} />
      <Field label="Your question" value={message} onChangeText={setMessage} multiline maxLength={5000} hint="Never send your card codes, PIN or password." />
      {open.isError ? <Notice tone="bad">{open.error instanceof ApiError ? open.error.message : 'Your question was not sent.'}</Notice> : null}
      <Button label="Send" onPress={() => open.mutate()} busy={open.isPending} disabled={subject.trim().length < 3 || message.trim().length < 3} />
    </Page>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
