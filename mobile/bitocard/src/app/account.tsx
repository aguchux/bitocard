import { router } from 'expo-router';

import { Button, Card, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';

/** Your account: who is signed in, the country (fixed at sign-up) and signing out. Settings, help and notifications are linked here. */
export default function AccountScreen() {
  const { customer, signOut } = useAccount();
  return (
    <Page>
      <Card>
        <T kind="heading">{customer?.name}</T>
        <T muted>{customer?.email}</T>
        <T muted>{customer?.country ? `${customer.country} · ${customer.currency ?? ''}`.trim() : 'Country not chosen yet'}</T>
        <T kind="small" muted>
          Your country is fixed: your wallet and prices are in its currency.
        </T>
      </Card>
      <Button kind="secondary" label="Notifications" onPress={() => router.push('/notifications')} />
      <Button kind="secondary" label="Help" onPress={() => router.push('/help')} />
      <Button kind="secondary" label="Mobile numbers" onPress={() => router.push('/phones')} />
      <Button kind="secondary" label="Settings" onPress={() => router.push('/settings')} />
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
