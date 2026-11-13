import { AlertCircle, CircleCheck, Info } from 'lucide-react-native';
import { createContext, useContext, useEffect, useId, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { inter, ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import type { Toast } from '@/lib/feedback';

/**
 * Where toasts are drawn. React Native's `Modal` sits above the rest of the app (on Android a window of its own), so a
 * toast drawn only at the root would hide behind an open sheet or dialog. Every place that can be on top (the root, each
 * `Sheet`, Udozo's dialog) holds a `ToastHost`; hosts register as they mount, and only the newest draws the toast, so it
 * shows above whatever is open. Apart from `feedback.tsx` so `ui.tsx`'s `Sheet` can hold one without an import cycle.
 */
export type ToastState = {
  toast: Toast | null;
  top: string | null;
  dismiss: (id: number) => void;
  register: (host: string, base?: boolean) => void;
  unregister: (host: string) => void;
};

export const ToastStateContext = createContext<ToastState | null>(null);

/** `base` is the root's host: always under the rest, though its effect runs after theirs (it is drawn last). */
export function ToastHost({ base }: { base?: boolean }) {
  const state = useContext(ToastStateContext);
  const host = useId();
  const register = state?.register;
  const unregister = state?.unregister;
  useEffect(() => {
    if (!register || !unregister) return;
    register(host, base);
    return () => unregister(host);
  }, [host, base, register, unregister]);
  if (!state?.toast || state.top !== host) return null;
  return <ToastView key={state.toast.id} toast={state.toast} onDismiss={() => state.dismiss(state.toast!.id)} />;
}

/** A card dropped in at the top, under the notch: the tone's icon, the words, and an action where there is one. */
function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext);
  const [shown] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) shown.setValue(1);
    else Animated.timing(shown, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [reduced, shown]);
  const colour = toast.tone === 'success' ? theme.success : toast.tone === 'error' ? theme.danger : theme.primary;
  const Icon = toast.tone === 'success' ? CircleCheck : toast.tone === 'error' ? AlertCircle : Info;
  return (
    <View pointerEvents="box-none" style={[styles.place, { top: (insets?.top ?? 0) + Spacing.two }]}>
      <Animated.View style={{ opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }}>
        <Pressable
          testID="toast"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={toast.message}
          accessibilityHint="Tap to close"
          onPress={onDismiss}
          style={[styles.card, { backgroundColor: theme.background, borderColor: theme.line, borderLeftColor: colour }]}>
          <Icon size={20} color={colour} />
          <ThemedText type="small" style={styles.words}>
            {toast.message}
          </ThemedText>
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              hitSlop={10}
              onPress={() => {
                toast.action!.onPress();
                onDismiss();
              }}>
              <ThemedText type="smallBold" style={{ color: theme.link, fontFamily: inter.bold }}>
                {toast.action.label}
              </ThemedText>
            </Pressable>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: Spacing.three, right: Spacing.three, zIndex: 1000, elevation: 1000 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
    minHeight: 48,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  words: { flex: 1, fontFamily: inter.semibold },
});
