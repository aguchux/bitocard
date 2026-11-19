import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Thread } from '@/components/thread';
import { Button, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { ChatSince, SupportChat, SupportChatCurrent } from '@/lib/types';

const statusWords: Record<SupportChat['status'], string> = {
  bot: 'Our AI assistant is answering. Ask for a person any time.',
  waiting: 'A person will reply here.',
  with_staff: 'Our team is answering.',
  closed: 'This chat has ended.',
};

/**
 * The customer's chat with BitoCard: asked again every 3 seconds while open (new messages since the last one seen),
 * writing starts one when none is open, Talk to a person stops the assistant, and End chat closes it.
 */
export default function ChatScreen() {
  const queries = useQueryClient();
  const current = useQuery({ queryKey: ['support-chat'], queryFn: () => api<SupportChatCurrent>('/v1/store/support/chat') });
  const chat = current.data?.chat && current.data.chat.status !== 'closed' ? current.data.chat : null;
  const lastId = chat?.messages.at(-1)?.id;

  // New messages since the last one shown, merged into the cached chat.
  useQuery({
    queryKey: ['support-chat-since', chat?.id, lastId],
    enabled: Boolean(chat),
    refetchInterval: 3_000,
    queryFn: async () => {
      const since = await api<ChatSince>(`/v1/store/support/chat/${chat!.id}/messages${lastId ? `?after=${lastId}` : ''}`);
      if (since.data.length || since.status !== chat!.status) {
        queries.setQueryData<SupportChatCurrent>(['support-chat'], before =>
          before?.chat ? { ...before, chat: { ...before.chat, status: since.status, messages: [...before.chat.messages, ...since.data.filter(item => !before.chat!.messages.some(seen => seen.id === item.id))] } } : before,
        );
      }
      return since;
    },
  });

  const [text, setText] = useState('');
  const keep = (next: SupportChat) => queries.setQueryData<SupportChatCurrent>(['support-chat'], before => ({ object: 'support_chat_current', assistant: before?.assistant ?? null, chat: next }));
  const send = useMutation({
    mutationFn: () => api<SupportChat>('/v1/store/support/chat/messages', { body: { body: text.trim() } }),
    onSuccess: next => {
      keep(next);
      setText('');
    },
  });
  const step = useMutation({ mutationFn: (what: 'human' | 'close') => api<SupportChat>(`/v1/store/support/chat/${chat!.id}/${what}`, { body: {} }), onSuccess: keep });

  if (current.isPending) return <Page><T muted>Loading…</T></Page>;
  const assistant = current.data?.assistant;
  return (
    <Page>
      {current.isError ? <Notice tone="bad">{current.error instanceof ApiError ? current.error.message : 'The chat could not be read.'}</Notice> : null}
      {chat ? <T kind="small" muted accessibilityLiveRegion="polite">{statusWords[chat.status]}</T> : assistant?.greeting ? <T muted>{assistant.greeting}</T> : <T muted>Tell us what you need and our team will answer here.</T>}
      {chat ? <Thread messages={chat.messages} assistant={assistant?.name} /> : null}
      <Field label="Message" value={text} onChangeText={setText} multiline maxLength={2000} hint="Never send your card codes, PIN or password." />
      {send.isError ? <Notice tone="bad">{send.error instanceof ApiError ? send.error.message : 'Your message was not sent.'}</Notice> : null}
      <Button label="Send" onPress={() => send.mutate()} busy={send.isPending} disabled={!text.trim()} />
      {chat?.status === 'bot' ? <Button kind="secondary" label="Talk to a person" onPress={() => step.mutate('human')} busy={step.isPending} /> : null}
      {chat ? <Button kind="secondary" label="End chat" onPress={() => step.mutate('close')} /> : null}
    </Page>
  );
}
