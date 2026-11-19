import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Gift, House, ReceiptText, Smartphone, Wallet } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { Button, inter, Notice, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';

const icon = (Icon: typeof House) =>
  function TabIcon({ color, size }: { color: unknown; size: number }) {
    return <Icon color={typeof color === 'string' ? color : undefined} size={size} />;
  };

/**
 * The app's five tabs, as the approved designs: Home, Mobile (airtime and data), Gift cards, Wallet and Orders. Signed
 * out, the welcome screen; an account whose email is not confirmed yet, its code first (the wallet needs it).
 */
export default function AppTabs() {
  const theme = useTheme();
  const { customer, error, retry } = useAccount();

  if (customer === undefined) {
    if (error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: theme.background }}>
          <Notice tone="bad">BitoCard cannot be reached. Check your connection and try again.</Notice>
          <Button label="Try again" onPress={retry} />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.pink} accessibilityLabel="Loading" />
      </View>
    );
  }
  if (customer === null) return <Redirect href="/welcome" />;
  if (!customer.email_verified) return <Redirect href="/verify" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.pinkText,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: { fontFamily: inter.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.line },
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon(House) }} />
      <Tabs.Screen name="mobile" options={{ title: 'Mobile', tabBarIcon: icon(Smartphone) }} />
      <Tabs.Screen name="gift-cards" options={{ title: 'Gift cards', tabBarIcon: icon(Gift) }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon(Wallet) }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon(ReceiptText) }} />
    </Tabs>
  );
}

