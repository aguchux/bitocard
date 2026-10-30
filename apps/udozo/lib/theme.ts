import "server-only";
import { apiUrl } from "./api";
import { previewToken } from "./theme-preview";

export { previewHeader } from "./theme-preview";

/**
 * Udozo's colour theme, chosen by its admins (`GET /v1/theme`, docs/UDOZO_SPINOFF_PLAN.md step 3): `primary` for
 * buttons and headings (white text sits on it), `accent` for highlights, badges and prices, `ink` for body text and
 * `page` behind everything. Applied on `<html>` as the colour variables every Tailwind utility reads, so the whole site
 * follows; until the admins publish one, the API answers its default (navy and pink), as does this site while the API
 * cannot be reached.
 */
export type ThemeColors = { primary: string; accent: string; ink: string; page: string };

export type Theme = { colors: ThemeColors; preview: boolean };

export const fallbackTheme: ThemeColors = { primary: "#070f4c", accent: "#d6136a", ink: "#0f172a", page: "#ffffff" };

const hex = /^#[0-9a-f]{6}$/i;

function colorsOf(value: unknown): ThemeColors | null {
  const colors = (value as { colors?: Partial<ThemeColors> } | null)?.colors;
  if (!colors) return null;
  const { primary, accent, ink, page } = colors;
  return [primary, accent, ink, page].every(color => typeof color === "string" && hex.test(color)) ? { primary: primary!, accent: accent!, ink: ink!, page: page! } : null;
}

/**
 * The published theme, cached a minute (the API says the same), or the draft through a valid preview token (never
 * cached). Never throws: an unreachable API, an expired preview or a malformed answer is the fallback (or, for a
 * preview that failed, the published theme).
 */
export async function siteTheme(preview?: string | null): Promise<Theme> {
  const token = previewToken(preview);
  if (token) {
    const draft = await read(`/v1/theme?preview=${encodeURIComponent(token)}`, true);
    if (draft) return { colors: draft, preview: true };
  }
  return { colors: (await read("/v1/theme", false)) ?? fallbackTheme, preview: false };
}

async function read(path: string, fresh: boolean): Promise<ThemeColors | null> {
  try {
    const res = await fetch(apiUrl(path), fresh ? { cache: "no-store" } : { next: { revalidate: 60, tags: ["theme"] } });
    return res.ok ? colorsOf(await res.json()) : null;
  } catch {
    return null;
  }
}

const mix = (color: string, other: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, ${other})`;

/**
 * The CSS variables for a theme: the navy scale from `primary` (buttons, headings, dark panels, with its lighter tones
 * mixed towards white for quiet text, borders and soft panels), the pink (brand) scale from `accent`, body text from
 * `ink` and the page from `page`.
 */
export function themeVars({ primary, accent, ink, page }: ThemeColors): Record<string, string> {
  return {
    "--color-page": page,
    "--color-ink": ink,
    "--color-navy-950": mix(primary, "black", 80),
    "--color-navy-900": primary,
    "--color-navy-800": mix(primary, "white", 88),
    "--color-navy-700": mix(primary, "white", 76),
    "--color-navy-600": mix(primary, "white", 70),
    "--color-navy-500": mix(primary, "white", 58),
    "--color-navy-400": mix(primary, "white", 46),
    "--color-navy-200": mix(primary, "white", 12),
    "--color-navy-100": mix(primary, "white", 9),
    "--color-navy-50": mix(primary, "white", 4),
    "--color-brand-50": mix(accent, "white", 7),
    "--color-brand-100": mix(accent, "white", 14),
    "--color-brand-200": mix(accent, "white", 28),
    "--color-brand-300": mix(accent, "white", 50),
    "--color-brand-400": mix(accent, "white", 75),
    "--color-brand-500": accent,
    "--color-brand-600": mix(accent, "black", 88),
    "--color-brand-700": mix(accent, "black", 76),
    "--color-pink-50": mix(accent, "white", 7),
    "--color-pink-100": mix(accent, "white", 14),
    "--color-pink-500": accent,
    "--color-pink-600": mix(accent, "black", 88),
  };
}

/** The theme as a `:root` rule, for a `<style>` in the root layout (so it reaches `<body>` and every dialog). */
export function themeCss(colors: ThemeColors) {
  const body = Object.entries(themeVars(colors))
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  // `html:root` outranks the tokens' own `:root` whichever stylesheet loads first.
  return `html:root{${body}}`;
}
