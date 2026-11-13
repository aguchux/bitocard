import type { ShopConversation, ShopViewer } from '@shared/classifieds';
import { PhoneCall } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { infoDialog, useDialog, type DialogOptions } from '@/components/feedback';
import { Button } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCalls } from '@/components/calls/call-provider';
import { chatCallButton, listingCallButton, type CallButton } from '@/lib/calls';

/**
 * Call seller on a listing, where the viewer says calls are offered (`calls`): pressed, it rings the seller through the
 * call panel, whose ended screen gives the API's refusal in words. While the seller is not on Udozo (or a call is
 * going on) it shows greyed, and pressing it says why in Udozo's dialog, offering what the listing allows instead:
 * `onChat` (Chat with seller) and `onCallback` (Request call back). `wide` for a listing that takes calls only.
 */
export function CallSellerButton({ listingId, viewer, wide, onChat, onCallback }: { listingId: string; viewer: ShopViewer | null; wide?: boolean; onChat?: () => void; onCallback?: () => void }) {
  const calls = useCalls();
  const ask = useDialog();
  if (!calls) return null;
  const state = listingCallButton(viewer, calls.busy);
  if (!state.show) return null;
  const call = () => calls.start({ listing_id: listingId });
  const instead = calls.busy ? {} : { chat: onChat, callback: onCallback };
  const press = () => (state.ready ? call() : void whyNot(ask, 'Call seller', state, instead));
  return wide ? (
    <View style={{ flex: 1 }}>
      <Button title="Call seller" accessibilityLabel={state.ready ? 'Call seller' : `Call seller. ${state.hint}`} tone={state.ready ? 'primary' : 'secondary'} icon={<CallIcon ready={state.ready} />} onPress={press} />
    </View>
  ) : (
    <CallIconButton label="Call seller" state={state} onPress={press} />
  );
}

/** Call in a chat's header, where the chat says it can be made (`can_call`); greyed with why while they are away. */
export function ChatCallButton({ chat }: { chat: Pick<ShopConversation, 'id' | 'can_call' | 'with'> }) {
  const calls = useCalls();
  const ask = useDialog();
  if (!calls) return null;
  const state = chatCallButton(chat, calls.busy);
  if (!state.show) return null;
  const label = `Call ${chat.with.name}`;
  return <CallIconButton label={label} state={state} onPress={() => (state.ready ? calls.start({ conversation_id: chat.id }) : void whyNot(ask, label, state, {}))} plain />;
}

/** Why the call cannot be made now, with the other ways in touch the listing allows (each then done), else Close. */
async function whyNot(ask: (options: DialogOptions) => Promise<string | null>, title: string, state: CallButton, instead: { chat?: () => void; callback?: () => void }) {
  const actions = [instead.chat ? { key: 'chat', label: 'Chat with seller' } : null, instead.callback ? { key: 'callback', label: 'Request call back', tone: 'secondary' as const } : null].filter(action => action !== null);
  const answer = await ask(actions.length ? { title, body: state.hint, actions, dismiss: 'Close' } : infoDialog(title, state.hint));
  if (answer === 'chat') instead.chat?.();
  if (answer === 'callback') instead.callback?.();
}

function CallIcon({ ready }: { ready: boolean }) {
  const theme = useTheme();
  return <PhoneCall size={20} color={ready ? theme.onPrimary : theme.textSecondary} />;
}

function CallIconButton({ label, state, onPress, plain }: { label: string; state: CallButton; onPress: () => void; plain?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={state.hint}
      accessibilityState={{ disabled: !state.ready }}
      hitSlop={10}
      onPress={onPress}
      style={plain ? undefined : [styles.box, { borderColor: theme.line }]}>
      <PhoneCall size={22} color={state.ready ? theme.primary : theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: 48, height: 48, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
