import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, Card, Chip, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { depositFilters, depositsPath, depositStatusWords, type DepositFilter } from '@/lib/deposits';
import { formatMoney } from '@/lib/money';
import type { BankDeposit, Page as List } from '@/lib/types';

/** Every bank deposit, newest first, 20 a page, filtered as on bitocard.com's Deposits. */
export default function AllDeposits() {
  const theme = useTheme();
  const [show, setShow] = useState<DepositFilter>('all');
  const deposits = useInfiniteQuery({
    queryKey: ['bank-deposits', 'all', show],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<List<BankDeposit>>(depositsPath(show, pageParam || undefined)),
    getNextPageParam: last => (last.has_more ? last.data.at(-1)?.id : undefined),
  });
  const rows = deposits.data?.pages.flatMap(page => page.data) ?? [];
  return (
    <Page>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Show">
        {depositFilters.map(filter => (
          <Chip key={filter.key} label={filter.label} selected={filter.key === show} onPress={() => setShow(filter.key)} />
        ))}
      </ScrollView>
      {deposits.isError ? <Notice tone="bad">{deposits.error instanceof ApiError ? deposits.error.message : 'Your deposits could not be read.'}</Notice> : null}
      {deposits.isPending ? <T muted>Loading…</T> : null}
      {deposits.data && rows.length === 0 ? <T muted>No deposits here.</T> : null}
      {rows.map(deposit => (
        <Pressable key={deposit.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/bank-deposit/[id]', params: { id: deposit.id } })}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <T kind="label" style={{ flex: 1 }}>
                {deposit.number}
              </T>
              <T kind="label">{formatMoney(deposit.credited_amount ?? deposit.amount, deposit.currency)}</T>
            </View>
            <T kind="small" color={deposit.status === 'credited' ? theme.good : deposit.status === 'rejected' ? theme.bad : theme.textSecondary}>
              {depositStatusWords[deposit.status]}
            </T>
          </Card>
        </Pressable>
      ))}
      {deposits.hasNextPage ? <Button kind="secondary" label="Show more" busy={deposits.isFetchingNextPage} onPress={() => void deposits.fetchNextPage()} /> : null}
    </Page>
  );
}
