import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button, Field, FormError, Sheet } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

/**
 * Message the seller about a listing: the first message of a new chat (`POST /v1/classifieds/conversations`), then the
 * chat itself. Used by the listing's bar and the seller's page; the caller keeps the words, so a draft can be put in.
 */
export function MessageSheet({ listingId, visible, onClose, body, setBody }: { listingId: string; visible: boolean; onClose: () => void; body: string; setBody: (body: string) => void }) {
  const queries = useQueryClient();
  const start = useMutation({
    mutationFn: () => api<{ id: string }>('/v1/classifieds/conversations', { body: { listing_id: listingId, body: body.trim() } }),
    onSuccess: chat => {
      onClose();
      queries.invalidateQueries({ queryKey: ['viewer', listingId] });
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    },
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Message the seller">
      <FormError error={start.error} />
      <Field label="Your message" value={body} onChangeText={setBody} multiline maxLength={1000} style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.two }} />
      <ThemedText type="caption">Keep chats on Udozo. Never share codes or pay before you see the item.</ThemedText>
      <Button title="Send" loading={start.isPending} disabled={!body.trim()} onPress={() => start.mutate()} />
    </Sheet>
  );
}
