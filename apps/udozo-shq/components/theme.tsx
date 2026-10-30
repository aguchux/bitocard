"use client";

import { useEffect } from "react";
import { type SiteThemeColors, useSellerHqThemeQuery } from "@bitocard/api-client/reseller";

const hex = /^#[0-9a-f]{6}$/i;

/**
 * The console's colour variables from Udozo's theme: the accent drives calls to action (the shared console's "brand"
 * scale), the primary its navy rail and dark surfaces, and the ink its text. Shades are mixed in CSS from each colour.
 */
export function themeVariables(colors: SiteThemeColors): Record<string, string> {
  if (![colors.primary, colors.accent, colors.ink].every(color => hex.test(color))) return {};
  const mix = (color: string, other: string, share: number) => `color-mix(in srgb, ${color} ${share}%, ${other})`;
  return {
    "--color-brand-50": mix(colors.accent, "white", 8),
    "--color-brand-100": mix(colors.accent, "white", 15),
    "--color-brand-200": mix(colors.accent, "white", 30),
    "--color-brand-300": mix(colors.accent, "white", 55),
    "--color-brand-400": mix(colors.accent, "white", 80),
    "--color-brand-500": colors.accent,
    "--color-brand-600": mix(colors.accent, "black", 88),
    "--color-brand-700": mix(colors.accent, "black", 76),
    "--color-navy-950": mix(colors.primary, "black", 80),
    "--color-navy-900": colors.primary,
    "--color-navy-800": mix(colors.primary, "white", 88),
    "--color-navy-700": mix(colors.primary, "white", 76),
    "--color-ink": colors.ink,
  };
}

/** Applies the published theme to the whole document once it loads; BitoCard's navy and pink stay until then. */
export function UdozoTheme() {
  const { data } = useSellerHqThemeQuery();
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const variables = themeVariables(data.colors);
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(variables)) root.style.removeProperty(name);
    };
  }, [data]);
  return null;
}
