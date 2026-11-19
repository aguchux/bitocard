import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { SupportChatCurrent, SupportTicket } from '@/lib/types';

const ticketWords: Record<SupportTicket['status'], { label: string; tone: 'warn' | 'good' | 'bad' }> = {
  open: { label: 'With BitoCard', tone: 'warn' },
  pending: { label: 'Waiting for you', tone: 'bad' },
  resolved: { label: 'Resolved', tone: 'good' },
};

/** Help: chat with BitoCard (its assistant, then a person), and questions to BitoCard with whose turn it is. */
export default function HelpScreen() {
  const theme = useTheme();
  const chat = useQuery({ queryKey: ['support-chat'], queryFn: () => api<SupportChatCurrent>('/v1/store/support/chat') });
  const tickets = useQuery({ queryKey: ['support-tickets'], queryFn: () => api<{ object: 'list'; data: SupportTicket[]; has_more: boolean }>('/v1/store/support/tickets') });
  const open = chat.data?.chat && chat.data.chat.status !== 'closed';

  return (
    <Page>
      <Card>
        <T kind="heading">Chat with us</T>
        <T muted>{open ? 'Your chat is open.' : chat.data?.assistant ? `${chat.data.assistant.name}, our AI assistant, answers first. Ask for a person any time.` : 'Our team answers here.'}</T>
        <Button label={open ? 'Continue the chat' : 'Start a chat'} onPress={() => router.push('/help/chat')} />
      </Card>

      <View style={styles.row}>
        <T kind="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Your questions
        </T>
        <Pressable accessibilityRole="button" onPress={() => router.push('/help/new')} hitSlop={8}>
          <T kind="label" color={theme.pinkText}>
            Ask a question
          </T>
        </Pressable>
      </View>
      {tickets.isError ? <Notice tone="bad">{tickets.error instanceof ApiError ? tickets.error.message : 'Your questions could not be read.'}</Notice> : null}
      {tickets.data?.data.length === 0 ? <T muted>No questions yet.</T> : null}
      {tickets.data?.data.map(ticket => {
        const words = ticketWords[ticket.status];
        return (
          <Pressable key={ticket.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/help/ticket/[id]', params: { id: ticket.id } })}>
            <Card>
              <View style={styles.row}>
                <T kind="label" style={{ flex: 1 }}>
                  {ticket.subject}
                </T>
                <T kind="small" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[words.tone]}>
                  {words.label}
                </T>
              </View>
              <T kind="small" muted>
                {ticket.reference} · {new Date(ticket.updated_at).toLocaleDateString()}
              </T>
            </Card>
          </Pressable>
        );
      })}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
