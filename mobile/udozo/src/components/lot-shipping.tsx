import { shopMoney, type ShopLotShipOptions, type ShopLotTransfer } from '@shared/classifieds';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormError, Sheet } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { lotShipRefusal, lotTransferWords } from '@/lib/auctions';
import { useMoneyKey } from '@/lib/biometrics';

/**
 * A won lot of Udozo's, not collected yet (udozo.com's `LotShipping`): have it sent from Udozo's warehouse to a Connect
 * Centre near the buyer, paying the shipping and the centre's Connect fee (confirmed with Face ID or the fingerprint,
 * the total sent so a changed one is refused), or where that move stands, with Stop sending it before Udozo sends it.
 */
export function LotShipping({ lotRef, transfer, onChange }: { lotRef: string; transfer: ShopLotTransfer | null; onChange: () => void }) {
  const theme = useTheme();
  const key = useMoneyKey();
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const moving = transfer && transfer.status !== 'collected' ? transfer : null;

  const options = useQuery({
    queryKey: ['lot-ship-options', lotRef],
    enabled: choosing || confirming,
    queryFn: () => api<ShopLotShipOptions>(`/v1/classifieds/auctions/${lotRef}/ship-options`),
  });
  const offer = options.data;
  const choice = offer?.data.find(option => option.centre.id === chosen);
  const words = (caught: unknown, fallback: string) => (caught instanceof ApiError ? lotShipRefusal(caught.code, caught.message) : fallback);

  const ship = useMutation({
    mutationFn: () => api(`/v1/classifieds/auctions/${lotRef}/ship`, { body: { centre_id: choice!.centre.id, expected_total: offer!.total }, idempotencyKey: key.current() }),
    onSuccess: () => {
      key.settle();
      setConfirming(false);
      setChoosing(false);
      setProblem(null);
      onChange();
    },
    onError: caught => {
      key.settle(caught);
      setConfirming(false);
      setProblem(words(caught, 'It could not be sent. Try again.'));
      void options.refetch();
    },
  });
  const stop = useMutation({
    mutationFn: () => api(`/v1/classifieds/auctions/${lotRef}/ship/cancel`, { body: {} }),
    onSuccess: () => {
      setStopping(false);
      setProblem(null);
      onChange();
    },
    onError: caught => {
      setStopping(false);
      setProblem(words(caught, 'It could not be stopped. Try again.'));
    },
  });

  return (
    <View style={{ gap: 8 }}>
      {moving ? (
        <>
          <ThemedText type="smallBold" accessibilityLiveRegion="polite">{`${moving.number}: ${lotTransferWords(moving)}`}</ThemedText>
          {moving.status === 'paid' ? <Button title="Stop sending it" tone="secondary" onPress={() => setStopping(true)} /> : null}
        </>
      ) : (
        <Button title="Have it sent to a Connect Centre near me" tone="secondary" onPress={() => setChoosing(true)} />
      )}
      {problem ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
          {problem}
        </ThemedText>
      ) : null}

      <Sheet visible={choosing && !confirming} onClose={() => setChoosing(false)} title="Send it to a Connect Centre">
        <FormError error={options.error} />
        {offer && !offer.data.length ? <ThemedText>No Connect Centre can take it yet: collect it at the warehouse.</ThemedText> : null}
        {offer?.data.map(option => (
          <Chip key={option.centre.id} label={`${option.centre.state}: ${option.centre.name}, ${option.centre.area}`} selected={chosen === option.centre.id} onPress={() => setChosen(option.centre.id)} />
        ))}
        {choice ? <ThemedText type="small">{`${choice.centre.address}${choice.centre.landmark ? `, ${choice.centre.landmark}` : ''} · ${choice.centre.hours}`}</ThemedText> : null}
        {offer?.data.length ? (
          <ThemedText type="small" themeColor="textSecondary">{`Shipping ${shopMoney(offer.shipping, offer.currency)} and the centre's Connect fee ${shopMoney(offer.fee, offer.currency)}.`}</ThemedText>
        ) : null}
        {problem ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {problem}
          </ThemedText>
        ) : null}
        {offer?.data.length ? (
          <Button title={`Pay ${shopMoney(offer.total, offer.currency)} and send it`} tone="money" disabled={!choice} onPress={() => setConfirming(true)} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={choice ? `Send it to ${choice.centre.name}?` : 'Send it?'}
        body={offer ? `You pay ${shopMoney(offer.total, offer.currency)} now (${shopMoney(offer.shipping, offer.currency)} shipping and the centre's ${shopMoney(offer.fee, offer.currency)} Connect fee), from your Udozo money or wallet. You then collect it there with your collection code.` : undefined}
        action="Pay and send it"
        reason={offer ? `Pay ${shopMoney(offer.total, offer.currency)} to send it` : 'Pay to send it'}
        busy={ship.isPending}
        onConfirm={() => ship.mutate()}
      />
      <ConfirmSheet
        visible={stopping}
        onClose={() => setStopping(false)}
        title="Stop sending it?"
        body="Your money goes back where it came from, and you collect it at Udozo's warehouse instead."
        action="Stop sending it"
        tone="danger"
        busy={stop.isPending}
        onConfirm={() => stop.mutate()}
      />
    </View>
  );
}
