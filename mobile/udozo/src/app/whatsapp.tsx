import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Switch, View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Failed, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { openLink } from '@/lib/navigate';
import { linkHref, whatsappErrorText, type WhatsappChoices, type WhatsappConnection, type WhatsappLink } from '@/lib/whatsapp';

const path = '/v1/store/account/whatsapp';
const words = (caught: unknown) => (caught instanceof ApiError ? whatsappErrorText(caught.code, caught.message) : 'That did not work. Try again in a moment.');

/**
 * WhatsApp (udozo.com's Profile > WhatsApp): Connect makes a one-time code and opens WhatsApp with `LINK <code>` ready
 * to send to Udozo's number (sending it from their phone proves the number is theirs), then I sent it reads the
 * connection again. Once connected: chats and notices on WhatsApp, each on or off; Let buyers WhatsApp me directly (off
 * by default, asked first when turned on); and Disconnect (asked first). Closed where Udozo is not on WhatsApp yet.
 */
export default function WhatsappScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const [link, setLink] = useState<WhatsappLink | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<'direct' | 'disconnect' | null>(null);
  const connection = useQuery({ queryKey: ['whatsapp'], enabled: Boolean(customer), queryFn: () => api<WhatsappConnection>(path) });
  const keep = (next: WhatsappConnection) => queries.setQueryData(['whatsapp'], next);

  const connect = useMutation({
    mutationFn: () => api<WhatsappLink>(`${path}/link`, { body: {} }),
    onSuccess: made => {
      setProblem(null);
      setLink(made);
      const href = linkHref(made, connection.data?.number ?? null);
      if (href) Linking.openURL(href).catch(() => setProblem('WhatsApp could not be opened. Is it installed on this phone?'));
    },
    onError: caught => setProblem(words(caught)),
  });
  const check = useMutation({
    mutationFn: () => api<WhatsappConnection>(path),
    onSuccess: next => {
      keep(next);
      if (next.connected) {
        setLink(null);
        setProblem(null);
      } else setProblem('Not connected yet. Send the message in WhatsApp, then try again.');
    },
    onError: caught => setProblem(words(caught)),
  });
  const choose = useMutation({
    mutationFn: (input: WhatsappChoices) => api<WhatsappConnection>(path, { method: 'PATCH', body: input }),
    onSuccess: next => {
      keep(next);
      setProblem(null);
      setAsking(null);
    },
    onError: caught => {
      setAsking(null);
      setProblem(words(caught));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api<WhatsappConnection>(path, { method: 'DELETE' }),
    onSuccess: next => {
      keep(next);
      setAsking(null);
    },
    onError: caught => {
      setAsking(null);
      setProblem(words(caught));
    },
  });

  if (!customer) return <SignedOut title="Use Udozo on WhatsApp" body="Sign in to connect your WhatsApp." />;
  if (connection.isPending) return <Loading />;
  if (connection.isError) return <Failed error={connection.error} retry={() => void connection.refetch()} />;
  const data = connection.data;
  // While a choice is being saved, its switch shows what was chosen.
  const shown = choose.isPending && choose.variables ? { ...data, ...choose.variables } : data;

  return (
    <Page edges={['bottom']}>
      <ThemedText type="small" themeColor="textSecondary">
        Use Udozo from WhatsApp: find, sell, chat and ask for what you need.
      </ThemedText>
      <Card>
        {!data.available && !data.connected ? (
          <ThemedText>Udozo is not on WhatsApp in your country yet. We will show it here once it is.</ThemedText>
        ) : data.connected ? (
          <>
            <ThemedText>
              {`Connected to ${data.phone ?? 'your WhatsApp'}.`}
              {data.opted_out ? ' You sent STOP, so Udozo writes nothing there: send START to Udozo on WhatsApp to come back.' : ''}
            </ThemedText>
            <Choice label="Chats on WhatsApp" note="Messages from buyers and sellers come to WhatsApp, and you answer there. Nobody sees your number." on={shown.chats} busy={choose.isPending} onChange={chats => choose.mutate({ chats })} />
            <Choice label="Notices on WhatsApp" note="Requests that fit what you sell, answers to yours, buy orders and contact requests." on={shown.alerts} busy={choose.isPending} onChange={alerts => choose.mutate({ alerts })} />
            <Choice
              label="Let buyers WhatsApp me directly"
              note="Contact seller on Udozo's WhatsApp gives signed-in buyers your name and this number, so they chat with you on your own WhatsApp. Off: they ask for your details first."
              on={shown.direct}
              busy={choose.isPending}
              onChange={direct => (direct ? setAsking('direct') : choose.mutate({ direct: false }))}
            />
            {data.chat_link ? <Button title="Open Udozo on WhatsApp" icon={<MessageCircle size={18} color={theme.onPrimary} />} onPress={() => openLink(data.chat_link!)} /> : null}
            <Button title="Disconnect" tone="secondary" onPress={() => setAsking('disconnect')} />
          </>
        ) : link ? (
          <>
            <ThemedText>{`Send LINK ${link.code} to Udozo${data.number ? ` (${data.number})` : ''} from the phone you use for WhatsApp. Open WhatsApp has it ready to send. The code works once, for 10 minutes.`}</ThemedText>
            <Button
              title="Open WhatsApp"
              icon={<MessageCircle size={18} color={theme.onPrimary} />}
              onPress={() => {
                const href = linkHref(link, data.number);
                if (href) Linking.openURL(href).catch(() => setProblem('WhatsApp could not be opened. Is it installed on this phone?'));
              }}
            />
            <Button title="I sent it" tone="secondary" icon={<RefreshCw size={18} color={theme.text} />} loading={check.isPending} onPress={() => check.mutate()} />
          </>
        ) : (
          <>
            <ThemedText>Find things, chat with buyers and sellers, post ads and ask for what you need, from WhatsApp. Messages go through Udozo’s number, so nobody sees yours.</ThemedText>
            <Button title="Connect WhatsApp" icon={<MessageCircle size={18} color={theme.onPrimary} />} loading={connect.isPending} onPress={() => connect.mutate()} />
            <ThemedText type="caption">If WhatsApp uses the mobile number confirmed on your account, just send Udozo a message: it connects by itself.</ThemedText>
          </>
        )}
        {problem ? (
          <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
            {problem}
          </ThemedText>
        ) : null}
      </Card>
      <ThemedText type="caption">Udozo uses WhatsApp (Meta) to carry these messages. Send STOP to Udozo on WhatsApp any time for no more messages.</ThemedText>
      <Button title="How Udozo uses WhatsApp" tone="ghost" onPress={() => openLink('/legal/privacy#whatsapp')} />

      <ConfirmSheet
        visible={asking === 'direct'}
        onClose={() => setAsking(null)}
        title="Let buyers WhatsApp you directly?"
        body={`When a signed-in buyer taps Contact seller on Udozo's WhatsApp, they get your name and ${data.phone ?? 'this number'}, and can message or call you on it outside Udozo. You are told who has it. You can turn this off at any time, but buyers who already have your number keep it.`}
        action="Share my number"
        tone="primary"
        busy={choose.isPending}
        onConfirm={() => choose.mutate({ direct: true })}
      />
      <ConfirmSheet
        visible={asking === 'disconnect'}
        onClose={() => setAsking(null)}
        title="Disconnect WhatsApp?"
        body="Udozo stops sending your chats and notices to this number, and you can no longer post or chat from it until you connect it again."
        action="Disconnect"
        tone="danger"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Page>
  );
}

function Choice({ label, note, on, busy, onChange }: { label: string; note: string; on: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="caption">{note}</ThemedText>
      </View>
      <Switch accessibilityLabel={label} value={on} disabled={busy} onValueChange={onChange} />
    </View>
  );
}
