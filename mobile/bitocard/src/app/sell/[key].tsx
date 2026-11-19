import { useMutation, useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Field, Line, Notice, Page, Segmented, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError, apiUpload } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { saleAmount, sellForms } from '@/lib/gift-cards';
import { formatMoney } from '@/lib/money';
import { pickPhotos, preparePhoto, type PickedPhoto } from '@/lib/photo';
import type { GiftCardSale, SaleQuote, SellOptions } from '@/lib/types';

const maxPhotos = 20;

/**
 * Sell a gift card: the kinds of this card BitoCard buys and what it pays per unit, the card's value, the exact payout
 * (the API's quote), then photos of a physical card or an e-code's code. Nothing is paid until the card is checked and
 * accepted; a lower rate meanwhile is refused (`expected_payout`), never paid less.
 */
export default function SellCard() {
  const theme = useTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const options = useQuery({ queryKey: ['sell-offers', key, country], queryFn: () => api<SellOptions>(`/v1/store/gift-card-sales/offers?product=${encodeURIComponent(key)}&country=${country}`) });
  const [offerId, setOfferId] = useState<string | null>(null);
  const [form, setForm] = useState<'physical' | 'ecode' | null>(null);
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const moneyKey = useMoneyKey();

  const offer = options.data?.offers.find(item => item.id === offerId) ?? options.data?.offers[0];
  const forms = offer ? sellForms(offer) : [];
  const sendAs = form && forms.includes(form) ? form : forms[0];

  const getQuote = useMutation({
    mutationFn: () => {
      if (!offer) throw new Error('This card is not bought right now.');
      const checked = saleAmount(value, offer);
      if ('problem' in checked) throw new Error(checked.problem);
      return api<SaleQuote>('/v1/store/gift-card-sales/quote', { body: { offer_id: offer.id, amount: checked.amount } });
    },
    onSuccess: setQuote,
  });

  const sell = useMutation({
    mutationFn: async () => {
      if (!offer || !quote) throw new Error('See what you get first.');
      const body = new FormData();
      body.append('offer_id', offer.id);
      body.append('amount', String(quote.amount));
      body.append('expected_payout', String(quote.payout));
      if (sendAs === 'ecode') {
        if (code.trim().length < 4) throw new Error('Enter the card’s code as it is written.');
        body.append('code', code.trim());
      } else {
        if (!photos.length) throw new Error('Add photos of the card: the front, and the back with the code showing.');
        for (const [index, photo] of photos.entries()) {
          body.append('photos', { uri: await preparePhoto(photo), name: `card-${index + 1}.jpg`, type: 'image/jpeg' } as unknown as Blob);
        }
      }
      return apiUpload<GiftCardSale>('/v1/store/gift-card-sales', body, moneyKey.current());
    },
    onSuccess: sale => {
      moneyKey.settle();
      router.replace({ pathname: '/sale/[id]', params: { id: sale.id } });
    },
    onError: error => {
      moneyKey.settle(error);
      if (error instanceof ApiError && error.code === 'rate_changed') setQuote(null);
    },
  });

  const add = async (from: 'camera' | 'library') => {
    setNotice(null);
    const picked = await pickPhotos(from, maxPhotos - photos.length);
    if (picked.refused) setNotice('Allow BitoCard to use the camera in your phone’s settings, or choose photos instead.');
    setPhotos(current => [...current, ...picked.photos].slice(0, maxPhotos));
  };

  const failure = getQuote.error ?? sell.error;
  const verify = failure instanceof ApiError && failure.code === 'customer_verification_required';

  return (
    <Page>
      <Stack.Screen options={{ title: 'Sell a gift card' }} />
      {options.isPending ? <T muted>Loading…</T> : null}
      {options.isError ? <Notice tone="bad">What we pay could not be loaded. Check your connection.</Notice> : null}
      {options.data && !options.data.available ? <Notice>BitoCard does not buy this card right now.</Notice> : null}
      {offer ? (
        <>
          {options.data!.offers.length > 1 ? (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Which card">
              <T kind="label">Which card</T>
              {options.data!.offers.map(item => (
                <Chip
                  key={item.id}
                  ring
                  selected={item.id === offer.id}
                  label={`${item.name} · ${formatMoney(item.rate, item.currency)} per 1`}
                  onPress={() => {
                    setOfferId(item.id);
                    setQuote(null);
                  }}
                />
              ))}
            </View>
          ) : (
            <Card>
              <T kind="heading">{offer.name}</T>
              <T color={theme.good}>We pay {formatMoney(offer.rate, offer.currency)} per 1 of its value</T>
            </Card>
          )}
          {forms.length > 1 ? (
            <Segmented
              label="Kind of card"
              value={sendAs!}
              onChange={setForm}
              options={[
                { key: 'physical', label: 'Physical card' },
                { key: 'ecode', label: 'E-code' },
              ]}
            />
          ) : null}
          <Field
            label="Card value (as printed on it)"
            value={value}
            onChangeText={text => {
              setValue(text);
              setQuote(null);
            }}
            keyboardType="number-pad"
            hint={`${offer.minimum} to ${offer.maximum}`}
          />
          {sendAs === 'ecode' ? (
            <Field label="Card code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoComplete="off" hint="We keep only its last 4 characters once the card is checked." />
          ) : (
            <View style={{ gap: 8 }}>
              <T kind="label">Photos of the card</T>
              <View style={styles.photos}>
                {photos.map((photo, index) => (
                  <Pressable key={photo.uri} accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`} onPress={() => setPhotos(current => current.filter(item => item !== photo))}>
                    <Image source={{ uri: photo.uri }} style={styles.photo} />
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button kind="secondary" label="Take a photo" onPress={() => void add('camera')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button kind="secondary" label="Choose photos" onPress={() => void add('library')} />
                </View>
              </View>
              <T kind="small" muted>
                The front, and the back with the code scratched off and readable. Tap a photo to remove it.
              </T>
            </View>
          )}
          {notice ? <Notice>{notice}</Notice> : null}
          {quote ? (
            <Card>
              <Line label="You get, into your wallet" value={formatMoney(quote.payout, quote.currency)} strong />
              <T kind="small" muted>
                Paid once the card is checked and accepted, usually within 30 minutes. A used or invalid card is declined and nothing is paid.
              </T>
            </Card>
          ) : null}
          {failure ? <Notice tone="bad">{failure instanceof Error ? failure.message : 'Something went wrong.'}</Notice> : null}
          {verify ? <Button label="Check my identity" onPress={() => router.push('/identity')} /> : null}
          {quote ? (
            <Button kind="accent" label={`Sell for ${formatMoney(quote.payout, quote.currency)}`} onPress={() => sell.mutate()} busy={sell.isPending} />
          ) : (
            <Button label="See what you get" onPress={() => getQuote.mutate()} busy={getQuote.isPending} />
          )}
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 84, height: 84, borderRadius: 12 },
});
