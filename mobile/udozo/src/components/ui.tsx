import { nameInitials } from '@shared/classifieds';
import { Image } from 'expo-image';
import { AlertCircle, WifiOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { inter, ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost';

/** A button, at least 48 px tall: primary (the theme's), secondary (outlined), danger (red) or ghost (a link). */
export function Button({ title, onPress, tone = 'primary', loading, disabled, icon, style, accessibilityLabel }: {
  title: string;
  onPress?: PressableProps['onPress'];
  tone?: Tone;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const fill = tone === 'primary' ? theme.primary : tone === 'danger' ? theme.danger : 'transparent';
  const ink = tone === 'primary' || tone === 'danger' ? theme.onPrimary : tone === 'ghost' ? theme.link : theme.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: fill, borderColor: tone === 'secondary' ? theme.line : fill, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        tone === 'ghost' && styles.ghost,
        style,
      ]}>
      {loading ? <ActivityIndicator color={ink} /> : icon}
      <ThemedText style={{ color: ink, fontFamily: inter.bold }}>{title}</ThemedText>
    </Pressable>
  );
}

/** A labelled text field, with the API's refusal under it when it is about this field. */
export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: error ? theme.danger : theme.line, color: theme.text, backgroundColor: theme.background }]}
        {...input}
      />
      {error ? <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText> : hint ? <ThemedText type="caption">{hint}</ThemedText> : null}
    </View>
  );
}

/** A selectable chip (filters, tabs, reasons). */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? theme.primary : theme.line, backgroundColor: selected ? theme.primary : theme.background }]}>
      <ThemedText type="smallBold" style={{ color: selected ? theme.onPrimary : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.line }, style]}>{children}</View>;
}

/** A stacked page with the notch cleared: the content is scrollable and never wider than a tablet's column. */
export function Page({ children, edges = ['top'], scroll = true, padded = true }: { children: ReactNode; edges?: ('top' | 'bottom')[]; scroll?: boolean; padded?: boolean }) {
  const theme = useTheme();
  const body = <View style={[styles.column, padded && styles.padded]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Spacing.six }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

/** A sheet pulled up from the bottom (confirmations, choices, a first message), closed by its backdrop or Back. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="heading" accessibilityRole="header">
            {title}
          </ThemedText>
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Someone's photo, or their initials on the theme's colour. */
export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const theme = useTheme();
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />;
  return (
    <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText style={{ color: theme.onPrimary, fontFamily: inter.bold, fontSize: size * 0.38 }}>{nameInitials(name) || '?'}</ThemedText>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.state} accessibilityLabel={label}>
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

/** Nothing here yet: what it is and what to do. */
export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.state}>
      <ThemedText type="heading" style={styles.centre}>
        {title}
      </ThemedText>
      {body ? <ThemedText type="small" themeColor="textSecondary" style={styles.centre}>{body}</ThemedText> : null}
      {action}
    </View>
  );
}

/** What went wrong, in the API's words (or no internet), with Try again. */
export function Failed({ error, retry }: { error: unknown; retry?: () => void }) {
  const theme = useTheme();
  const offline = error instanceof ApiError && error.code === 'network_error';
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      {offline ? <WifiOff color={theme.textSecondary} size={28} /> : <AlertCircle color={theme.danger} size={28} />}
      <ThemedText style={styles.centre}>{offline ? 'You are offline. Check your connection.' : message}</ThemedText>
      {retry ? <Button title="Try again" tone="secondary" onPress={retry} /> : null}
    </View>
  );
}

/** A line of the API's refusal on a form. */
export function FormError({ error }: { error: unknown }) {
  const theme = useTheme();
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : String((error as Error)?.message ?? error);
  return (
    <View accessibilityLiveRegion="assertive" style={[styles.formError, { backgroundColor: '#fdecea' }]}>
      <AlertCircle color={theme.danger} size={18} />
      <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>{message}</ThemedText>
    </View>
  );
}

/** The API's refusal is about this field (`param`). */
export const fieldError = (error: unknown, param: string) => (error instanceof ApiError && error.param === param ? error.message : null);

export const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: Radius.medium, borderWidth: 1, paddingHorizontal: Spacing.four, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  ghost: { minHeight: 44, paddingHorizontal: Spacing.two },
  field: { gap: Spacing.one },
  input: { minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, fontFamily: inter.regular, fontSize: 16 },
  chip: { minHeight: 36, paddingHorizontal: Spacing.three, borderRadius: Radius.round, borderWidth: 1, justifyContent: 'center' },
  card: { borderRadius: Radius.medium, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  padded: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  state: { padding: Spacing.five, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  centre: { textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: Spacing.four, gap: Spacing.three, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  formError: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.medium, alignItems: 'center' },
});
