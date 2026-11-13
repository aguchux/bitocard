import { resaleDealText, type ShopResaleDeal, type ShopResaleMessage, type ShopReseller } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { ReportStore } from '@/components/order-extras';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Failed, Field, FormError, Loading, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, newIdempotencyKey } from '@/lib/api';
import { dealBody, noteBody } from '@/lib/resellers';

type Item = NonNullable<ShopReseller['listings']>[number];
type Asking = { kind: 'end'; deal: ShopResaleDeal } | { kind: 'note'; item: Item; decision: 'approve' | 'refuse' | 'withdraw' } | { kind: 'stop'; stopped: boolean } | null;

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * One reseller carrying the seller's listings (udozo.com's /account/resellers/<id>): their stores and phone, the chat
 * (read again every 4 seconds while open), notes to approve exactly as written, refuse or withdraw, deals to offer,
 * withdraw or end, Stop them reselling (or let them again), and Report one of their stores.
 */
export default function ResellerScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reseller = useQuery({ queryKey: ['reseller', id], queryFn: () => api<ShopReseller>(`/v1/classifieds/me/resellers/${id}`) });
  const chat = useQuery({ queryKey: ['reseller-chat', id], refetchInterval: 4000, queryFn: () => api<{ data: ShopResaleMessage[]; closed: boolean }>(`/v1/classifieds/me/resellers/${id}/messages`) });
  const [body, setBody] = useState('');
  const [chatKey, setChatKey] = useState(newIdempotencyKey);
  const [asking, setAsking] = useState<Asking>(null);
  const [reason, setReason] = useState('');
  const [offering, setOffering] = useState(false);
  const [deal, setDeal] = useState({ listingId: null as string | null, discount: '', floor: '', endsOn: '' });
  const [dealProblem, setDealProblem] = useState<string | null>(null);
  const [dealKey, setDealKey] = useState(newIdempotencyKey);

  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['reseller', id] });
    queries.invalidateQueries({ queryKey: ['reseller-chat', id] });
    queries.invalidateQueries({ queryKey: ['resellers'] });
  };
  const send = useMutation({
    mutationFn: () => api<ShopResaleMessage>(`/v1/classifieds/me/resellers/${id}/messages`, { body: { body: body.trim().slice(0, 2000) }, idempotencyKey: chatKey }),
    onSuccess: () => {
      setBody('');
      setChatKey(newIdempotencyKey());
      queries.invalidateQueries({ queryKey: ['reseller-chat', id] });
    },
    onError: () => setChatKey(newIdempotencyKey()),
  });
  const decide = useMutation({
    mutationFn: (step: Exclude<Asking, null>) => {
      if (step.kind === 'end') return api(`/v1/classifieds/me/resale-deals/${step.deal.id}/end`, { body: {} });
      if (step.kind === 'stop') return api(`/v1/classifieds/me/resellers/${id}/${step.stopped ? 'stop' : 'resume'}`, { body: {} });
      return api(`/v1/classifieds/me/resale-notes/${step.item.id}/${step.decision}`, { body: noteBody(step.decision, { note: step.item.note?.text ?? '', reason }) });
    },
    onSuccess: () => {
      setAsking(null);
      setReason('');
      refresh();
    },
  });
  const offer = useMutation({
    mutationFn: (made: Record<string, unknown>) => api<ShopResaleDeal>(`/v1/classifieds/me/resellers/${id}/deals`, { body: made, idempotencyKey: dealKey }),
    onSuccess: () => {
      setOffering(false);
      setDeal({ listingId: null, discount: '', floor: '', endsOn: '' });
      setDealKey(newIdempotencyKey());
      refresh();
    },
    onError: () => setDealKey(newIdempotencyKey()),
  });

  if (reseller.isPending) return <Loading />;
  if (reseller.isError) return <Failed error={reseller.error} retry={() => void reseller.refetch()} />;
  const data = reseller.data;
  const name = data.reseller.name;
  const listings = [...new Map((data.listings ?? []).map(item => [item.listing.id, item.listing])).values()];
  const notes = (data.listings ?? []).filter(item => item.note && item.note.status !== 'withdrawn');
  const closed = chat.data?.closed ?? data.stopped;
  const open = (step: Exclude<Asking, null>) => {
    decide.reset();
    setReason('');
    setAsking(step);
  };
  const submitDeal = () => {
    const made = dealBody(deal);
    if ('problem' in made) return setDealProblem(made.problem);
    setDealProblem(null);
    offer.mutate(made.body);
  };
  const question =
    asking?.kind === 'end'
      ? asking.deal.status === 'active'
        ? { title: 'End this deal?', body: `${name} goes back to your listings’ own discount at once.`, action: 'End deal' }
        : { title: 'Withdraw this deal?', body: `${name} can no longer accept it.`, action: 'Withdraw deal' }
      : asking?.kind === 'note'
        ? asking.decision === 'approve'
          ? { title: 'Approve this note?', body: 'Exactly this text shows with your listing on their store until you withdraw it.', action: 'Approve note' }
          : asking.decision === 'refuse'
            ? { title: 'Refuse this note?', body: 'It never shows on their store.', action: 'Refuse note' }
            : { title: 'Withdraw your approval?', body: 'The note leaves their store at once.', action: 'Withdraw approval' }
        : asking?.kind === 'stop'
          ? asking.stopped
            ? { title: `Stop ${name} reselling your listings?`, body: 'Your listings come off every store of theirs at once, your deals with them end and the chat closes.', action: 'Stop them' }
            : { title: `Let ${name} resell again?`, body: 'They can add your listings to their stores again.', action: 'Let them resell' }
          : null;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={reseller.isRefetching} onRefresh={refresh} tintColor={theme.primary} />}>
        <Card>
          <ThemedText type="heading">{`${name}${data.reseller.verified ? ' · verified' : ''}`}</ThemedText>
          {data.stores.map(store => (
            <Button key={store.id} tone="ghost" title={store.name} onPress={() => Linking.openURL(store.url)} />
          ))}
          {data.reseller.phone ? <Button tone="ghost" title={`Call ${data.reseller.phone}`} onPress={() => Linking.openURL(`tel:${data.reseller.phone}`)} /> : null}
          <ThemedText type="small">{`${data.listings_carried} of your listings · ${data.sales.open} open orders · ${data.sales.completed} sold · ${data.sales.refunded} refunded`}</ThemedText>
          {data.stopped ? <ThemedText type="smallBold" style={{ color: theme.danger }}>You stopped them reselling your listings.</ThemedText> : null}
          {data.closed_by_reseller ? <ThemedText type="small">They no longer resell your listings.</ThemedText> : null}
        </Card>

        <Card>
          <ThemedText type="heading">Notes on your listings</ThemedText>
          {notes.length ? null : <ThemedText type="small" themeColor="textSecondary">No notes. A reseller may add one short note to a listing, shown only once you approve it.</ThemedText>}
          {notes.map(item => (
            <View key={item.id} style={[styles.note, { borderColor: theme.line }]}>
              <ThemedText type="caption">{item.listing.title}</ThemedText>
              <ThemedText>{`“${item.note!.text}”`}</ThemedText>
              {item.note!.status === 'pending' ? (
                <View style={styles.row}>
                  <Button title="Approve" tone="money" style={{ flex: 1 }} onPress={() => open({ kind: 'note', item, decision: 'approve' })} />
                  <Button title="Refuse" tone="secondary" style={{ flex: 1 }} onPress={() => open({ kind: 'note', item, decision: 'refuse' })} />
                </View>
              ) : item.note!.status === 'approved' ? (
                <Button title="Withdraw approval" tone="secondary" onPress={() => open({ kind: 'note', item, decision: 'withdraw' })} />
              ) : (
                <ThemedText type="caption">{`Refused${item.note!.reason ? `: ${item.note!.reason}` : ''}`}</ThemedText>
              )}
            </View>
          ))}
        </Card>

        <Card>
          <ThemedText type="heading">Deals</ThemedText>
          {data.deals.length ? null : <ThemedText type="small" themeColor="textSecondary">No deals. They earn your listings’ own discount and never sell below your price.</ThemedText>}
          {data.deals.map(item => (
            <View key={item.id} style={[styles.note, { borderColor: theme.line }]}>
              <ThemedText type="smallBold">{item.status === 'active' ? 'Running' : 'Waiting for their answer'}</ThemedText>
              <ThemedText type="small">{resaleDealText(item)}</ThemedText>
              <Button title={item.status === 'active' ? 'End deal' : 'Withdraw'} tone="secondary" disabled={data.stopped} onPress={() => open({ kind: 'end', deal: item })} />
            </View>
          ))}
          {data.stopped || data.closed_by_reseller ? null : <Button title="Offer a deal" tone="secondary" onPress={() => setOffering(true)} />}
        </Card>

        <Card>
          <ThemedText type="heading">{`Chat with ${name}`}</ThemedText>
          {chat.data && !chat.data.data.length ? <ThemedText type="small" themeColor="textSecondary">No messages yet.</ThemedText> : null}
          {chat.data?.data.map(message =>
            message.author === 'system' ? (
              <ThemedText key={message.id} type="caption" style={{ textAlign: 'center' }}>
                {message.body}
              </ThemedText>
            ) : (
              <View key={message.id} style={[styles.message, { alignSelf: message.mine ? 'flex-end' : 'flex-start', backgroundColor: message.mine ? theme.backgroundSelected : theme.backgroundElement }]}>
                <ThemedText type="caption">{`${message.mine ? 'You' : message.author_name} · ${time(message.created_at)}`}</ThemedText>
                <ThemedText type="small">{message.body}</ThemedText>
              </View>
            ),
          )}
          {closed ? (
            <ThemedText type="small">This chat is closed.</ThemedText>
          ) : (
            <>
              <Field label={`Write to ${name}`} value={body} onChangeText={setBody} multiline maxLength={2000} />
              <FormError error={send.error} />
              <Button title="Send" tone="secondary" disabled={!body.trim()} loading={send.isPending} onPress={() => send.mutate()} />
            </>
          )}
        </Card>

        {data.stores.length ? <ReportStore target={{ kind: 'reseller', relationshipId: data.id, stores: data.stores }} /> : null}
        <Button tone={data.stopped ? 'secondary' : 'danger'} title={data.stopped ? 'Let them resell again' : 'Stop them reselling my listings'} onPress={() => open({ kind: 'stop', stopped: !data.stopped })} />
      </ScrollView>

      <ConfirmSheet
        visible={Boolean(asking)}
        onClose={() => setAsking(null)}
        title={question?.title ?? ''}
        body={question?.body}
        action={question?.action ?? 'Go ahead'}
        tone={asking?.kind === 'note' && asking.decision === 'approve' ? 'money' : asking?.kind === 'stop' && !asking.stopped ? 'primary' : 'danger'}
        busy={decide.isPending}
        error={decide.error}
        onConfirm={() => asking && decide.mutate(asking)}>
        {asking?.kind === 'note' && asking.decision === 'refuse' ? <Field label="Why (they will see this)" value={reason} onChangeText={setReason} maxLength={300} /> : null}
      </ConfirmSheet>

      <Sheet visible={offering} onClose={() => setOffering(false)} title={`Offer ${name} a deal`}>
        <View style={styles.chips}>
          <Chip label="Every listing" selected={deal.listingId === null} onPress={() => setDeal({ ...deal, listingId: null })} />
          {listings.map(listing => (
            <Chip key={listing.id} label={listing.title} selected={deal.listingId === listing.id} onPress={() => setDeal({ ...deal, listingId: listing.id })} />
          ))}
        </View>
        <Field label="Their discount (%)" value={deal.discount} onChangeText={text => setDeal({ ...deal, discount: text })} keyboardType="decimal-pad" />
        <Field label="May sell below your price by (%), optional" value={deal.floor} onChangeText={text => setDeal({ ...deal, floor: text })} keyboardType="decimal-pad" placeholder="0" />
        <Field label="Until, optional" value={deal.endsOn} onChangeText={text => setDeal({ ...deal, endsOn: text })} placeholder="2026-12-31" />
        {dealProblem ? <ThemedText type="small" style={{ color: theme.danger }}>{dealProblem}</ThemedText> : null}
        <FormError error={offer.error} />
        <Button title="Offer deal" loading={offer.isPending} disabled={!deal.discount.trim()} onPress={submitDeal} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  note: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, gap: Spacing.one },
  message: { padding: Spacing.two, borderRadius: Radius.medium, gap: 2, maxWidth: '85%' },
});
