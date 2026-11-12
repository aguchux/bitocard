import { dashboardPeriods, shopMoney, type AccountDashboard, type DashboardMetric, type DashboardPeriod } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { openLink } from '@/lib/navigate';

const metrics: { key: DashboardMetric; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'leads', label: 'Leads' },
  { key: 'chats', label: 'Chats' },
  { key: 'saves', label: 'Saves' },
  { key: 'sales', label: 'Sales' },
];

/** A change against the days before, in words (never colour alone): "Up 12% on the 30 days before", "Same", or none. */
function changeText(change: number | null, days: number) {
  if (change === null) return 'Nothing before to compare';
  if (change === 0) return `Same as the ${days} days before`;
  return `${change > 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(change))}% on the ${days} days before`;
}

/**
 * The seller's dashboard (udozo.com's /account): their own figures over 7, 30 or 90 days against the days before, a
 * day-by-day bar of the chosen figure, their listings at a glance, their most viewed listings, and Udozo's message board.
 */
export default function DashboardScreen() {
  const theme = useTheme();
  const [days, setDays] = useState<DashboardPeriod>(30);
  const [metric, setMetric] = useState<DashboardMetric>('views');
  const dashboard = useQuery({ queryKey: ['dashboard', days], queryFn: () => api<AccountDashboard>(`/v1/classifieds/me/dashboard?days=${days}`) });

  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <Failed error={dashboard.error} retry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const series = data.series.map(day => day[metric]);
  const top = Math.max(1, ...series);
  const total = series.reduce((sum, value) => sum + value, 0);
  const glance: { status: string; label: string; value: number }[] = [
    { status: 'active', label: 'Live', value: data.listings.active },
    { status: 'pending_review', label: 'In review', value: data.listings.in_review },
    { status: 'draft', label: 'Drafts', value: data.listings.drafts },
    { status: 'rejected', label: 'Needs changes', value: data.listings.needs_changes },
    { status: 'expired', label: 'Expired', value: data.listings.expired },
    { status: 'sold', label: 'Sold', value: data.listings.sold },
  ];
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()} tintColor={theme.primary} />}>
      <View style={styles.chips}>
        {dashboardPeriods.map(period => (
          <Chip key={period} label={`${period} days`} selected={days === period} onPress={() => setDays(period)} />
        ))}
      </View>

      <View style={styles.tiles}>
        {metrics.map(item => {
          const figure = data.totals[item.key];
          return (
            <Card key={item.key} style={styles.tile}>
              <ThemedText type="caption">{item.label}</ThemedText>
              <ThemedText type="heading">{figure.value.toLocaleString('en-GB')}</ThemedText>
              <ThemedText type="caption">{changeText(figure.change_pct, days)}</ThemedText>
            </Card>
          );
        })}
      </View>

      <Card>
        <ThemedText type="smallBold">Day by day</ThemedText>
        <View style={styles.chips}>
          {metrics.map(item => (
            <Chip key={item.key} label={item.label} selected={metric === item.key} onPress={() => setMetric(item.key)} />
          ))}
        </View>
        <View
          style={styles.chart}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${metrics.find(item => item.key === metric)?.label}: ${total} over ${days} days, the most on one day ${top === 1 && total === 0 ? 0 : top}`}>
          {series.map((value, index) => (
            <View key={data.series[index].day} style={{ flex: 1, height: `${Math.max(2, (value / top) * 100)}%`, backgroundColor: value ? theme.primary : theme.line, borderRadius: 2 }} />
          ))}
        </View>
        <ThemedText type="caption">{`${new Date(data.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${new Date(data.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</ThemedText>
      </Card>

      <Card>
        <ThemedText type="smallBold">This period</ThemedText>
        <ThemedText type="small">{`Sold for ${data.sales_value.length ? data.sales_value.map(item => shopMoney(item.amount, item.currency)).join(', ') : 'nothing yet'}`}</ThemedText>
        <ThemedText type="small">{`Chats answered: ${data.response_rate === null ? 'none to answer' : `${Math.round(data.response_rate)}%`}`}</ThemedText>
        {data.reviews?.positive_pct !== null && data.reviews ? <ThemedText type="small">{`Positive reviews: ${Math.round(data.reviews.positive_pct!)}% of ${data.reviews.counted}`}</ThemedText> : null}
        <ThemedText type="small">{`Things you bought: ${data.purchases}`}</ThemedText>
      </Card>

      <ThemedText type="heading" accessibilityRole="header">
        Your listings
      </ThemedText>
      <View style={styles.tiles}>
        {glance.map(item => (
          <Card key={item.status} style={styles.tile}>
            <Button title={`${item.value} ${item.label.toLowerCase()}`} tone="ghost" onPress={() => router.push({ pathname: '/my-listings', params: { status: item.status } })} />
          </Card>
        ))}
      </View>

      {data.top_listings.length ? (
        <>
          <ThemedText type="heading" accessibilityRole="header">
            Most viewed
          </ThemedText>
          {data.top_listings.map(item => (
            <View key={item.id} style={[styles.line, { borderColor: theme.line }]}>
              <ThemedText style={{ flex: 1 }} numberOfLines={1}>
                {item.title ?? 'Untitled ad'}
              </ThemedText>
              <ThemedText type="caption">{`${item.views} views · ${item.leads} leads`}</ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {data.board.length ? (
        <>
          <ThemedText type="heading" accessibilityRole="header">
            From Udozo
          </ThemedText>
          {data.board.map(post => (
            <Card key={post.id} style={{ backgroundColor: post.tone === 'alert' ? '#fdecea' : theme.backgroundElement }}>
              <ThemedText type="caption">{post.tone === 'alert' ? 'Important' : post.tone === 'tip' ? 'Tip' : 'News'}</ThemedText>
              <ThemedText type="smallBold">{post.title}</ThemedText>
              <ThemedText type="small">{post.body}</ThemedText>
              {post.href ? <Button title={post.link_label ?? 'Read more'} tone="ghost" onPress={() => openLink(post.href!)} style={{ alignSelf: 'flex-start' }} /> : null}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '47%', flexGrow: 1 },
  chart: { height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 1, borderRadius: Radius.small },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
});
