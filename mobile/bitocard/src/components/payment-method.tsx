import { Image, type ImageSource } from 'expo-image';
import { CreditCard } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { inter, T, useTheme } from '@/components/ui';
import type { PaymentMethod } from '@/lib/types';

type GatewayBrand = { name: string; logo: ImageSource; wide?: boolean };

const gatewayBrands: Record<string, GatewayBrand> = {
  stripe: { name: 'Stripe', logo: require('../../assets/payment-gateways/stripe.svg') },
  paystack: { name: 'Paystack', logo: require('../../assets/payment-gateways/paystack.svg') },
  flutterwave: { name: 'Flutterwave', logo: require('../../assets/payment-gateways/flutterwave.svg') },
  monnify: { name: 'Monnify', logo: require('../../assets/payment-gateways/monnify.svg') },
  pawapay: { name: 'pawaPay', logo: require('../../assets/payment-gateways/pawapay.svg'), wide: true },
};

/** A gateway's own name and mark, while its API label remains the channels it offers. */
export function PaymentMethodOption({ method, selected, onPress }: { method: PaymentMethod; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const brand = gatewayBrands[method.id];
  const name = brand?.name ?? method.label;
  const channels = brand ? method.label : null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${name}. ${method.description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: selected ? theme.pinkSoft : theme.card, borderColor: selected ? theme.pink : theme.line, opacity: pressed ? 0.82 : 1 },
      ]}>
      <View style={[styles.logoBox, { backgroundColor: theme.background, borderColor: theme.line }]}>
        {brand ? (
          <Image source={brand.logo} contentFit="contain" style={brand.wide ? styles.wideLogo : styles.logo} />
        ) : (
          <CreditCard size={25} color={theme.navy} aria-hidden />
        )}
      </View>
      <View style={styles.words}>
        <T style={styles.name}>{name}</T>
        {channels && channels.toLowerCase() !== name.toLowerCase() ? <T kind="small" muted>{channels}</T> : null}
        <T kind="small" muted>{method.description}</T>
        {method.networks.length ? (
          <View style={styles.networks} accessibilityLabel={`Networks: ${method.networks.join(', ')}`}>
            {method.networks.map(network => (
              <View key={network} style={[styles.network, { backgroundColor: theme.background }]}>
                <T kind="caption" style={{ fontFamily: inter.semibold }}>{network}</T>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={[styles.radio, { borderColor: selected ? theme.pink : theme.field }]}>{selected ? <View style={[styles.dot, { backgroundColor: theme.pink }]} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 86, borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  logoBox: { width: 72, height: 46, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', padding: 7 },
  logo: { width: 30, height: 30 },
  wideLogo: { width: 58, height: 22 },
  words: { flex: 1, gap: 2 },
  name: { fontFamily: inter.bold, fontSize: 16, lineHeight: 21 },
  networks: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  network: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
