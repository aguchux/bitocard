import type { ShopContactRequest, ShopContactShare } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Failed, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { openLink } from '@/lib/navigate';
import { postedAgo } from '@shared/classifieds';

type Requests = { object: 'list'; pending: number; data: ShopContactRequest[] };
type Answer = 'accept' | 'decline' | 'done' | 'dismiss';

const statusWords: Record<ShopContactRequest['status'], string> = {
  pending: 'Waiting for you',
  accepted: 'You shared your contact',
  declined: 'Declined',
  done: 'You called them',
  dismissed: 'Dismissed',
  cancelled: 'They cancelled',
};

/**
 * Buyers' requests to the seller (udozo.com's /account/requests): contact requests (Share my contact or Decline) and
 * call backs (the buyer's name, confirmed mobile and email while it waits; I called them or Dismiss), then who can see
 * the seller's contact details, with Stop sharing.
 */
export default function RequestsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api<Requests>('/v1/classifieds/me/contact-requests?limit=100') });
  const shares = useQuery({ queryKey: ['contact-shares'], queryFn: () => api<{ data: ShopContactShare[] }>('/v1/classifieds/me/contact-shares') });
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['requests'] });
    queries.invalidateQueries({ queryKey: ['contact-shares'] });
  };
  const answer = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Answer }) => api(`/v1/classifieds/contact-requests/${id}/${action}`, { body: {} }),
    onSuccess: refresh,
    onError: error => Alert.alert('That did not work', (error as Error).message),
  });
  const stop = useMutation({
    mutationFn: (buyer: string) => api(`/v1/classifieds/me/contact-shares/${buyer}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const ask = (request: ShopContactRequest, action: Answer) => {
    const words: Record<Answer, [string, string, string]> = {
      accept: ['Share your contact?', `${request.with.name} sees your phone number and email on all your ads.`, 'Share'],
      decline: ['Decline the request?', 'They can ask again in 7 days.', 'Decline'],
      done: ['Mark it called?', 'It moves to answered.', 'I called them'],
      dismiss: ['Dismiss the call back?', 'They are not told why.', 'Dismiss'],
    };
    const [title, body, button] = words[action];
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: button, style: action === 'decline' || action === 'dismiss' ? 'destructive' : 'default', onPress: () => answer.mutate({ id: request.id, action }) },
    ]);
  };

  if (requests.isPending) return <Loading />;
  if (requests.isError) return <Failed error={requests.error} retry={() => void requests.refetch()} />;
  const waiting = requests.data.data.filter(item => item.status === 'pending');
  const answered = requests.data.data.filter(item => item.status !== 'pending');
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={refresh} tintColor={theme.primary} />}>
      <ThemedText type="heading" accessibilityRole="header">
        {waiting.length ? `${waiting.length} waiting` : 'Nothing waiting'}
      </ThemedText>
      {waiting.length === 0 ? <Empty title="No requests waiting" body="When a buyer asks for your contact or a call back, it shows here." /> : null}
      {waiting.map(request => (
        <Card key={request.id}>
          <ThemedText type="caption">{`${request.kind === 'callback' ? 'Call back' : 'Contact request'} · ${postedAgo(request.created_at)}`}</ThemedText>
          <ThemedText type="smallBold">{request.with.name}</ThemedText>
          <Button
            title={request.listing.title ?? 'Your ad'}
            tone="ghost"
            accessibilityLabel={`About ${request.listing.title ?? 'your ad'}. Open it`}
            onPress={() => openLink(request.listing.path)}
            style={{ alignSelf: 'flex-start' }}
          />
          {request.note ? <ThemedText type="small">{`“${request.note}”`}</ThemedText> : null}
          {request.kind === 'callback' && request.with.phone ? (
            <Button title={`Call ${request.with.phone}`} tone="secondary" onPress={() => Linking.openURL(`tel:${request.with.phone}`)} />
          ) : null}
          <View style={styles.row}>
            {request.kind === 'contact' ? (
              <>
                <Button title="Share my contact" onPress={() => ask(request, 'accept')} style={{ flex: 1 }} />
                <Button title="Decline" tone="secondary" onPress={() => ask(request, 'decline')} style={{ flex: 1 }} />
              </>
            ) : (
              <>
                <Button title="I called them" onPress={() => ask(request, 'done')} style={{ flex: 1 }} />
                <Button title="Dismiss" tone="secondary" onPress={() => ask(request, 'dismiss')} style={{ flex: 1 }} />
              </>
            )}
          </View>
        </Card>
      ))}

      {shares.data?.data.length ? (
        <>
          <ThemedText type="heading" accessibilityRole="header">
            Who can see your contact
          </ThemedText>
          {shares.data.data.map(share => (
            <View key={share.buyer.id} style={[styles.share, { borderColor: theme.line }]}>
              <View style={{ flex: 1 }}>
                <ThemedText>{share.buyer.name}</ThemedText>
                <ThemedText type="caption">{`Since ${new Date(share.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}</ThemedText>
              </View>
              <Button title="Stop sharing" tone="ghost" loading={stop.isPending && stop.variables === share.buyer.id} onPress={() => stop.mutate(share.buyer.id)} />
            </View>
          ))}
        </>
      ) : null}

      {answered.length ? (
        <>
          <ThemedText type="heading" accessibilityRole="header">
            Answered
          </ThemedText>
          {answered.map(request => (
            <View key={request.id} style={[styles.share, { borderColor: theme.line }]}>
              <View style={{ flex: 1 }}>
                <ThemedText>{`${request.with.name} · ${request.kind === 'callback' ? 'call back' : 'contact'}`}</ThemedText>
                <ThemedText type="caption">{`${statusWords[request.status]} · ${request.listing.title ?? 'Your ad'}`}</ThemedText>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', gap: Spacing.two },
  share: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
});
