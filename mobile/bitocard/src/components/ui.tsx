import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { darkPalette, lightPalette, type Palette } from '@/lib/palette';

/** Inter, as bitocard.com: the families the root layout loads. */
export const inter = { regular: 'Inter_400Regular', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold', extrabold: 'Inter_800ExtraBold' } as const;

/** The colours to draw with: light or dark as the phone is set. */
export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

type Kind = 'body' | 'small' | 'caption' | 'title' | 'heading' | 'label' | 'amount';

const type = StyleSheet.create({
  body: { fontFamily: inter.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: inter.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: inter.regular, fontSize: 12, lineHeight: 16 },
  title: { fontFamily: inter.extrabold, fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  heading: { fontFamily: inter.bold, fontSize: 17, lineHeight: 22 },
  label: { fontFamily: inter.semibold, fontSize: 14, lineHeight: 20 },
  amount: { fontFamily: inter.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
});

/** Text in the theme's colours; it scales with the phone's text size. */
export function T({ kind = 'body', muted, color, style, ...rest }: TextProps & { kind?: Kind; muted?: boolean; color?: string }) {
  const theme = useTheme();
  return <Text style={[{ color: color ?? (muted ? theme.textSecondary : theme.text) }, type[kind], style]} {...rest} />;
}

/** A screen's scrolling page, inside the phone's safe area (the top edge only where there is no header). */
export function Page({ children, header = true, style }: { children: ReactNode; header?: boolean; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={header ? ['left', 'right'] : ['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={[styles.page, style]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }, style]}>{children}</View>;
}

/** A button: `primary` navy, `accent` pink, `secondary` outlined, `onNavy` outlined in white on a navy page. Busy shows a spinner and ignores taps. */
export function Button({ label, onPress, kind = 'primary', busy, disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'accent' | 'secondary' | 'onNavy'; busy?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  const background = kind === 'primary' ? theme.navy : kind === 'accent' ? theme.pink : 'transparent';
  const color = kind === 'secondary' ? theme.text : '#ffffff';
  const border = kind === 'secondary' ? theme.field : kind === 'onNavy' ? 'rgba(255,255,255,0.35)' : background;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

/** A labelled text field; the label is its accessible name. */
export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T kind="label">{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: error ? theme.bad : theme.field, color: theme.text, backgroundColor: theme.card }]}
        {...input}
      />
      {error ? <T kind="small" color={theme.bad}>{error}</T> : hint ? <T kind="small" muted>{hint}</T> : null}
    </View>
  );
}

/** A message in a tinted box: `warn` amber, `bad` red, `good` green. */
export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const theme = useTheme();
  const colors = { warn: [theme.warnSoft, theme.warn], bad: [theme.badSoft, theme.bad], good: [theme.goodSoft, theme.good] }[tone];
  return (
    <View accessibilityRole={tone === 'bad' ? 'alert' : undefined} style={[styles.notice, { backgroundColor: colors[0] }]}>
      <T kind="small" color={colors[1]}>
        {children}
      </T>
    </View>
  );
}

/** A choice among a few (a network, an amount): selected is navy, or pink-ringed with `ring`. */
export function Chip({ label, selected, onPress, ring }: { label: string; selected: boolean; onPress: () => void; ring?: boolean }) {
  const theme = useTheme();
  const filled = selected && !ring;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: filled ? theme.navy : theme.card, borderColor: selected ? (ring ? theme.pink : theme.navy) : theme.line, borderWidth: selected && ring ? 2 : 1 }]}>
      <Text style={[styles.chipText, { color: filled ? '#ffffff' : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Two to four tabs in a grey track (Airtime or Data, a wallet each, order filters). */
export function Segmented<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string }[]; value: K; onChange: (key: K) => void; label: string }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: theme.line }]}>
      {options.map(option => {
        const on = option.key === value;
        return (
          <Pressable key={option.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(option.key)} style={[styles.segment, on && { backgroundColor: theme.card }]}>
            <Text style={[styles.chipText, { color: on ? theme.text : theme.textSecondary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A label and its value on one line (a receipt's lines). */
export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <T muted style={{ flex: 1 }}>
        {label}
      </T>
      <T kind={strong ? 'heading' : 'body'} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </T>
    </View>
  );
}

export const styles = StyleSheet.create({
  chip: { minHeight: 48, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: inter.bold, fontSize: 15 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 14, gap: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  page: { padding: 20, gap: 18, paddingBottom: 40 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  button: { minHeight: 54, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonText: { fontFamily: inter.bold, fontSize: 16 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontFamily: inter.regular, fontSize: 16 },
  notice: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
});
