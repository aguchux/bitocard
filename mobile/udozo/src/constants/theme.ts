/**
 * Udozo's colours, from its logo (the blue disc) and the website's default theme (apps/udozo-api/src/theme/theme.ts,
 * Udozo blue). Dark mode follows the app's design board (HomeDark). The theme admins publish (`/v1/theme`) will
 * re-point `primary` and `accent` once the app reads it.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#10212e',
    textSecondary: '#5b6b78',
    background: '#ffffff',
    backgroundElement: '#f3f5f6',
    backgroundSelected: '#e1e6ea',
    line: '#e1e6ea',
    primary: '#185174',
    onPrimary: '#ffffff',
    accent: '#0e7cc0',
    link: '#0e7cc0',
    success: '#1f7a4d',
    danger: '#b42318',
  },
  dark: {
    text: '#e6edf2',
    textSecondary: '#9fb3c2',
    background: '#0d1820',
    backgroundElement: '#172734',
    backgroundSelected: '#22384a',
    line: '#22384a',
    primary: '#2b7bb0',
    onPrimary: '#ffffff',
    accent: '#7cc2ee',
    link: '#7cc2ee',
    success: '#5cc28f',
    danger: '#f97066',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
