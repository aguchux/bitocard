import { Tabs } from 'expo-router/js-tabs';

import { UdozoTabBar } from '@/components/tab-bar';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's five tabs (docs/UDOZO_MOBILE_APP_PLAN.md): Home, Search, Sell, Chats and Me. Expo Router's JavaScript tabs
 * with Udozo's own bar (`UdozoTabBar`), since the phones' own tab bars cannot draw the raised Sell circle. Listing,
 * chat, checkout and post-an-ad screens are pushed over them, without the bar.
 */
export default function AppTabs() {
  const colors = useTheme();

  return (
    <Tabs
      tabBar={props => <UdozoTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, sceneStyle: { backgroundColor: colors.background } }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="sell" options={{ title: 'Sell' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  );
}
