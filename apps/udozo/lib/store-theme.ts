import type { CSSProperties } from "react";
import type { StoreDesign } from "@bitocard/api-client/storefront";

/**
 * A reseller store's look, from its template's variant and colour theme (`design` on the storefront). Every utility the
 * store uses reads Tailwind's theme variables (`bg-brand-500` is `var(--color-brand-500)`), so re-pointing those
 * variables on the store's shell re-colours every page at once: the pink scale follows the theme's primary, navy its
 * ink, the page its background, and on dark variants white and the slate scale turn into its surfaces and text. The
 * variant's corners and type re-point the radius and font variables the same way; its cards (`data-cards`) drop or
 * soften shadows in `globals.css`, since Tailwind writes shadows out in full.
 * `--st-*` name the theme's own colours for the template sections (heroes, quick buy, the service shops).
 */

const mix = (color: string, other: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, ${other})`;

const radius: Record<StoreDesign["style"]["corners"], Record<string, string>> = {
  sharp: { "--radius-sm": "2px", "--radius-md": "3px", "--radius-lg": "4px", "--radius-xl": "4px", "--radius-2xl": "6px", "--radius-3xl": "8px" },
  soft: { "--radius-sm": "3px", "--radius-md": "5px", "--radius-lg": "6px", "--radius-xl": "8px", "--radius-2xl": "10px", "--radius-3xl": "14px" },
  round: {},
};

const monospace = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const fonts: Record<StoreDesign["style"]["font"], Record<string, string>> = {
  sans: {},
  display: {},
  mono: { "--font-display": monospace, "--font-sans": monospace },
  serif: { "--font-display": "ui-serif, Georgia, Cambria, 'Times New Roman', serif" },
};

/** The CSS variables for a store's shell. */
export function storeThemeVars(design: StoreDesign): Record<string, string> {
  const { colors, style } = design;
  const dark = style.mode === "dark";
  const vars: Record<string, string> = {
    "--st-primary": colors.primary,
    "--st-accent": colors.accent,
    "--st-background": colors.background,
    "--st-surface": colors.surface,
    "--st-ink": colors.ink,
    "--st-muted": colors.muted,
    "--st-hero-from": colors.heroFrom,
    "--st-hero-to": colors.heroTo,
    "--st-hero-ink": colors.heroInk,
    "--color-page": colors.background,
    // The pink scale: buttons, links and highlights.
    "--color-brand-50": mix(colors.primary, colors.surface, 8),
    "--color-brand-100": mix(colors.primary, colors.surface, 16),
    "--color-brand-200": mix(colors.primary, colors.surface, 30),
    "--color-brand-300": mix(colors.primary, colors.surface, 55),
    "--color-brand-400": mix(colors.primary, colors.surface, 80),
    "--color-brand-500": colors.primary,
    "--color-brand-600": mix(colors.primary, dark ? "white" : "black", 88),
    "--color-brand-700": mix(colors.primary, dark ? "white" : "black", 75),
    "--color-pink-50": mix(colors.primary, colors.surface, 8),
    "--color-pink-500": colors.primary,
    "--color-pink-600": mix(colors.primary, dark ? "white" : "black", 88),
    // Navy: headings, body text and dark buttons.
    "--color-navy-950": colors.ink,
    "--color-navy-900": colors.ink,
    "--color-navy-800": mix(colors.ink, colors.surface, 88),
    "--color-navy-700": mix(colors.ink, colors.surface, 76),
    ...radius[style.corners],
    ...fonts[style.font],
  };
  if (dark) {
    // Surfaces in place of white, and the slate scale from the surface (lightest) to the ink (darkest).
    Object.assign(vars, {
      "--color-white": colors.surface,
      "--color-slate-50": mix(colors.ink, colors.surface, 5),
      "--color-slate-100": mix(colors.ink, colors.surface, 9),
      "--color-slate-200": mix(colors.ink, colors.surface, 16),
      "--color-slate-300": mix(colors.ink, colors.surface, 26),
      "--color-slate-400": mix(colors.muted, colors.surface, 80),
      "--color-slate-500": colors.muted,
      "--color-slate-600": colors.muted,
      "--color-slate-700": mix(colors.ink, colors.muted, 60),
      "--color-slate-800": colors.ink,
      "--color-slate-900": colors.ink,
    });
  }
  // Glass cards: surfaces let the page show through (blurred behind them in globals.css).
  if (style.cards === "glass") vars["--color-white"] = mix(colors.surface, "transparent", 82);
  return vars;
}

/** The shell's `style` and data attributes (`data-mode` lets CSS and tests tell dark stores apart). */
export function storeShell(design: StoreDesign | undefined | null): { style?: CSSProperties; "data-mode"?: string; "data-cards"?: string; "data-variant"?: string; "data-template"?: string } {
  if (!design) return {};
  // Body text inherits its font from the page, so a monospaced variant sets it on the shell itself.
  const style = { ...storeThemeVars(design), ...(design.style.font === "mono" ? { fontFamily: monospace } : {}) } as CSSProperties;
  return { style, "data-mode": design.style.mode, "data-cards": design.style.cards, "data-variant": design.variant, "data-template": design.template };
}

/** Space between sections for the variant's density. */
export const densityGap: Record<StoreDesign["style"]["density"], string> = {
  compact: "gap-6 md:gap-5 lg:gap-6",
  comfortable: "gap-8 md:gap-6 lg:gap-7",
  airy: "gap-12 md:gap-10 lg:gap-12",
};
