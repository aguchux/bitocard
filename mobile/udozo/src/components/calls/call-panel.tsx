import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { initials, micHelp, statusText, type CallView } from '@/lib/calls';

/** The panel's own colours: a call looks the same in light and dark mode, as udozo.com's (navy, white). */
const ink = '#ffffff';
const soft = '#9fb3c2';
const panel = '#0d1820';
const raised = 'rgba(255,255,255,0.14)';
const red = '#d92d20';
const green = '#1f9d5c';

/**
 * The call, over the whole screen while it lasts (the app goes on behind it): who it is with (their public name only,
 * never a number), the listing it is about, the state or the time, and Answer and Decline, or Mute, Speaker and End.
 * Without the microphone the call waits on a step saying how to allow it (the phone's settings when it was refused),
 * with Try again.
 */
export function CallPanel({
  view,
  onAnswer,
  onHangUp,
  onMute,
  onSpeaker,
  onClose,
  onRetry,
}: {
  view: CallView;
  onAnswer: () => void;
  onHangUp: () => void;
  onMute: () => void;
  onSpeaker: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (view.phase !== 'connected') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.phase]);
  if (view.phase === 'idle') return null;

  const name = view.call?.with.name ?? 'Your call';
  const help = view.phase === 'microphone' ? micHelp(view.microphone ?? 'blocked') : null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={view.phase === 'ended' ? onClose : () => undefined} statusBarTranslucent>
      <SafeAreaView style={[styles.screen, { backgroundColor: panel }]} accessibilityViewIsModal>
        <View style={styles.top}>
          {view.phase === 'ended' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12} style={styles.close}>
              <X size={24} color={ink} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.who} accessible accessibilityLabel={view.phase === 'incoming' ? `Incoming call from ${name}` : `Call with ${name}`}>
          <View style={[styles.circle, { backgroundColor: raised }]}>
            <ThemedText style={styles.initials}>{initials(name)}</ThemedText>
          </View>
          <ThemedText style={styles.name} numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText style={{ color: soft }} accessibilityLiveRegion="polite">
            {statusText(view, now)}
          </ThemedText>
          {view.call?.listing.title ? (
            <ThemedText style={{ color: soft }} numberOfLines={1}>{`About ${view.call.listing.title}`}</ThemedText>
          ) : null}
        </View>

        {help ? (
          <View style={styles.help}>
            <View style={[styles.note, { backgroundColor: raised }]}>
              <MicOff size={20} color="#fdb022" />
              <ThemedText style={{ color: ink, flex: 1 }}>{help.text}</ThemedText>
            </View>
            <View style={styles.row}>
              <Wide label={view.call?.role === 'callee' ? 'Decline' : 'Cancel'} color={raised} onPress={onHangUp} />
              {help.settings ? <Wide label="Open settings" color={raised} onPress={() => void Linking.openSettings()} /> : null}
              <Wide label="Try again" color={green} onPress={onRetry} />
            </View>
          </View>
        ) : view.phase === 'incoming' ? (
          <View style={styles.buttons}>
            <Round label="Decline" color={red} onPress={onHangUp} icon={<PhoneOff size={28} color={ink} />} />
            <Round label="Answer" color={green} onPress={onAnswer} icon={<Phone size={28} color={ink} />} />
          </View>
        ) : view.phase === 'ended' ? (
          <View style={styles.buttons}>
            <Wide label="Close" color={raised} onPress={onClose} />
          </View>
        ) : (
          <View style={styles.buttons}>
            <Round
              label={view.muted ? 'Unmute' : 'Mute'}
              color={view.muted ? ink : raised}
              selected={view.muted}
              disabled={view.phase !== 'connected' && view.phase !== 'connecting'}
              onPress={onMute}
              icon={view.muted ? <MicOff size={26} color={panel} /> : <Mic size={26} color={ink} />}
            />
            <Round
              label={view.phase === 'ringing' || view.phase === 'starting' ? 'Cancel the call' : 'End the call'}
              color={red}
              onPress={onHangUp}
              icon={<PhoneOff size={28} color={ink} />}
            />
            <Round
              label={view.speaker ? 'Speaker off' : 'Speaker'}
              color={view.speaker ? ink : raised}
              selected={view.speaker}
              onPress={onSpeaker}
              icon={view.speaker ? <Volume2 size={26} color={panel} /> : <VolumeX size={26} color={ink} />}
            />
          </View>
        )}

        <View style={styles.privacy}>
          <ShieldCheck size={16} color={soft} />
          <ThemedText type="small" style={{ color: soft, flex: 1 }}>
            A private Udozo call: no numbers are shared, and it is not recorded.
          </ThemedText>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Round({ label, color, icon, onPress, disabled, selected }: { label: string; color: string; icon: ReactNode; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return (
    <View style={styles.roundWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.round, { backgroundColor: color, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
        {icon}
      </Pressable>
      <ThemedText type="small" style={{ color: soft }} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </ThemedText>
    </View>
  );
}

function Wide({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.wide, { backgroundColor: color, opacity: pressed ? 0.85 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: ink }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: Spacing.four, justifyContent: 'space-between' },
  top: { minHeight: 48, alignItems: 'flex-end', paddingTop: Spacing.two },
  close: { padding: Spacing.two },
  who: { alignItems: 'center', gap: Spacing.two },
  circle: { width: 112, height: 112, borderRadius: Radius.round, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.three },
  initials: { color: ink, fontSize: 40, lineHeight: 48, fontWeight: '700' },
  name: { color: ink, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  help: { gap: Spacing.three },
  note: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.medium },
  row: { flexDirection: 'row', gap: Spacing.two },
  buttons: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  roundWrap: { alignItems: 'center', gap: Spacing.two },
  round: { width: 72, height: 72, borderRadius: Radius.round, alignItems: 'center', justifyContent: 'center' },
  wide: { flex: 1, minHeight: 48, borderRadius: Radius.medium, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  privacy: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', paddingVertical: Spacing.three },
});
