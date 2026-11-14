import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The full-bleed banner a public page opens with (a seller's, a brand's, a category's): from the top of the screen under
 * the status bar, a photo with a see-through dark fade or a gradient, what the page is about at its foot, and round
 * buttons floating over it. The page hides its stack header and puts `FloatingBar` above its list.
 */

/** The banner's height below the status bar. */
export const bannerHeight = 236;

/** White status bar text over the banner while the page shows, the phone's own again on leaving. */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, []),
  );
}

/**
 * The banner itself. With `image`, the photo under a dark fade; else a corner-to-corner gradient from `tint` (the theme's
 * accent and primary by default) to a darker shade, with a light fade at the foot so white words stay readable.
 */
export function PageBanner({ testID, top, image, tint, children }: { testID?: string; top: number; image?: string | null; tint?: { from: string; to: string }; children: ReactNode }) {
  const theme = useTheme();
  const from = tint?.from ?? theme.accent;
  const to = tint?.to ?? theme.primary;
  // The fades are drawn at the banner's measured size: an SVG sized by percentages is not always laid out over the whole
  // of it on Android.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      testID={testID}
      onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      style={[styles.banner, { height: top + bannerHeight, backgroundColor: to }]}>
      {image ? (
        <>
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          {size ? <Fade id="cover" size={size} stops={[['#000000', 0.35, 0], ['#000000', 0, 0.3], ['#000000', 0.15, 0.5], ['#000000', 0.75, 1]]} /> : null}
        </>
      ) : (
        <>
          {size ? <Fade id="theme" size={size} diagonal stops={[[from, 1, 0], [to, 1, 0.55], [shade(to, 0.55), 1, 1]]} /> : null}
          {size ? <Fade id="foot" size={size} stops={[['#000000', 0, 0.5], ['#000000', 0.3, 1]]} /> : null}
        </>
      )}
      {children}
    </View>
  );
}

/**
 * A gradient over the whole banner, top to bottom or corner to corner: each stop a colour, its opacity and where it
 * sits. Opacity goes in `stopOpacity`, never as an rgba colour, which Android draws opaque (a black block over the cover).
 */
export function Fade({ id, stops, diagonal, size }: { id: string; stops: [string, number, number][]; diagonal?: boolean; size: { width: number; height: number } }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={diagonal ? '1' : '0'} y2="1">
          {stops.map(([color, opacity, offset]) => (
            <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={size.width} height={size.height} fill={`url(#${id})`} />
    </Svg>
  );
}

/** A `#rrggbb` colour darkened towards black by `amount` (0 to 1); anything else unchanged. */
export function shade(hex: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const part = (shift: number) => Math.round(((value >> shift) & 255) * (1 - amount)).toString(16).padStart(2, '0');
  return `#${part(16)}${part(8)}${part(0)}`;
}

/** A colour's relative luminance (0 black, 1 white); null for anything but `#rrggbb`. */
function luminance(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** A colour dark enough for white words on it: darkened a step at a time until it is (a pale yellow brand included). */
export function readable(hex: string) {
  let colour = hex;
  for (let step = 0; step < 9 && (luminance(colour) ?? 0) > 0.18; step++) colour = shade(colour, 0.15);
  return colour;
}

/** A small white label on a see-through white pill, for the banner's foot. */
export function BannerChip({ children, icon }: { children: string; icon?: ReactNode }) {
  return (
    <View style={styles.chip}>
      {icon}
      <ThemedText type="caption" style={styles.light}>{children}</ThemedText>
    </View>
  );
}

/** The banner's large white name, shadowed a little so it reads over any photo. */
export function BannerTitle({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return (
    <ThemedText type="title" accessibilityRole="header" numberOfLines={2} style={[styles.name, style]}>
      {children}
    </ThemedText>
  );
}

/** A white icon in a translucent dark circle, 44 points: readable over the banner and over the listings alike. */
export function RoundButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.round}>
      {children}
    </Pressable>
  );
}

/** The buttons floating over the top of the page, under the status bar: `left` (Back) and `right` (what to do). */
export function FloatingBar({ top, left, right }: { top: number; left: ReactNode; right?: ReactNode }) {
  return (
    <View pointerEvents="box-none" style={[styles.topBar, { top: top + Spacing.one }]}>
      {left}
      <View style={styles.actions}>{right}</View>
    </View>
  );
}

export const bannerStyles = StyleSheet.create({
  /** The row at the banner's foot: a picture, then the words beside it. */
  who: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  light: { color: '#ffffff' },
  /** A pill-shaped floating button with words (Edit profile), the same dark as `RoundButton`. */
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, backgroundColor: 'rgba(0,0,0,0.38)' },
});

const styles = StyleSheet.create({
  // The list has side padding: the banner reaches past it to the screen's edges.
  banner: { marginHorizontal: -Spacing.three, overflow: 'hidden', justifyContent: 'flex-end', paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  name: { color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  light: { color: '#ffffff' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.round, paddingHorizontal: Spacing.two + 2, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  topBar: { position: 'absolute', left: Spacing.two, right: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
});
