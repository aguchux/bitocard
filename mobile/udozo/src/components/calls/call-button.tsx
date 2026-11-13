import type { ShopConversation, ShopViewer } from '@shared/classifieds';
import { PhoneCall } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCalls } from '@/components/calls/call-provider';
import { chatCallButton, listingCallButton, type CallButton } from '@/lib/calls';

/**
 * Call seller on a listing, where the viewer says calls are offered (`calls`): pressed, it rings the seller through the
 * call panel, whose ended screen gives the API's refusal in words. While the seller is not on Udozo (or a call is
 * going on) it shows greyed, and pressing it says why. `wide` for a listing that takes calls only.
 */
export function CallSellerButton({ listingId, viewer, wide }: { listingId: string; viewer: ShopViewer | null; wide?: boolean }) {
  const calls = useCalls();
  if (!calls) return null;
  const state = listingCallButton(viewer, calls.busy);
  if (!state.show) return null;
  const call = () => calls.start({ listing_id: listingId });
  return wide ? (
    <View style={{ flex: 1 }}>
      <Button title="Call seller" accessibilityLabel={state.ready ? 'Call seller' : `Call seller. ${state.hint}`} tone={state.ready ? 'primary' : 'secondary'} icon={<CallIcon ready={state.ready} />} onPress={() => press(state, call, 'Call seller')} />
    </View>
  ) : (
    <CallIconButton label="Call seller" state={state} onPress={call} />
  );
}

/** Call in a chat's header, where the chat says it can be made (`can_call`); greyed with why while they are away. */
export function ChatCallButton({ chat }: { chat: Pick<ShopConversation, 'id' | 'can_call' | 'with'> }) {
  const calls = useCalls();
  if (!calls) return null;
  const state = chatCallButton(chat, calls.busy);
  if (!state.show) return null;
  return <CallIconButton label={`Call ${chat.with.name}`} state={state} onPress={() => calls.start({ conversation_id: chat.id })} plain />;
}

function press(state: CallButton, call: () => void, title: string) {
  if (state.ready) call();
  else Alert.alert(title, state.hint);
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
      onPress={() => press(state, onPress, label)}
      style={plain ? undefined : [styles.box, { borderColor: theme.line }]}>
      <PhoneCall size={22} color={state.ready ? theme.primary : theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: 48, height: 48, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
