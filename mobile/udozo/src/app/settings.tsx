import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Bell, FileText, LogOut, Shield, Trash2, UserRound } from 'lucide-react-native';
import { View } from 'react-native';

import { MenuRow } from '@/components/menu-row';
import { ThemedText } from '@/components/themed-text';
import { Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { appVersion } from '@/lib/config';

const web = (path: string) => () => WebBrowser.openBrowserAsync(`https://udozo.com${path}`).catch(() => undefined);

/** Settings: the profile (on udozo.com for now), notifications, the legal pages, signing out and deleting the account. */
export default function SettingsScreen() {
  const theme = useTheme();
  const { customer, signOut } = useAccount();
  return (
    <Page edges={['bottom']}>
      <View>
        {customer ? <MenuRow icon={<UserRound size={20} color={theme.primary} />} title="Profile" detail="Name, photo, mobile, password" external onPress={web('/account/profile')} /> : null}
        <MenuRow icon={<Bell size={20} color={theme.primary} />} title="Notifications" onPress={() => router.push('/notifications')} />
        <MenuRow icon={<Shield size={20} color={theme.primary} />} title="Privacy notice" external onPress={web('/legal/privacy')} />
        <MenuRow icon={<FileText size={20} color={theme.primary} />} title="Terms of use" external onPress={web('/legal/terms')} />
        {customer ? (
          <>
            <MenuRow icon={<LogOut size={20} color={theme.primary} />} title="Sign out" onPress={() => signOut().then(() => router.replace('/'))} />
            <MenuRow icon={<Trash2 size={20} color={theme.danger} />} title="Delete my account" danger onPress={() => router.push('/delete-account')} />
          </>
        ) : null}
      </View>
      <ThemedText type="caption" style={{ textAlign: 'center', marginTop: Spacing.four }}>
        {`Udozo ${appVersion}`}
      </ThemedText>
    </Page>
  );
}
