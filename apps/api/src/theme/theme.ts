/**
 * The product's colour theme (docs/UDOZO_SPINOFF_PLAN.md, step 3): four colours every app reads as its colour variables,
 * chosen by the product's admins from ready-made themes or set by hand, each checked for readable contrast.
 */
export type ThemeColors = {
  /** Buttons, links and the header's highlights (white text sits on it). */
  primary: string;
  /** Badges, prices and the second highlight. */
  accent: string;
  /** Body text. */
  ink: string;
  /** The page behind everything. */
  page: string;
};

export const themeColorKeys = ['primary', 'accent', 'ink', 'page'] as const satisfies ReadonlyArray<keyof ThemeColors>;

export type ThemePreset = { key: string; name: string; colors: ThemeColors };

/** Ready-made themes; the first is the default until the admins choose (BitoCard's navy and pink). */
export const themePresets: ThemePreset[] = [
  { key: 'navy_pink', name: 'Navy and pink', colors: { primary: '#070f4c', accent: '#d6136a', ink: '#0f172a', page: '#ffffff' } },
  { key: 'forest', name: 'Forest', colors: { primary: '#14532d', accent: '#b45309', ink: '#111827', page: '#ffffff' } },
  { key: 'ocean', name: 'Ocean', colors: { primary: '#0c4a6e', accent: '#0e7490', ink: '#0f172a', page: '#ffffff' } },
  { key: 'sunset', name: 'Sunset', colors: { primary: '#9a3412', accent: '#be185d', ink: '#1c1917', page: '#fffbf5' } },
];

export const defaultTheme = themePresets[0];

/** A `#rrggbb` colour, lower case. */
export const hexColor = /^#[0-9a-f]{6}$/;

/** The WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** What each colour must reach against the colour it sits on: text 4.5 to 1 (WCAG AA), highlights 3 to 1. */
export const contrastRules: Array<{ color: keyof ThemeColors; against: keyof ThemeColors | 'white'; min: number; why: string }> = [
  { color: 'ink', against: 'page', min: 4.5, why: 'Body text must be readable on the page' },
  { color: 'primary', against: 'white', min: 4.5, why: 'White text on buttons must be readable' },
  { color: 'primary', against: 'page', min: 3, why: 'Buttons and links must stand out from the page' },
  { color: 'accent', against: 'page', min: 3, why: 'Badges and prices must stand out from the page' },
];

/** The first colour that is not readable enough, with why, or null. */
export function contrastProblem(colors: ThemeColors) {
  for (const rule of contrastRules) {
    const against = rule.against === 'white' ? '#ffffff' : colors[rule.against];
    const ratio = contrast(colors[rule.color], against);
    if (ratio < rule.min) return { param: rule.color, message: `${rule.why}: ${ratio.toFixed(2)} to 1, at least ${rule.min} to 1 needed.` };
  }
  return null;
}
