/**
 * Udozo's colours, from its logo (the blue disc) and the website's default theme (apps/udozo-api/src/theme/theme.ts,
 * Udozo blue); dark mode follows the app's design board (HomeDark). The theme admins publish is laid over them at run
 * time (`src/lib/palette.ts`, `ThemeColorsProvider`).
 */

import { Platform } from 'react-native';

import { darkPalette, lightPalette } from '@/lib/palette';

export const Colors = { light: lightPalette, dark: darkPalette } as const;

export type ThemeColor = keyof typeof lightPalette;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { small: 6, medium: 12, large: 20, round: 999 } as const;

export const MaxContentWidth = 800;
