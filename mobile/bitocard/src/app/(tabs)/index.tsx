import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { ArrowUpRight, Bell, Gift, RefreshCw, Search, Smartphone, Sparkles, Wallet as WalletIcon, Wifi } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Card, inter, Notice, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { AccountSummary, SpinRewards, Wallet } from '@/lib/types';

/** What the "I want to" tiles open. */
const actions: { label: string; href: Href; Icon: typeof Gift; tint: 'pink' | 'blue' | 'amber' | 'violet' | 'green' | 'sky' }[] = [
  { label: 'Buy airtime', href: { pathname: '/mobile', params: { kind: 'airtime' } }, Icon: Smartphone, tint: 'pink' },
  { label: 'Buy data', href: { pathname: '/mobile', params: { kind: 'data' } }, Icon: Wifi, tint: 'blue' },
  { label: 'Sell airtime', href: '/airtime/sell', Icon: ArrowUpRight, tint: 'amber' },
  { label: 'Buy gift cards', href: { pathname: '/gift-cards', params: { mode: 'buy' } }, Icon: Gift, tint: 'violet' },
  { label: 'Sell gift cards', href: { pathname: '/gift-cards', params: { mode: 'sell' } }, Icon: WalletIcon, tint: 'green' },
  { label: 'Buy unused airtime', href: '/airtime/buy', Icon: RefreshCw, tint: 'sky' },
];

const tints = { pink: ['#ffe4ef', '#d10f5f'], blue: ['#e5ecff', '#1d4ed8'], amber: ['#fff1dc', '#b45309'], violet: ['#ede7ff', '#6d28d9'], green: ['#dcf5e8', '#047857'], sky: ['#e0f2fe', '#0369a1'] } as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join('');

/** Home: the wallet (the real balance), what the customer can do, and how their orders stand. */
export default function Home() {
  const theme = useTheme();
  const { customer } = useAccount();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api<Wallet>('/v1/store/wallet') });
  const summary = useQuery({ queryKey: ['account-summary'], queryFn: () => api<AccountSummary>('/v1/store/account/summary') });
  const unread = useQuery({ queryKey: ['notices-unread'], queryFn: () => api<{ unread_count: number }>('/v1/store/account/notifications/unread-count'), refetchInterval: 60_000 });
  const spins = useQuery({ queryKey: ['spins'], queryFn: () => api<SpinRewards>('/v1/store/spins') });
  const usd = wallet.data?.wallets.find(item => item.currency === 'USD' && !item.primary);
  const firstName = customer?.name.split(/\s+/)[0] ?? '';

  return (
    <Page header={false}>
      <View style={styles.header}>
        <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <T style={styles.wordmark} accessibilityRole="header" accessibilityLabel="BitoCard">
          Bito<T style={styles.wordmark} color={theme.pinkText}>card</T>
        </T>
        <Pressable accessibilityRole="button" accessibilityLabel={unread.data?.unread_count ? `Notifications, ${unread.data.unread_count} unread` : 'Notifications'} onPress={() => router.push('/notifications')} style={styles.bell} hitSlop={6}>
          <Bell color={theme.text} size={24} />
          {unread.data?.unread_count ? (
            <View style={[styles.badge, { backgroundColor: theme.pink }]}>
              <T kind="small" color="#ffffff" style={{ fontFamily: inter.bold, fontSize: 11, lineHeight: 14 }}>
                {unread.data.unread_count > 9 ? '9+' : unread.data.unread_count}
              </T>
            </View>
          ) : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Your account" onPress={() => router.push('/account')} style={[styles.avatar, { backgroundColor: theme.navy }]}>
          <T kind="label" color="#ffffff">
            {initials(customer?.name ?? '')}
          </T>
        </Pressable>
      </View>

      <Pressable accessibilityRole="search" accessibilityLabel="Search gift cards, airtime and more" onPress={() => router.push('/search')} style={[styles.search, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <Search color={theme.textSecondary} size={20} />
        <T muted>Search gift cards, airtime and more</T>
      </Pressable>

      <View>
        <T muted>Hello,</T>
        <T kind="title">{firstName}</T>
      </View>

      <View style={[styles.wallet, { backgroundColor: theme.navy }]} accessible accessibilityLabel={wallet.data ? `Wallet balance ${formatMoney(wallet.data.balance, wallet.data.currency)}` : 'Wallet'}>
        <View style={styles.row}>
          <T kind="label" color={theme.onNavySecondary} style={{ flex: 1 }}>
            {wallet.data ? `${wallet.data.currency} wallet` : 'Your wallet'}
          </T>
          {usd ? (
            <T kind="label" color="#ffffff">
              {formatMoney(usd.balance, 'USD')}
            </T>
          ) : null}
        </View>
        <T kind="amount" color="#ffffff">
          {wallet.data ? formatMoney(wallet.data.balance, wallet.data.currency) : wallet.isError ? '—' : '…'}
        </T>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/add-funds', params: wallet.data ? { currency: wallet.data.currency } : {} })} style={[styles.walletButton, { backgroundColor: theme.pink }]}>
          <T kind="label" color="#ffffff" style={{ fontFamily: inter.bold }}>
            Add funds
          </T>
        </Pressable>
      </View>
      {wallet.isError ? <Notice tone="bad">Your wallet could not be read. Pull down or try again shortly.</Notice> : null}

      <View style={{ gap: 12 }}>
        <T kind="heading" accessibilityRole="header">
          I want to
        </T>
        <View style={styles.grid}>
          {actions.map(({ label, href, Icon, tint }) => (
            <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={[styles.tile, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <View style={[styles.tileIcon, { backgroundColor: tints[tint][0] }]}>
                <Icon color={tints[tint][1]} size={22} />
              </View>
              <T kind="small" style={{ fontFamily: inter.semibold, textAlign: 'center' }}>
                {label}
              </T>
            </Pressable>
          ))}
        </View>
      </View>

      {spins.data?.enabled && !spins.data.allowance?.finished ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Spin and win" onPress={() => router.push('/spin')}>
          <View style={[styles.spin, { backgroundColor: theme.pinkSoft }]}>
            <Sparkles color={theme.pinkText} size={28} />
            <View style={{ flex: 1 }}>
              <T kind="label">Spin and win</T>
              <T kind="small" muted>
                {spins.data.allowance ? `${spins.data.allowance.today_left} free spins left today` : 'Free spins every day'}
              </T>
            </View>
          </View>
        </Pressable>
      ) : null}

      <Card>
        <T kind="heading" accessibilityRole="header">
          Your orders
        </T>
        {summary.data ? (
          <>
            <T>
              {summary.data.orders.total} in all · {summary.data.orders.in_progress} on the way
            </T>
            <T muted>{summary.data.delivered_this_month} delivered this month</T>
          </>
        ) : (
          <T muted>{summary.isError ? 'Could not be read just now.' : 'Loading…'}</T>
        )}
      </Card>
    </Page>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 30, height: 30, resizeMode: 'contain' },
  wordmark: { flex: 1, fontFamily: inter.extrabold, fontSize: 22, lineHeight: 28 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14 },
  spin: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wallet: { borderRadius: 22, padding: 20, gap: 14 },
  walletButton: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', flexGrow: 1, minHeight: 104, borderRadius: 18, borderWidth: 1, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 10 },
  tileIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
