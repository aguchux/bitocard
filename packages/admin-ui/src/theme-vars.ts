/**
 * A product's colour theme on the shared console (Udozo's Seller HQ and admin): the colour variables every console
 * utility reads, re-pointed from three colours. `primary` is the navy scale (the rail, headings and dark surfaces; its
 * lighter tones mixed towards white for quiet text, borders and soft panels), `accent` the brand and pink scales (calls
 * to action, active states, links), `ink` body text. BitoCard's own consoles never use it: they keep the tokens.
 */
export type ConsoleThemeColors = { primary: string; accent: string; ink: string };

/** Udozo's colours from its logo (the blue script "u", #185174), its admins' default theme until they publish one. */
export const udozoConsoleColors: ConsoleThemeColors = { primary: "#185174", accent: "#0e7cc0", ink: "#10212e" };

const hex = /^#[0-9a-f]{6}$/i;
const mix = (color: string, other: string, share: number) => `color-mix(in srgb, ${color} ${share}%, ${other})`;

/** The variables for a theme, or none when a colour is not `#rrggbb` (the console then keeps what it has). */
export function consoleThemeVariables({ primary, accent, ink }: ConsoleThemeColors): Record<string, string> {
  if (![primary, accent, ink].every(color => hex.test(color))) return {};
  return {
    "--color-ink": ink,
    "--color-navy-950": mix(primary, "black", 80),
    "--color-navy-900": primary,
    "--color-navy-800": mix(primary, "white", 88),
    "--color-navy-700": mix(primary, "white", 76),
    "--color-navy-600": mix(primary, "white", 70),
    "--color-navy-500": mix(primary, "white", 58),
    "--color-navy-400": mix(primary, "white", 46),
    "--color-navy-300": mix(primary, "white", 30),
    "--color-navy-200": mix(primary, "white", 12),
    "--color-navy-100": mix(primary, "white", 9),
    "--color-navy-50": mix(primary, "white", 4),
    "--color-brand-50": mix(accent, "white", 8),
    "--color-brand-100": mix(accent, "white", 15),
    "--color-brand-200": mix(accent, "white", 30),
    "--color-brand-300": mix(accent, "white", 55),
    "--color-brand-400": mix(accent, "white", 80),
    "--color-brand-500": accent,
    "--color-brand-600": mix(accent, "black", 88),
    "--color-brand-700": mix(accent, "black", 76),
    "--color-pink-50": mix(accent, "white", 8),
    "--color-pink-100": mix(accent, "white", 15),
    "--color-pink-200": mix(accent, "white", 30),
    "--color-pink-500": accent,
    "--color-pink-600": mix(accent, "black", 88),
    "--color-pink-700": mix(accent, "black", 76),
  };
}

/**
 * The theme as one `html:root` rule, for a `<style>` in a root layout, so the console wears it from the first paint
 * (it outranks the tokens' own `:root` whichever stylesheet loads first). The published theme, applied once it loads,
 * sets the same variables on `<html>` itself and wins over it.
 */
export function consoleThemeCss(colors: ConsoleThemeColors) {
  const body = Object.entries(consoleThemeVariables(colors))
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `html:root{${body}}`;
}
