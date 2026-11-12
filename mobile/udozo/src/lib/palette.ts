/**
 * The app's colours: Udozo's own (the website's default theme), with the theme Udozo's admins publish (`GET /v1/theme`:
 * primary, accent, ink and page, each already checked for readable contrast by the API) laid over the light palette.
 * The dark palette stays the app's own, since the admins' colours are checked against a light page only. Kept free of
 * React Native so it runs under `node --test`.
 */

export type ThemeColors = { primary: string; accent: string; ink: string; page: string };

export const lightPalette = {
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
};

export type Palette = typeof lightPalette;

export const darkPalette: Palette = {
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
};

const hex = /^#[0-9a-fA-F]{6}$/;

/** Only well-formed colours are taken: anything else keeps Udozo's own. */
export function themed(scheme: 'light' | 'dark', published?: Partial<ThemeColors> | null): Palette {
  if (scheme === 'dark' || !published) return scheme === 'dark' ? darkPalette : lightPalette;
  const take = (value: string | undefined, fallback: string) => (value && hex.test(value) ? value : fallback);
  const accent = take(published.accent, lightPalette.accent);
  return {
    ...lightPalette,
    primary: take(published.primary, lightPalette.primary),
    accent,
    link: accent,
    text: take(published.ink, lightPalette.text),
    background: take(published.page, lightPalette.background),
  };
}
