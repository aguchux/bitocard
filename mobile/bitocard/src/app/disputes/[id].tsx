import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Thread } from '@/components/thread';
import { Button, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { disputeOpen, disputeStatus } from '@/lib/disputes';
import type { Dispute } from '@/lib/types';

/** One reported problem: where it stands, the conversation, and a reply while it is being looked at. */
export default function DisputeScreen() {
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dispute = useQuery({ queryKey: ['disputes', id], queryFn: () => api<Dispute>(`/v1/store/account/disputes/${id}`) });
  const [text, setText] = useState('');
  const reply = useMutation({
    mutationFn: () => api<Dispute>(`/v1/store/account/disputes/${id}/messages`, { body: { body: text.trim() } }),
    onSuccess: next => {
      queries.setQueryData(['disputes', id], next);
      void queries.invalidateQueries({ queryKey: ['disputes'], exact: true });
      setText('');
    },
  });
  const data = dispute.data;
  if (!data) return <Page>{dispute.isError ? <Notice tone="bad">{dispute.error instanceof ApiError ? dispute.error.message : 'This report could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  const status = disputeStatus(data);
  const open = disputeOpen(data);
  // The customer sees who answered by role, never staff names.
  const messages = (data.messages ?? []).map(message => ({ ...message, author_name: message.author === 'customer' ? null : 'BitoCard' }));
  return (
    <Page>
      <Stack.Screen options={{ title: data.reference }} />
      <T kind="heading">{data.subject}</T>
      <Notice tone={status.tone === 'good' ? 'good' : 'warn'}>{status.label}</Notice>
      <Thread messages={messages} />
      {open ? (
        <>
          <Field label="Add to your report" value={text} onChangeText={setText} multiline maxLength={5000} />
          {reply.isError ? <Notice tone="bad">{reply.error instanceof ApiError ? reply.error.message : 'Your message was not sent.'}</Notice> : null}
          <Button label="Send" onPress={() => reply.mutate()} busy={reply.isPending} disabled={!text.trim()} />
        </>
      ) : (
        <T kind="small" muted>
          This report is closed. Still a problem? Ask us from Help.
        </T>
      )}
      {data.checkout_id ? <Button kind="secondary" label="Open the order" onPress={() => router.push({ pathname: '/order/[id]', params: { id: data.checkout_id! } })} /> : null}
    </Page>
  );
}
