import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Thread } from '@/components/thread';
import { Button, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket } from '@/lib/types';

/** One question: the conversation, a reply (which reopens it if resolved), and Close when it is answered. */
export default function TicketScreen() {
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticket = useQuery({ queryKey: ['support-tickets', id], queryFn: () => api<SupportTicket>(`/v1/store/support/tickets/${id}`) });
  const [text, setText] = useState('');
  const saved = (next: SupportTicket) => {
    queries.setQueryData(['support-tickets', id], next);
    void queries.invalidateQueries({ queryKey: ['support-tickets'], exact: true });
  };
  const reply = useMutation({
    mutationFn: () => api<SupportTicket>(`/v1/store/support/tickets/${id}/messages`, { body: { body: text.trim() } }),
    onSuccess: next => {
      saved(next);
      setText('');
    },
  });
  const close = useMutation({ mutationFn: () => api<SupportTicket>(`/v1/store/support/tickets/${id}/close`, { body: {} }), onSuccess: saved });

  const data = ticket.data;
  if (!data) return <Page>{ticket.isError ? <Notice tone="bad">{ticket.error instanceof ApiError ? ticket.error.message : 'This question could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  return (
    <Page>
      <Stack.Screen options={{ title: data.reference }} />
      <T kind="heading">{data.subject}</T>
      <T kind="small" muted>
        {data.status === 'open' ? 'With BitoCard: we will answer here.' : data.status === 'pending' ? 'BitoCard answered: your turn.' : 'Resolved. Reply to open it again.'}
      </T>
      <Thread messages={data.messages ?? []} />
      <Field label="Reply" value={text} onChangeText={setText} multiline maxLength={5000} />
      {reply.isError ? <Notice tone="bad">{reply.error instanceof ApiError ? reply.error.message : 'Your reply was not sent.'}</Notice> : null}
      <Button label="Send reply" onPress={() => reply.mutate()} busy={reply.isPending} disabled={text.trim().length < 1} />
      {data.status !== 'resolved' ? <Button kind="secondary" label="Close, it is answered" onPress={() => close.mutate()} busy={close.isPending} /> : null}
    </Page>
  );
}
