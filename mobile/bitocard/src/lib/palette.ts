/**
 * BitoCard's colours: bitocard.com's navy and pink (the "b" mark), as on the approved app designs. Dark mode keeps the
 * pink and turns the navy into the page. Text pinks are a darker shade so they pass 4.5:1 on white.
 */
export const lightPalette = {
  navy: '#070f4c',
  pink: '#ff2382',
  pinkText: '#d10f5f',
  pinkSoft: '#ffe4ef',
  background: '#f6f7fb',
  card: '#ffffff',
  text: '#070f4c',
  textSecondary: '#4b5374',
  line: '#e4e7f0',
  field: '#cdd2e3',
  onNavy: '#ffffff',
  onNavySecondary: '#c9cde4',
  good: '#047857',
  goodSoft: '#dcf5e8',
  warn: '#8a4b08',
  warnSoft: '#fdefd9',
  bad: '#b91c1c',
  badSoft: '#fde4e4',
} as const;

export type Palette = { [K in keyof typeof lightPalette]: string };

export const darkPalette: Palette = {
  navy: '#1a2470',
  pink: '#ff2382',
  pinkText: '#ff6fab',
  pinkSoft: '#3a1530',
  background: '#050a33',
  card: '#0d1650',
  text: '#f2f3fa',
  textSecondary: '#aab1d3',
  line: '#232c66',
  field: '#3a4380',
  onNavy: '#ffffff',
  onNavySecondary: '#c9cde4',
  good: '#34d399',
  goodSoft: '#0b3326',
  warn: '#fbbf24',
  warnSoft: '#3a2a08',
  bad: '#f87171',
  badSoft: '#3d1212',
};
