import { postedAgo } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Failed, FormError, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { openLink } from '@/lib/navigate';
import { registerPush } from '@/lib/push';
import type { Notice, Notices } from '@/lib/types';

/**
 * The customer's notifications, newest first: opening one marks it read and goes where it is about. Above them, while
 * the phone does not allow notifications, a card to turn them on.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const notices = useQuery({ queryKey: ['notices'], queryFn: () => api<Notices>('/v1/store/account/notifications?limit=50') });
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['notices'] });
  };
  const readAll = useMutation({ mutationFn: () => api('/v1/store/account/notifications/read-all', { body: {} }), onSuccess: refresh });
  const open = useMutation({
    mutationFn: (notice: Notice) => (notice.read_at ? Promise.resolve(null) : api(`/v1/store/account/notifications/${notice.id}/read`, { body: {} })),
    onSuccess: (_reply, notice) => {
      refresh();
      if (notice.link) openLink(notice.link);
    },
  });
  return (
    <>
      <Stack.Screen options={{ headerRight: () => (notices.data?.unread_count ? <Button tone="ghost" title="Mark all read" onPress={() => readAll.mutate()} /> : null) }} />
      <FlatList
        data={notices.data?.data ?? []}
        keyExtractor={notice => notice.id}
        contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
        ListHeaderComponent={<PushCard />}
        refreshControl={<RefreshControl refreshing={notices.isRefetching} onRefresh={() => void notices.refetch()} tintColor={theme.primary} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.read_at ? '' : 'Unread. '}${item.title}. ${item.body}`}
            onPress={() => open.mutate(item)}
            style={[styles.row, { borderColor: theme.line, backgroundColor: item.read_at ? theme.background : theme.backgroundElement }]}>
            {item.read_at ? null : <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText style={{ fontFamily: item.read_at ? inter.regular : inter.bold }}>{item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.body}
              </ThemedText>
              <ThemedText type="caption">{postedAgo(item.created_at)}</ThemedText>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={notices.isPending ? <Loading /> : notices.isError ? <Failed error={notices.error} retry={() => void notices.refetch()} /> : <Empty title="Nothing yet" body="Replies, offers and news about your listings show here." />}
      />
    </>
  );
}

/** Turn on notifications on this phone, while it does not allow them. */
function PushCard() {
  const [status, setStatus] = useState<string | null>(null);
  const turnOn = useMutation({ mutationFn: () => registerPush({ ask: true }), onSuccess: result => setStatus(result.status) });
  useEffect(() => {
    Notifications.getPermissionsAsync().then(result => setStatus(result.status), () => setStatus(null));
  }, []);
  if (!status || status === 'granted') return null;
  return (
    <Card style={{ marginBottom: Spacing.two }}>
      <ThemedText type="heading">Get notified</ThemedText>
      <ThemedText type="small">Know when a seller answers, an offer comes in or a price drops.</ThemedText>
      <FormError error={turnOn.error} />
      {status === 'denied' ? <ThemedText type="small" themeColor="textSecondary">Notifications are off for Udozo. Turn them on in your phone&apos;s settings.</ThemedText> : <Button title="Turn on notifications" loading={turnOn.isPending} onPress={() => turnOn.mutate()} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.three, borderRadius: 12, borderWidth: 1, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
});
