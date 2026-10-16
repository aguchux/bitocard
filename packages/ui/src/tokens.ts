/**
 * The brand palette as literal values, for JavaScript that cannot use a CSS variable (SVG fills drawn in code, the web
 * manifest, `viewport.themeColor`, contrast calculations). Mirrors `styles/tokens.css`; a test keeps them in step.
 * Everywhere else use the Tailwind utilities (`bg-brand-500`, `text-navy-900`) or `var(--color-…)`.
 */
export const colors = {
  navy950: "#040935",
  navy900: "#070f4c",
  navy800: "#111a5e",
  navy700: "#1d2873",
  navy100: "#e7e9f6",
  brand50: "#fff0f7",
  brand100: "#ffe0ef",
  brand200: "#ffc0de",
  brand300: "#ff8fc0",
  brand400: "#ff5ca8",
  brand500: "#ff2382",
  brand600: "#e3106b",
  brand700: "#c00b58",
  azure500: "#2477ff",
  gold400: "#ffd23f",
  plum800: "#3a1680",
  plum900: "#2a1466",
  ink: "#0d1433",
  muted: "#5b6488",
  subtle: "#8a92ad",
  line: "#e6e9f2",
  canvas: "#f6f7fb",
  page: "#fcfdff",
} as const;

export type ColorToken = keyof typeof colors;
