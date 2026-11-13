import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AtSign, Banknote, BarChart3, Bell, HandCoins, Heart, LayoutList, Package, PhoneCall, ScanLine, Settings, ShieldCheck, Wallet } from 'lucide-react-native';
import { View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { MenuRow } from '@/components/menu-row';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

/**
 * Me: who is signed in, a reminder to finish the account, then their places: the wallet, UdozoPay orders, payouts,
 * Scan to pay at a shop and the identity check (phase 3) beside the selling places.
 */
export default function MeScreen() {
  const theme = useTheme();
  const { customer, pending } = useAccount();
  const unread = useQuery({ queryKey: ['notices', 'unread'], enabled: Boolean(customer), queryFn: () => api<{ count: number }>('/v1/store/account/notifications/unread-count') });
  if (customer === undefined) return <AccountPending />;
  if (customer === null) {
    return (
      <Page>
        <SignedOut title="Me" body="Sign in to save listings, chat with sellers and get notified when they answer." />
      </Page>
    );
  }
  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
        <Avatar name={customer.name} url={customer.avatar_url} size={56} />
        <View style={{ flex: 1 }}>
          <ThemedText type="heading">{customer.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {customer.email}
          </ThemedText>
        </View>
      </View>
      {pending ? (
        <Card style={{ backgroundColor: theme.backgroundElement }}>
          <ThemedText>Finish your account to chat and sell.</ThemedText>
          <Button title="Finish my account" onPress={() => router.push('/verify')} />
        </Card>
      ) : null}
      <View>
        <MenuRow icon={<Heart size={20} color={theme.primary} />} title="Saved" onPress={() => router.push('/saved')} />
        <MenuRow icon={<Bell size={20} color={theme.primary} />} title="Notifications" count={unread.data?.count} onPress={() => router.push('/notifications')} />
        <MenuRow icon={<LayoutList size={20} color={theme.primary} />} title="My listings" onPress={() => router.push('/my-listings')} />
        <MenuRow icon={<PhoneCall size={20} color={theme.primary} />} title="Requests" onPress={() => router.push('/requests')} />
        <MenuRow icon={<BarChart3 size={20} color={theme.primary} />} title="Dashboard" onPress={() => router.push('/dashboard')} />
        <MenuRow icon={<AtSign size={20} color={theme.primary} />} title="Username" detail={customer.username ? `@${customer.username}` : undefined} onPress={() => router.push('/username')} />
        <MenuRow icon={<Wallet size={20} color={theme.primary} />} title="Wallet" onPress={() => router.push('/wallet')} />
        <MenuRow icon={<Package size={20} color={theme.primary} />} title="UdozoPay orders" onPress={() => router.push('/orders')} />
        <MenuRow icon={<HandCoins size={20} color={theme.primary} />} title="Buy orders" detail="Buying and selling in person" onPress={() => router.push('/buy-orders')} />
        <MenuRow icon={<ScanLine size={20} color={theme.primary} />} title="Scan to pay at a shop" onPress={() => router.push('/scan')} />
        <MenuRow icon={<Banknote size={20} color={theme.primary} />} title="Payouts" detail="Money from your sales" onPress={() => router.push('/payouts')} />
        <MenuRow icon={<ShieldCheck size={20} color={theme.primary} />} title="Identity check" onPress={() => router.push('/identity')} />
        <MenuRow icon={<Settings size={20} color={theme.primary} />} title="Settings" onPress={() => router.push('/settings')} />
      </View>
    </Page>
  );
}
