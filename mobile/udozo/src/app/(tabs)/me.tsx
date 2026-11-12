import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Bell, Heart, LayoutList, Package, Settings, Wallet } from 'lucide-react-native';
import { View } from 'react-native';

import { MenuRow } from '@/components/menu-row';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

const web = (path: string) => () => WebBrowser.openBrowserAsync(`https://udozo.com${path}`).catch(() => undefined);

/**
 * Me: who is signed in, a reminder to finish the account, then their places. Saved and Notifications are the app's own;
 * listings, the wallet and orders open on udozo.com until their phases bring them into the app.
 */
export default function MeScreen() {
  const theme = useTheme();
  const { customer, pending } = useAccount();
  const unread = useQuery({ queryKey: ['notices', 'unread'], enabled: Boolean(customer), queryFn: () => api<{ count: number }>('/v1/store/account/notifications/unread-count') });
  if (customer === undefined) return <Loading />;
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
        <MenuRow icon={<LayoutList size={20} color={theme.primary} />} title="My listings" external onPress={web('/account/listings')} />
        <MenuRow icon={<Package size={20} color={theme.primary} />} title="UdozoPay orders" external onPress={web('/account/orders')} />
        <MenuRow icon={<Wallet size={20} color={theme.primary} />} title="Wallet" external onPress={web('/account/wallet')} />
        <MenuRow icon={<Settings size={20} color={theme.primary} />} title="Settings" onPress={() => router.push('/settings')} />
      </View>
    </Page>
  );
}
