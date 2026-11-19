import { StyleSheet, View } from 'react-native';

import { T, useTheme } from '@/components/ui';
import type { ChatMessage } from '@/lib/types';

type Message = Pick<ChatMessage, 'id' | 'author' | 'author_name' | 'body' | 'created_at'> & { attachments?: ChatMessage['attachments'] };

/** A conversation: the customer's own words on the right, BitoCard's (a person by name, or the assistant) on the left. */
export function Thread({ messages, assistant }: { messages: Message[]; assistant?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {messages.map(message => {
        if (message.author === 'system') {
          return (
            <T key={message.id} kind="small" muted style={{ textAlign: 'center' }}>
              {message.body}
            </T>
          );
        }
        const mine = message.author === 'customer';
        const who = mine ? 'You' : message.author === 'bot' ? `${message.author_name ?? assistant ?? 'Assistant'} · AI assistant` : (message.author_name ?? 'BitoCard');
        return (
          <View key={message.id} style={[styles.bubble, mine ? { alignSelf: 'flex-end', backgroundColor: theme.navy } : { alignSelf: 'flex-start', backgroundColor: theme.card, borderColor: theme.line, borderWidth: 1 }]}>
            <T kind="small" color={mine ? '#c9cde4' : theme.textSecondary}>
              {who}
            </T>
            {message.body ? <T color={mine ? '#ffffff' : theme.text}>{message.body}</T> : null}
            {message.attachments?.length ? (
              <T kind="small" color={mine ? '#c9cde4' : theme.textSecondary}>
                {message.attachments.map(file => file.name).join(', ')} (open it on bitocard.com)
              </T>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
});
