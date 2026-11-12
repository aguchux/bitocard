import { shopPriceText, type ShopMyListings } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { BarChart3, Camera, LayoutList, PhoneCall } from 'lucide-react-native';
import { View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { MenuRow } from '@/components/menu-row';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Page } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

/**
 * Sell: Post an ad from the camera, the drafts to carry on, and the seller's places (My listings, Requests with what
 * waits, Dashboard).
 */
export default function SellScreen() {
  const theme = useTheme();
  const { customer, pending } = useAccount();
  const signedIn = Boolean(customer) && !pending;
  const drafts = useQuery({ queryKey: ['my-listings', 'draft'], enabled: signedIn, queryFn: () => api<ShopMyListings>('/v1/classifieds/me/listings?status=draft&limit=100') });
  const requests = useQuery({ queryKey: ['requests'], enabled: signedIn, queryFn: () => api<{ pending: number }>('/v1/classifieds/me/contact-requests?limit=100') });

  if (customer === undefined) return <AccountPending />;
  if (customer === null) {
    return (
      <Page>
        <SignedOut title="Sell on Udozo" body="Sign in to post an ad. Listing is free, and buyers reach you by chat or call without seeing your number." />
      </Page>
    );
  }
  if (pending) {
    return (
      <Page>
        <ThemedText type="subtitle" accessibilityRole="header">
          Sell on Udozo
        </ThemedText>
        <ThemedText themeColor="textSecondary">Finish your account first, then you can post.</ThemedText>
        <Button title="Finish my account" onPress={() => router.push('/verify')} />
      </Page>
    );
  }
  const newAd = () => router.push({ pathname: '/post/[id]', params: { id: 'new' } });
  return (
    <Page>
      <ThemedText type="subtitle" accessibilityRole="header">
        Sell on Udozo
      </ThemedText>
      <Card style={{ backgroundColor: theme.backgroundElement }}>
        <Camera size={28} color={theme.primary} />
        <ThemedText>Take a few photos, add a price and where it is. Listing is free.</ThemedText>
        <Button title="Post an ad" onPress={newAd} />
      </Card>

      {drafts.data?.data.length ? (
        <View>
          <ThemedText type="heading" accessibilityRole="header">
            Carry on
          </ThemedText>
          {drafts.data.data.slice(0, 5).map(item => (
            <MenuRow
              key={item.id}
              icon={<LayoutList size={20} color={theme.primary} />}
              title={item.title ?? 'Untitled ad'}
              detail={`Draft · ${shopPriceText(item.price)}`}
              onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
            />
          ))}
        </View>
      ) : null}

      <View>
        <MenuRow icon={<LayoutList size={20} color={theme.primary} />} title="My listings" onPress={() => router.push('/my-listings')} />
        <MenuRow icon={<PhoneCall size={20} color={theme.primary} />} title="Requests" detail="Contact requests and call backs" count={requests.data?.pending} onPress={() => router.push('/requests')} />
        <MenuRow icon={<BarChart3 size={20} color={theme.primary} />} title="Dashboard" detail="Views, leads and sales" onPress={() => router.push('/dashboard')} />
      </View>
    </Page>
  );
}
