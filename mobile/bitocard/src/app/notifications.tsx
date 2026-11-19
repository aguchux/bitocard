import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Card, Notice as Banner, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { appLink } from '@/lib/links';
import { pushAllowed, registerPush } from '@/lib/push';
import type { Notice, NoticePage } from '@/lib/types';

const pageSize = 30;

/**
 * The customer's inbox, newest first, 30 a page: opening one marks it read and goes to its screen in the app. A card
 * at the top offers notifications on this phone until they are allowed.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['notices'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<NoticePage>(`/v1/store/account/notifications?limit=${pageSize}${pageParam ? `&starting_after=${pageParam}` : ''}`),
    getNextPageParam: last => (last.has_more ? (last.data.at(-1)?.id ?? null) : null),
  });
  const allowed = useQuery({ queryKey: ['push-allowed'], queryFn: pushAllowed });
  const [pushProblem, setPushProblem] = useState<string | null>(null);
  const turnOn = useMutation({
    mutationFn: () => registerPush({ ask: true }),
    onSuccess: result => {
      void allowed.refetch();
      setPushProblem(result.registered ? null : result.reason === 'denied' ? 'Notifications are off for BitoCard. Allow them in your phone’s settings.' : 'Notifications cannot be switched on in this build of the app yet.');
    },
  });
  const changed = () => {
    void queries.invalidateQueries({ queryKey: ['notices'] });
    void queries.invalidateQueries({ queryKey: ['notices-unread'] });
  };
  const read = useMutation({ mutationFn: (id: string) => api<Notice>(`/v1/store/account/notifications/${id}/read`, { body: {} }), onSuccess: changed });
  const readAll = useMutation({ mutationFn: () => api('/v1/store/account/notifications/read-all', { body: {} }), onSuccess: changed });

  const notices = list.data?.pages.flatMap(page => page.data) ?? [];
  const unread = list.data?.pages[0]?.unread_count ?? 0;
  const open = (notice: Notice) => {
    if (!notice.read) read.mutate(notice.id);
    const to = appLink(notice.link);
    if (to) router.push(to as Href);
  };

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.page}
      data={notices}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {allowed.data === false ? (
            <Card>
              <T kind="heading">Get notified on this phone</T>
              <T muted>When an order is delivered, money arrives or someone answers you.</T>
              <Button label="Turn on notifications" onPress={() => turnOn.mutate()} busy={turnOn.isPending} />
              {pushProblem ? <T kind="small" color={theme.bad}>{pushProblem}</T> : null}
            </Card>
          ) : null}
          {unread > 0 ? <Button kind="secondary" label={`Mark all ${unread} read`} onPress={() => readAll.mutate()} busy={readAll.isPending} /> : null}
          {list.isError ? <Banner tone="bad">{list.error instanceof ApiError ? list.error.message : 'Your notifications could not be read.'}</Banner> : null}
        </View>
      }
      ListEmptyComponent={list.isPending ? <T muted>Loading…</T> : list.isError ? undefined : <T muted>Nothing yet. We will tell you here when something happens.</T>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}`} onPress={() => open(item)}>
          <Card style={item.read ? undefined : { borderColor: theme.pink }}>
            <View style={styles.row}>
              {item.read ? null : <View style={[styles.dot, { backgroundColor: theme.pink }]} />}
              <T kind="label" style={{ flex: 1 }}>
                {item.title}
              </T>
            </View>
            <T muted>{item.body}</T>
            <T kind="small" muted>
              {new Date(item.created_at).toLocaleString()}
              {item.mode === 'test' ? ' · Sandbox' : ''}
            </T>
          </Card>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
