"use client";

import { createContext, useContext, useId } from "react";
import type { MediaPurpose, MediaRealm } from "@bitocard/api-client";
import { categoryLabels, type ProductCategory, type ProductSource, type PromoIllustration, type PromoTheme, type QuickBuyCategory, type StoreSection as Section, type TrustIcon } from "@bitocard/api-client/storefront";
import { Field, Input, Toggle } from "../ui/primitives";

export type FormProps<S extends Section> = { section: S; onChange: (next: Section) => void };

/** A product found by the editor's search (hand-picked rails, the spotlight). */
export type EditorProduct = { id: string; key: string; name: string; category: string; country: string };
export type Lookup<T> = { data: T | undefined; isLoading: boolean; isFetching?: boolean; error: unknown; refetch?: () => void };

/**
 * Where the editor finds products, brands and images: the admin app's catalogue and storage for bitocard.com, the
 * reseller's own catalogue and storage in SHQ. Both are React hooks, called on every render.
 */
export type EditorSources = {
  /** Products matching words (at least 2 letters; skip below that). */
  useProductSearch: (q: string) => Lookup<EditorProduct[]>;
  /** Brands to choose from for a brand rail; null when the page has no brand list (a slug is typed instead). */
  useBrands: (enabled: boolean) => Lookup<Array<{ slug: string; name: string }>> | null;
  image: { realm: MediaRealm; purpose: MediaPurpose };
  /** The categories the page sells (a store's template); every category when not given. */
  categories?: ProductCategory[];
  /** Coins the crypto sections can offer (codes). */
  coins?: string[];
  /** BitoCard Shop categories a Resale shop's listing sections can show (slug and name). */
  resaleCategories?: Array<{ slug: string; name: string }>;
};

const SourcesContext = createContext<EditorSources | null>(null);
/** Gives the inspector its data sources. */
export const EditorSourcesProvider = SourcesContext.Provider;
export function useSources() {
  const sources = useContext(SourcesContext);
  if (!sources) throw new Error("Wrap the editor in EditorSourcesProvider.");
  return sources;
}

export const categoryKeys = Object.keys(categoryLabels) as ProductCategory[];
export const sourceOptions: Array<{ value: ProductSource; label: string }> = [
  { value: "trending", label: "Trending (most sold in 7 days)" },
  { value: "top_selling", label: "Top selling (30 days)" },
  { value: "new", label: "Newest products" },
  { value: "featured", label: "Featured brands" },
  { value: "category", label: "A category" },
  { value: "brand", label: "A brand" },
  { value: "manual", label: "Hand-picked products" },
];
export const themes: Array<{ value: PromoTheme; label: string; swatch: string }> = [
  { value: "pink", label: "Pink", swatch: "linear-gradient(135deg, #ec4899, #db2777)" },
  { value: "sky", label: "Sky", swatch: "linear-gradient(135deg, #7dd3fc, #0ea5e9)" },
  { value: "navy", label: "Navy", swatch: "linear-gradient(135deg, #1e3a8a, #0b1739)" },
  { value: "light", label: "Light", swatch: "linear-gradient(135deg, #ffffff, #e2e8f0)" },
  { value: "sunset", label: "Sunset", swatch: "linear-gradient(135deg, #fb923c, #ec4899)" },
];
export const illustrations: Array<{ value: PromoIllustration; label: string }> = [
  { value: "none", label: "None" },
  { value: "store", label: "Store" },
  { value: "esim", label: "eSIM" },
  { value: "gift", label: "Gift" },
  { value: "globe", label: "Globe" },
];
export const trustIcons: Array<{ value: TrustIcon; label: string }> = [
  { value: "lock", label: "Padlock" },
  { value: "bolt", label: "Lightning bolt" },
  { value: "card", label: "Payment card" },
  { value: "globe", label: "Globe" },
  { value: "shield", label: "Shield" },
  { value: "support", label: "Support" },
  { value: "gift", label: "Gift" },
  { value: "phone", label: "Phone" },
  { value: "coin", label: "Coin" },
  { value: "chart", label: "Chart" },
  { value: "clock", label: "Clock" },
  { value: "star", label: "Star" },
];
export const quickBuyLabels: Record<QuickBuyCategory, string> = { airtime: "Airtime", data: "Data", bills: "Electricity and bills", pay_tv: "Pay-TV", mobile_money: "Mobile money" };

/** Leaves optional text fields out when blank, as the API expects. */
export const optional = (value: string) => (value.trim() ? value : undefined);

export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
      <span className="text-sm">
        <span className="font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export function TitleFields({ section, onChange, titleMax = 80, subtitleMax = 200 }: { section: Section & { title: string; subtitle: string }; onChange: (next: Section) => void; titleMax?: number; subtitleMax?: number }) {
  const id = useId();
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} error={section.title.trim() ? undefined : "A title is required."}>
        <Input id={`${id}-title`} value={section.title} maxLength={titleMax} onChange={event => onChange({ ...section, title: event.target.value } as Section)} />
      </Field>
      <Field label="Subtitle" htmlFor={`${id}-subtitle`} hint="Optional.">
        <Input id={`${id}-subtitle`} value={section.subtitle} maxLength={subtitleMax} onChange={event => onChange({ ...section, subtitle: event.target.value } as Section)} />
      </Field>
    </>
  );
}
