import { buyOrderLabels, shopMoney, type ShopBuyOrder, type ShopListingPage, type ShopViewer } from '@shared/classifieds';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { HandCoins } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Field, FormError, Sheet } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, newIdempotencyKey } from '@/lib/api';
import { fromMinor, toMinor } from '@/lib/listing-form';

/**
 * Buy this, on a listing that takes buy orders (udozo.com's `BuyOrderSheet`): the price (the asking price to start), how
 * many, a note and where to meet; once the seller accepts, it is held while they meet, and the buyer pays in person.
 * With a buy order open already, it says where it stands and opens it.
 */
export function BuyOrderPanel({ data, viewer, offered }: { data: ShopListingPage; viewer: ShopViewer | null; offered: boolean }) {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(fromMinor(data.price.amount));
  const [note, setNote] = useState('');
  const [meet, setMeet] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const most = Math.max(1, Math.min(data.available ?? 1, 10));
  const send = useMutation({
    mutationFn: (minor: number) =>
      api<ShopBuyOrder>(`/v1/classifieds/listings/${data.id}/buy-orders`, {
        body: { price: minor, quantity, note: note.trim() ? note.trim().slice(0, 300) : undefined, meet_note: meet.trim() ? meet.trim().slice(0, 300) : undefined },
        idempotencyKey: key,
      }),
    onSuccess: order => {
      setOpen(false);
      queries.invalidateQueries({ queryKey: ['viewer', data.id] });
      queries.invalidateQueries({ queryKey: ['buy-orders'] });
      router.push({ pathname: '/buy-order/[id]', params: { id: order.id } });
    },
    onError: () => setKey(newIdempotencyKey()),
  });

  const mine = viewer?.buy_order;
  if (mine) {
    return (
      <Card>
        <ThemedText type="smallBold">{`Your buy order ${mine.number}: ${buyOrderLabels[mine.role][mine.status]}`}</ThemedText>
        <Button title="Open my buy order" tone="secondary" onPress={() => router.push({ pathname: '/buy-order/[id]', params: { id: mine.id } })} />
      </Card>
    );
  }
  if (!offered || data.status !== 'active' || data.in_stock === false || viewer?.own) return null;
  const changeQuantity = (next: number) => {
    setQuantity(next);
    if (data.price.amount !== null) setPrice(fromMinor(data.price.amount * next));
  };
  const submit = () => {
    const minor = toMinor(price);
    if (minor === null) return setProblem('Give your price as an amount, such as 250,000.');
    setProblem(null);
    send.mutate(minor);
  };
  return (
    <>
      <Button title="Buy this" tone="secondary" icon={<HandCoins size={18} color={theme.text} />} onPress={() => (customer ? setOpen(true) : router.push('/signin'))} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Buy this">
        <ThemedText type="small">{`Ask the seller to sell you “${data.title}”. Once they accept, it is held for you while you meet. Inspect it, then pay them in person.`}</ThemedText>
        {most > 1 ? (
          <View style={styles.chips}>
            {Array.from({ length: most }, (_, index) => index + 1).map(count => (
              <Chip key={count} label={`${count}`} selected={quantity === count} onPress={() => changeQuantity(count)} />
            ))}
          </View>
        ) : null}
        <Field label={`Your price for all of them (${data.price.currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" error={problem} hint={data.price.amount !== null ? `The asking price is ${shopMoney(data.price.amount * quantity, data.price.currency)}.` : undefined} />
        <Field label="A note for the seller (optional)" value={note} onChangeText={setNote} maxLength={300} />
        <Field label="Where you would like to meet (optional)" value={meet} onChangeText={setMeet} maxLength={300} />
        <FormError error={send.error} />
        <Button title="Send buy order" loading={send.isPending} onPress={submit} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two } });
