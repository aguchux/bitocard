import { Redirect, router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, inter, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';

/** Signed out: what BitoCard is, then Create an account or Sign in. */
export default function Welcome() {
  const theme = useTheme();
  const { customer } = useAccount();
  if (customer) return <Redirect href="/" />;
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: theme.navy }]}>
      <View style={styles.brand}>
        <View style={styles.markTile}>
          <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        </View>
        <T style={styles.wordmark} color="#ffffff" accessibilityRole="header" accessibilityLabel="BitoCard">
          Bito<T style={styles.wordmark} color="#ff4f9c">card</T>
        </T>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <T kind="title" color="#ffffff" style={{ fontSize: 30, lineHeight: 36 }}>
          Airtime, data and gift cards. Buy and sell in seconds.
        </T>
        <T color={theme.onNavySecondary}>One account with bitocard.com: the same wallet, orders and sign-in.</T>
      </View>
      <View style={{ gap: 12 }}>
        <Button kind="accent" label="Create an account" onPress={() => router.push('/signup')} />
        <Button kind="onNavy" label="I already have an account" onPress={() => router.push('/signin')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  markTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  mark: { width: 28, height: 28, resizeMode: 'contain' },
  wordmark: { fontFamily: inter.extrabold, fontSize: 22, lineHeight: 28 },
});
