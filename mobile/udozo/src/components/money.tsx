import { shopMoney } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { ShieldCheck } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Button, FormError, Sheet } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { confirmOnPhone } from '@/lib/biometrics';

export type Line = { label: string; amount: number; strong?: boolean };

/** What is paid, line by line, with the total last and bold (never colour alone). */
export function MoneyLines({ lines, currency, note }: { lines: Line[]; currency: string; note?: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={lines.map(line => `${line.label} ${shopMoney(line.amount, currency)}`).join(', ')} style={styles.lines}>
      {lines.map(line => (
        <View key={line.label} style={[styles.line, line.strong && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.line, paddingTop: Spacing.two }]}>
          <ThemedText type={line.strong ? 'smallBold' : 'small'} style={{ flex: 1 }}>
            {line.label}
          </ThemedText>
          <ThemedText style={{ fontFamily: line.strong ? inter.extrabold : inter.semibold }}>{line.amount ? shopMoney(line.amount, currency) : line.strong ? shopMoney(0, currency) : 'Free'}</ThemedText>
        </View>
      ))}
      {note ? <ThemedText type="caption">{note}</ThemedText> : null}
    </View>
  );
}

/**
 * Every money step's confirmation: a sheet naming the amount, then Face ID, the fingerprint or the phone's PIN, then the
 * step. The action's words say what happens ("Pay ₦45,000"); red for steps that give money back or stop an order.
 */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  body,
  action,
  reason,
  tone = 'money',
  busy,
  error,
  onConfirm,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  action: string;
  /** What the phone's own prompt says ("Pay ₦45,000 from your wallet"). Left out: no biometrics (not a money step). */
  reason?: string;
  tone?: 'money' | 'danger' | 'primary';
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const confirm = async () => {
    if (reason) {
      setAsking(true);
      const ok = await confirmOnPhone(reason);
      setAsking(false);
      if (!ok) return;
    }
    onConfirm();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {body ? <ThemedText>{body}</ThemedText> : null}
      {children}
      <FormError error={error} />
      <Button title={action} tone={tone} loading={busy || asking} onPress={confirm} />
      <Button title="Cancel" tone="secondary" disabled={busy} onPress={onClose} />
    </Sheet>
  );
}

/** Udozo holds the money line under every checkout and order. */
export function HeldNote() {
  const theme = useTheme();
  return (
    <View style={styles.held}>
      <ShieldCheck size={16} color={theme.success} />
      <ThemedText type="caption" style={{ flex: 1 }}>
        Udozo holds the money and pays the seller only once you have the item. Udozo is not the seller.
      </ThemedText>
    </View>
  );
}

type Terms = { version: string; path: string; accepted: boolean; previous_version: string | null };

/**
 * UdozoPay needs Udozo's terms accepted (the API refuses with `terms_not_accepted`): read them, accept, then `retry`
 * the step that was refused, as a new request.
 */
export function TermsSheet({ visible, onClose, retry }: { visible: boolean; onClose: () => void; retry: () => void }) {
  const terms = useQuery({ queryKey: ['shop-terms'], enabled: visible, queryFn: () => api<Terms>('/v1/classifieds/terms') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const accept = async () => {
    if (!terms.data) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/classifieds/terms/accept', { body: { version: terms.data.version } });
      await terms.refetch();
      onClose();
      retry();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Accept Udozo’s terms">
      <ThemedText>{terms.data?.previous_version ? 'Udozo’s terms have changed since you last accepted them.' : 'UdozoPay needs Udozo’s terms accepted once.'}</ThemedText>
      {terms.data ? <Button tone="ghost" title="Read the terms" onPress={() => WebBrowser.openBrowserAsync(`https://udozo.com${terms.data!.path}`).catch(() => undefined)} /> : null}
      <FormError error={error ?? terms.error} />
      <Button title="I accept Udozo’s terms" loading={busy} disabled={!terms.data} onPress={accept} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  lines: { gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  held: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
