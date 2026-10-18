"use client";

import { Suspense, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Check, Gift, Layers, Lock, Smartphone, Sparkles } from "lucide-react";
import { Badge, cn, Select } from "@bitocard/admin-ui";
import type { Store, StoreTemplate } from "@bitocard/api-client/reseller";
import type { StoreTemplateKey, StoreThemeColors, StoreVariantStyle } from "@bitocard/api-client/storefront";

/** Each template's icon, for cards and lists. */
export const templateIcons: Record<StoreTemplateKey, typeof Layers> = { all_in_one: Layers, topups: Smartphone, gift_cards: Gift, crypto_desk: ArrowLeftRight, single_product: Sparkles };

export type Design = { template: StoreTemplateKey; variant: string; theme: string };

/** The template, variant and theme objects a design names (the first of each when unknown). */
export function resolveDesign(templates: StoreTemplate[], design: Design) {
  const template = templates.find(item => item.key === design.template) ?? templates[0];
  const variant = template?.variants.find(item => item.key === design.variant) ?? template?.variants[0];
  const theme = variant?.themes.find(item => item.key === design.theme) ?? variant?.themes[0];
  return { template, variant, theme };
}

const radius = { sharp: "2px", soft: "6px", round: "12px" } as const;

/**
 * A small drawing of a variant in a theme: its page colour, hero (gradient and text), cards in its corner style and its
 * primary button, so resellers see the look before choosing it.
 */
export function DesignPreview({ style, colors, className }: { style: StoreVariantStyle; colors: StoreThemeColors; className?: string }) {
  const r = radius[style.corners];
  const card: CSSProperties = {
    background: colors.surface,
    borderRadius: r,
    boxShadow: style.cards === "raised" ? "0 2px 6px rgb(0 0 0 / 0.12)" : style.cards === "glass" ? "0 2px 10px rgb(0 0 0 / 0.35)" : "none",
    border: style.cards === "outline" ? `1px solid ${colors.muted}40` : "none",
  };
  const font = style.font === "mono" ? "ui-monospace, monospace" : style.font === "serif" ? "Georgia, serif" : undefined;
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-xl border border-line", className)} style={{ background: colors.background, fontFamily: font }}>
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ color: colors.primary }}>
        <span className="h-1.5 w-10 rounded-full" style={{ background: colors.primary }} />
        <span className="h-1.5 w-6 rounded-full" style={{ background: colors.muted, opacity: 0.5 }} />
      </div>
      <div className="mx-2 flex flex-col justify-center gap-1 px-2.5 py-3" style={{ background: `linear-gradient(135deg, ${colors.heroFrom}, ${colors.heroTo})`, color: colors.heroInk, borderRadius: r }}>
        <span className="text-[10px] font-extrabold leading-none">Aa</span>
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: colors.heroInk, opacity: 0.85 }} />
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: colors.accent }} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {[0, 1, 2].map(index => (
          <span key={index} className="flex h-8 flex-col justify-end p-1" style={card}>
            <span className="h-1 w-2/3 rounded-full" style={{ background: colors.ink, opacity: 0.7 }} />
          </span>
        ))}
      </div>
      <div className="px-2 pb-2">
        <span className="block h-3 w-1/3" style={{ background: colors.primary, borderRadius: r }} />
      </div>
    </div>
  );
}

/** Colour dots for a theme (primary, accent, hero), with its name. */
export function ThemeDots({ colors }: { colors: StoreThemeColors }) {
  return (
    <span aria-hidden className="flex -space-x-1.5">
      {[colors.primary, colors.accent, colors.heroFrom, colors.background].map((color, index) => (
        <span key={index} className="size-5 rounded-full border-2 border-white shadow-sm" style={{ background: color }} />
      ))}
    </span>
  );
}

/** The five templates as cards; one closed to the reseller shows why. */
export function TemplateCards({ templates, value, onChange, disabled }: { templates: StoreTemplate[]; value: StoreTemplateKey; onChange: (key: StoreTemplateKey) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Template" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {templates.map(template => {
        const Icon = templateIcons[template.key];
        const selected = template.key === value;
        const first = template.variants[0];
        return (
          <button
            key={template.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || !template.available}
            onClick={() => onChange(template.key)}
            className={cn(
              "flex flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
              selected ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:border-brand-300",
            )}
          >
            {first ? <DesignPreview style={first.style} colors={first.themes[0].colors} className="h-28 w-full" /> : null}
            <span className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
                  {template.name}
                  {selected ? <Check className="size-4 text-brand-600" aria-hidden /> : null}
                </span>
                <span className="block text-sm text-muted">{template.tagline}</span>
              </span>
            </span>
            {!template.available ? (
              <span className="flex items-start gap-1.5 text-xs font-medium text-amber-700">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {template.reason}
              </span>
            ) : (
              <span className="text-xs text-muted">{`${template.variants.length} designs · ${template.variants.reduce((sum, variant) => sum + variant.themes.length, 0)} colour themes`}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A template's variants (each drawn in its first theme) and the chosen variant's colour themes. */
export function VariantAndTheme({ template, variant, theme, onChange, disabled }: { template: StoreTemplate; variant: string; theme: string; onChange: (next: { variant: string; theme: string }) => void; disabled?: boolean }) {
  const current = template.variants.find(item => item.key === variant) ?? template.variants[0];
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Design</p>
        <div role="radiogroup" aria-label="Design" className="grid gap-3 sm:grid-cols-3">
          {template.variants.map(item => {
            const selected = item.key === current.key;
            const colors = (selected ? item.themes.find(t => t.key === theme) : undefined)?.colors ?? item.themes[0].colors;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange({ variant: item.key, theme: item.themes[0].key })}
                className={cn("flex flex-col gap-2 rounded-2xl border bg-white p-3 text-left transition disabled:opacity-60", selected ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:border-brand-300")}
              >
                <DesignPreview style={item.style} colors={colors} className="h-32 w-full" />
                <span className="flex items-center gap-2 text-sm font-bold text-ink">
                  {item.name}
                  {item.style.mode === "dark" ? <Badge tone="grey">Dark</Badge> : null}
                </span>
                <span className="text-xs text-muted">{item.description}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Colour theme</p>
        <div role="radiogroup" aria-label="Colour theme" className="flex flex-wrap gap-2">
          {current.themes.map(item => {
            const selected = item.key === theme;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange({ variant: current.key, theme: item.key })}
                className={cn("flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-sm transition disabled:opacity-60", selected ? "border-brand-500 font-semibold ring-2 ring-brand-100" : "border-line hover:border-brand-300")}
              >
                <ThemeDots colors={item.colors} />
                {item.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The store a store page works on, now that a reseller can run several: `?store=<id>` when it names one of theirs, else
 * the first. `choose` keeps the rest of the address.
 */
export function useCurrentStore(stores: Store[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wanted = params.get("store");
  const store = stores.find(item => item.id === wanted) ?? stores[0] ?? null;
  const choose = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("store", id);
    router.replace(`${pathname}?${next.toString()}`);
  };
  return { store, choose };
}

/** Which store the page is about, shown only when there are several. */
export function StorePicker({ stores, value, onChange }: { stores: Store[]; value: string; onChange: (id: string) => void }) {
  if (stores.length < 2) return null;
  return (
    <div className="w-64 max-w-full">
      <label htmlFor="store-picker" className="sr-only">
        Store
      </label>
      <Select id="store-picker" value={value} onChange={event => onChange(event.target.value)}>
        {stores.map(store => (
          <option key={store.id} value={store.id}>
            {store.name} · {store.subdomain}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The store a page is about (`?store=`, else the first) with the picker above it, or why there is none. Inside Suspense,
 * because it reads the address.
 */
export function WithStore({ stores, children, empty }: { stores: Store[]; children: (store: Store) => ReactNode; empty: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ChosenStore stores={stores} empty={empty}>
        {children}
      </ChosenStore>
    </Suspense>
  );
}

function ChosenStore({ stores, children, empty }: { stores: Store[]; children: (store: Store) => ReactNode; empty: ReactNode }) {
  const { store, choose } = useCurrentStore(stores);
  if (!store) return <>{empty}</>;
  return (
    <div className="space-y-4">
      <StorePicker stores={stores} value={store.id} onChange={choose} />
      {children(store)}
    </div>
  );
}

/** A store page's address for one of several stores. */
export const storeHref = (path: string, store: Pick<Store, "id">) => `${path}${path.includes("?") ? "&" : "?"}store=${store.id}`;
