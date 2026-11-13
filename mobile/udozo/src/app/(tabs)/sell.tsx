import { shopPriceText, type ShopMyListings, type ShopReseller } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { BarChart3, Camera, HandCoins, LayoutList, Megaphone, PhoneCall, Store } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { MenuRow } from '@/components/menu-row';
import { SellCarousel } from '@/components/sell-carousel';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Page } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useWantedOpen } from '@/hooks/use-wanted';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

/**
 * Sell: Post an ad from the camera and, where wanted requests are open in the market, Request an ad beside it (a card
 * peeking in from the right, swiped to); then the drafts to carry on, and the seller's places (My listings, Requests
 * with what waits, buy orders, Dashboard, Wanted requests, and My Resellers once resellers carry their listings).
 */
export default function SellScreen() {
  const theme = useTheme();
  const { customer, pending } = useAccount();
  const signedIn = Boolean(customer) && !pending;
  const drafts = useQuery({ queryKey: ['my-listings', 'draft'], enabled: signedIn, queryFn: () => api<ShopMyListings>('/v1/classifieds/me/listings?status=draft&limit=100') });
  const requests = useQuery({ queryKey: ['requests'], enabled: signedIn, queryFn: () => api<{ pending: number }>('/v1/classifieds/me/contact-requests?limit=100') });
  const resellers = useQuery({ queryKey: ['resellers'], enabled: signedIn, retry: false, queryFn: () => api<{ data: ShopReseller[] }>('/v1/classifieds/me/resellers') });
  const wanted = useWantedOpen(customer?.country);
  const resellerWaiting = (resellers.data?.data ?? []).reduce((sum, item) => sum + item.notes_pending + item.unread, 0);

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
  const postCard = (
    <Card style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Camera size={28} color={theme.primary} />
      <ThemedText type="heading">Post an ad</ThemedText>
      <ThemedText style={styles.grow}>Take a few photos, add a price and where it is. Listing is free.</ThemedText>
      <Button title="Post an ad" onPress={newAd} />
    </Card>
  );
  const requestCard = (
    <Card style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Megaphone size={28} color={theme.primary} />
      <ThemedText type="heading">Request an ad</ThemedText>
      <ThemedText style={styles.grow}>Tell sellers what you need and they come to you, with a listing in your chats.</ThemedText>
      <Button title="Request an ad" onPress={() => router.push('/wanted/new')} />
    </Card>
  );
  return (
    <Page>
      <ThemedText type="subtitle" accessibilityRole="header">
        Sell on Udozo
      </ThemedText>
      {wanted ? <SellCarousel cards={[postCard, requestCard]} labels={['Post an ad', 'Request an ad']} /> : postCard}

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
        <MenuRow icon={<HandCoins size={20} color={theme.primary} />} title="Buy orders" detail="Buyers asking to buy" onPress={() => router.push({ pathname: '/buy-orders', params: { role: 'selling' } })} />
        <MenuRow icon={<BarChart3 size={20} color={theme.primary} />} title="Dashboard" detail="Views, leads and sales" onPress={() => router.push('/dashboard')} />
        {wanted ? <MenuRow icon={<Megaphone size={20} color={theme.primary} />} title="Wanted requests" detail="What buyers asked for, and what you asked" onPress={() => router.push('/wanted')} /> : null}
        {resellers.data?.data.length ? (
          <MenuRow icon={<Store size={20} color={theme.primary} />} title="My Resellers" detail="Stores selling your listings" count={resellerWaiting || undefined} onPress={() => router.push('/resellers')} />
        ) : null}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { flexGrow: 1 },
  grow: { flexGrow: 1 },
});
