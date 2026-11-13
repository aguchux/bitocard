import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ToastHost, ToastStateContext, type ToastState } from '@/components/toast-host';
import { Button } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { dialogButtons, dropToast, queueToast, toastDuration, type DialogOptions, type Toast, type ToastInput } from '@/lib/feedback';

export type { DialogAction, DialogOptions, ToastInput } from '@/lib/feedback';
export { infoDialog } from '@/lib/feedback';

/**
 * Udozo's own way of telling people things, never the phone's alerts: a dialog in Udozo's colours for questions (and
 * an info dialog with a single OK), and toasts for outcomes. `FeedbackProvider` is mounted once in the root layout;
 * screens use `useDialog()` and `useToast()`.
 */
type Feedback = { ask: (options: DialogOptions) => Promise<string | null>; show: (toast: ToastInput) => void };

const FeedbackContext = createContext<Feedback | null>(null);

type Question = { id: number; options: DialogOptions; resolve: (key: string | null) => void };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const made = useRef(0);

  const ask = useCallback((options: DialogOptions) => new Promise<string | null>(resolve => setQuestions(current => [...current, { id: ++made.current, options, resolve }])), []);
  const show = useCallback((toast: ToastInput) => setToasts(current => queueToast(current, { ...toast, tone: toast.tone ?? 'info', id: ++made.current })), []);
  const dismiss = useCallback((id: number) => setToasts(current => dropToast(current, id)), []);
  const register = useCallback((host: string, base?: boolean) => setHosts(current => (base ? [host, ...current.filter(item => item !== host)] : [...current.filter(item => item !== host), host])), []);
  const unregister = useCallback((host: string) => setHosts(current => current.filter(item => item !== host)), []);

  // The toast showing hides by itself once its time is up; the next waiting one then shows.
  const toast = toasts[0] ?? null;
  useEffect(() => {
    if (!toast) return;
    // Android reads it from the toast's live region; iPhones need telling.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
    const timer = setTimeout(() => dismiss(toast.id), toastDuration(toast));
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  const answer = (key: string | null) => {
    const [first] = questions;
    if (!first) return;
    setQuestions(current => current.slice(1));
    first.resolve(key);
  };

  const feedback = useMemo(() => ({ ask, show }), [ask, show]);
  const state = useMemo<ToastState>(() => ({ toast, top: hosts.at(-1) ?? null, dismiss, register, unregister }), [toast, hosts, dismiss, register, unregister]);
  return (
    <FeedbackContext.Provider value={feedback}>
      <ToastStateContext.Provider value={state}>
        <View style={styles.root}>
          {children}
          <ToastHost base />
        </View>
        {questions[0] ? <DialogView key={questions[0].id} options={questions[0].options} onAnswer={answer} /> : null}
      </ToastStateContext.Provider>
    </FeedbackContext.Provider>
  );
}

function useFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('useDialog and useToast need FeedbackProvider (the root layout mounts it).');
  return feedback;
}

/** Asks a question in Udozo's dialog: resolves with the chosen action's key, or null when dismissed (Cancel, the backdrop, Back). */
export function useDialog() {
  return useFeedback().ask;
}

/** Shows a toast at the top of the screen: success, error or info, with an optional action. */
export function useToast() {
  return useFeedback().show;
}

/**
 * The dialog: a rounded card centred over a dimmed backdrop, the title as a header, plain words, then the way out and
 * the actions stacked full width. A short fade and scale in, none with reduced motion. Its own `ToastHost`, so a toast
 * shown while it is open is still seen.
 */
export function DialogView({ options, onAnswer }: { options: DialogOptions; onAnswer: (key: string | null) => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [shown] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) shown.setValue(1);
    else Animated.timing(shown, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [reduced, shown]);
  const buttons = dialogButtons(options);
  return (
    <Modal testID="dialog-modal" visible transparent animationType="none" statusBarTranslucent onRequestClose={() => onAnswer(null)}>
      <View style={styles.centre}>
        <Pressable testID="dialog-backdrop" accessible={false} style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => onAnswer(null)} />
        <Animated.View
          accessibilityViewIsModal
          testID="dialog"
          style={[
            styles.card,
            { backgroundColor: theme.background, borderColor: theme.line },
            { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
          ]}>
          <ThemedText type="heading" accessibilityRole="header">
            {options.title}
          </ThemedText>
          {options.body ? <ThemedText themeColor="textSecondary">{options.body}</ThemedText> : null}
          <View style={styles.actions}>
            {buttons.map(button => (
              <Button key={button.key ?? 'dismiss'} title={button.label} tone={button.tone} onPress={() => onAnswer(button.key)} />
            ))}
          </View>
        </Animated.View>
        <ToastHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  backdrop: { backgroundColor: 'rgba(8, 18, 26, 0.55)' },
  card: { width: '100%', maxWidth: Math.min(MaxContentWidth, 420), gap: Spacing.three, padding: Spacing.four, borderRadius: Radius.large, borderWidth: StyleSheet.hairlineWidth },
  actions: { gap: Spacing.two, marginTop: Spacing.one },
});
