import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Line, Notice, T } from '@/components/ui';
import { localNumber, rateText } from '@/lib/airtime';
import { formatMoney } from '@/lib/money';
import type { AirtimeNetwork, AirtimePool, CustomerPhones } from '@/lib/types';

/** The networks traded now, as chips; the rest are left out (the board says which are closed). */
export function NetworkChips({ networks, value, onChange }: { networks: AirtimeNetwork[]; value: string | null; onChange: (network: string) => void }) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Network">
      <T kind="label">Network</T>
      <View style={styles.wrap}>
        {networks.map(network => (
          <Chip key={network.network} ring label={network.name} selected={network.network === value} onPress={() => onChange(network.network)} />
        ))}
      </View>
    </View>
  );
}

/** The customer's confirmed numbers to choose from, with a way to add one; none confirmed yet says so. */
export function NumberChips({ label, phones, value, onChange }: { label: string; phones: CustomerPhones | undefined; value: string | null; onChange: (phone: string) => void }) {
  if (!phones) return <T muted>Loading your numbers…</T>;
  if (phones.data.length === 0) {
    return (
      <Card>
        <T kind="heading">Confirm a number first</T>
        <T muted>Airtime moves only to and from your confirmed numbers.</T>
        <Button label="Add a number" onPress={() => router.push('/phones')} />
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T kind="label">{label}</T>
      <View style={styles.wrap}>
        {phones.data.map(item => (
          <Chip key={item.phone} ring label={localNumber(item.phone)} selected={item.phone === value} onPress={() => onChange(item.phone)} />
        ))}
        <Chip label="Add a number" selected={false} onPress={() => router.push('/phones')} />
      </View>
    </View>
  );
}

/** The live pool: what BitoCard holds per network now, its rates, and what moved in the last 24 hours. */
export function PoolBoard({ pool }: { pool: AirtimePool }) {
  const currency = pool.currency ?? 'NGN';
  const money = (minor: number) => formatMoney(minor, currency, { cents: false });
  return (
    <View style={{ gap: 10 }}>
      {pool.open ? null : <Notice>The airtime exchange is not open yet.</Notice>}
      <Card>
        <Line label="Available now" value={money(pool.totals.available)} strong />
        <Line label="Bought in 24 hours" value={money(pool.totals.bought_24h)} />
        <Line label="Sold in 24 hours" value={money(pool.totals.sold_24h)} />
      </Card>
      {pool.networks.map(network => (
        <Card key={network.network}>
          <View style={styles.row}>
            <T kind="heading" style={{ flex: 1 }}>
              {network.name}
            </T>
            <T kind="small" muted>
              {network.open ? 'Open' : 'Closed'}
            </T>
          </View>
          <Line label="Available" value={money(network.available)} strong />
          <Line label="You get when you sell" value={rateText(network.sell_rate_bps)} />
          <Line label="You pay when you buy" value={rateText(network.buy_rate_bps)} />
          <Line label="Bought · sold (24 h)" value={`${money(network.bought_24h)} · ${money(network.sold_24h)}`} />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
