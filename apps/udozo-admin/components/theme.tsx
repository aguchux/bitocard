"use client";

import type { ThemeColorKey, ThemeColors } from "@bitocard/api-client/admin";

/**
 * Where udozo.com lives: NEXT_PUBLIC_UDOZO_URL when set, the local Udozo site (port 3007) when the admin runs on
 * localhost, otherwise production.
 */
export function udozoOrigin() {
  const configured = process.env.NEXT_PUBLIC_UDOZO_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "http://localhost:3007";
  return "https://udozo.com";
}

/** udozo.com showing the saved draft, for a preview token. */
export const themePreviewUrl = (token: string) => `${udozoOrigin()}/?theme_preview=${encodeURIComponent(token)}`;

export const colorFields: Array<{ key: ThemeColorKey; label: string; hint: string }> = [
  { key: "primary", label: "Primary", hint: "Buttons, links and the header's highlights. White text sits on it." },
  { key: "accent", label: "Accent", hint: "Badges, prices and the second highlight." },
  { key: "ink", label: "Text", hint: "Body text, on the page colour." },
  { key: "page", label: "Page", hint: "The background behind everything." },
];

export const hexColor = /^#[0-9a-f]{6}$/i;
export const sameColors = (a: ThemeColors, b: ThemeColors) => colorFields.every(({ key }) => a[key].toLowerCase() === b[key].toLowerCase());

/** A small mock of a Udozo page in the given colours, drawn as the admin types. */
export function ThemeSwatch({ colors, label }: { colors: ThemeColors; label: string }) {
  const valid = colorFields.every(({ key }) => hexColor.test(colors[key]));
  const safe = valid ? colors : { primary: "#070f4c", accent: "#d6136a", ink: "#0f172a", page: "#ffffff" };
  return (
    <figure aria-label={label} className="overflow-hidden rounded-2xl border border-line" style={{ background: safe.page, color: safe.ink }} data-testid="theme-swatch">
      <div className="flex items-center justify-between px-4 py-3" style={{ background: safe.primary, color: "#ffffff" }}>
        <span className="font-extrabold tracking-tight">Udozo</span>
        <span className="text-xs font-semibold opacity-90">Sell · Account</span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm font-semibold">Phones and tablets near you</p>
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: `${safe.ink}22` }}>
          <div className="min-w-0">
            <p className="truncate text-sm">iPhone 15, 128GB, like new</p>
            <p className="text-sm font-bold" style={{ color: safe.accent }}>
              ₦850,000
            </p>
          </div>
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: safe.accent }}>
            Safe pay
          </span>
        </div>
        <span className="inline-flex min-h-9 items-center rounded-lg px-4 text-sm font-semibold text-white" style={{ background: safe.primary }}>
          Buy with Safe pay
        </span>
      </div>
      {!valid ? <figcaption className="bg-amber-50 px-4 py-2 text-xs text-amber-900">Every colour must be #rrggbb to show it.</figcaption> : null}
    </figure>
  );
}

