import { router, type Href } from 'expo-router';
import { BadgeCheck, Bell, ChevronRight, Flag, Gift, KeyRound, Landmark, LifeBuoy, Phone, Settings, UserRound } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';

type Row = { label: string; hint: string; href: Href; Icon: typeof Bell };

/** The account's places, grouped as bitocard.com's Account menu is. */
const groups: { title: string; rows: Row[] }[] = [
  {
    title: 'Your account',
    rows: [
      { label: 'Profile', hint: 'Name, email and country', href: '/profile', Icon: UserRound },
      { label: 'Security', hint: 'Change your password', href: '/security', Icon: KeyRound },
      { label: 'Identity check', hint: 'Needed for some products', href: '/identity', Icon: BadgeCheck },
      { label: 'Mobile numbers', hint: 'Numbers you sell airtime from', href: '/phones', Icon: Phone },
    ],
  },
  {
    title: 'Money and orders',
    rows: [
      { label: 'Gift cards you sold', hint: 'Every sale and what you were paid', href: '/sold', Icon: Gift },
      { label: 'Bank deposits', hint: 'Every deposit and its status', href: '/bank-deposit/all', Icon: Landmark },
      { label: 'Reported problems', hint: 'Problems with an order', href: '/disputes', Icon: Flag },
    ],
  },
  {
    title: 'Help and settings',
    rows: [
      { label: 'Notifications', hint: 'Your inbox', href: '/notifications', Icon: Bell },
      { label: 'Help', hint: 'Chat with us, or ask a question', href: '/help', Icon: LifeBuoy },
      { label: 'Settings', hint: 'Push, theme, deleting your account', href: '/settings', Icon: Settings },
    ],
  },
];

/** Your account: who is signed in, then the account's places as rows, then signing out. */
export default function AccountScreen() {
  const theme = useTheme();
  const { customer, signOut } = useAccount();
  return (
    <Page>
        <Card>
          <T kind="heading">{customer?.name}</T>
          <T muted>{customer?.email}</T>
          <T muted>{customer?.country ? `${customer.country} · ${customer.currency ?? ''}`.trim() : 'Country not chosen yet: choose it in Profile'}</T>
        </Card>
        {groups.map(group => (
          <View key={group.title} style={{ gap: 8 }}>
            <T kind="label" muted accessibilityRole="header">
              {group.title}
            </T>
            <Card style={{ padding: 0, gap: 0 }}>
              {group.rows.map((row, index) => (
                <Pressable
                  key={row.label}
                  accessibilityRole="button"
                  accessibilityLabel={row.label}
                  accessibilityHint={row.hint}
                  onPress={() => router.push(row.href)}
                  style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }, pressed && { opacity: 0.7 }]}>
                  <row.Icon color={row.label === 'Profile' && !customer?.country ? theme.warn : theme.text} size={20} />
                  <View style={{ flex: 1 }}>
                    <T kind="label">{row.label}</T>
                    <T kind="small" muted>
                      {row.hint}
                    </T>
                  </View>
                  <ChevronRight color={theme.textSecondary} size={18} />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}
        <Button
          kind="secondary"
          label="Sign out"
          onPress={async () => {
            await signOut();
            router.replace('/welcome');
          }}
        />
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, minHeight: 64, paddingVertical: 10 },
});
