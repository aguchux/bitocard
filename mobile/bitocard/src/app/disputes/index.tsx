import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Button, Card, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { disputeStatus } from '@/lib/disputes';
import type { Dispute, Page as List } from '@/lib/types';

/** The problems the customer reported, newest first; a new one starts from its order's page. */
export default function DisputesScreen() {
  const theme = useTheme();
  const disputes = useInfiniteQuery({
    queryKey: ['disputes'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<List<Dispute>>(`/v1/store/account/disputes?limit=20${pageParam ? `&starting_after=${pageParam}` : ''}`),
    getNextPageParam: last => (last.has_more ? last.data.at(-1)?.id : undefined),
  });
  const rows = disputes.data?.pages.flatMap(page => page.data) ?? [];
  return (
    <Page>
      <T muted>Something wrong with an order? Open it and choose Report a problem. We answer here, and refund you when it was not your fault.</T>
      {disputes.isError ? <Notice tone="bad">{disputes.error instanceof ApiError ? disputes.error.message : 'Your reports could not be read.'}</Notice> : null}
      {disputes.isPending ? <T muted>Loading…</T> : null}
      {disputes.data && rows.length === 0 ? <T muted>You have not reported any problems.</T> : null}
      {rows.map(dispute => {
        const status = disputeStatus(dispute);
        return (
          <Pressable key={dispute.id} accessibilityRole="button" accessibilityLabel={`${dispute.subject}, ${status.label}`} onPress={() => router.push({ pathname: '/disputes/[id]', params: { id: dispute.id } })}>
            <Card>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <T kind="label" style={{ flex: 1 }}>
                  {dispute.subject}
                </T>
                <T kind="small" color={status.tone === 'good' ? theme.good : status.tone === 'warn' ? theme.warn : theme.textSecondary}>
                  {status.label}
                </T>
              </View>
              <T kind="small" muted>
                {dispute.reference} · {new Date(dispute.created_at).toLocaleDateString()}
              </T>
            </Card>
          </Pressable>
        );
      })}
      {disputes.hasNextPage ? <Button kind="secondary" label="Show more" busy={disputes.isFetchingNextPage} onPress={() => void disputes.fetchNextPage()} /> : null}
    </Page>
  );
}
