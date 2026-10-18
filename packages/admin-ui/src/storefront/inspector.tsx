"use client";

import { createContext, useContext, useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import type { MediaPurpose, MediaRealm } from "@bitocard/api-client";
import {
  type BrandGridSection,
  type CategoryGridSection,
  categoryLabels,
  type CryptoQuoteSection,
  type FaqSection,
  type FeaturesSection,
  type HeroSection,
  type P2pMarketSection,
  type ProductCategory,
  type ProductRailSection,
  type ProductSource,
  type ProductSpotlightSection,
  type PromoIllustration,
  type PromoSection,
  type PromoTheme,
  type QuickBuyCategory,
  type QuickBuySection,
  type StoreSection as Section,
  type TrustBarSection,
  type TrustIcon,
} from "@bitocard/api-client/storefront";
import { cn, errorMessage } from "../format";
import { useDebouncedValue } from "../ui/hooks";
import { ImageField } from "../ui/image-field";
import { Button, Card, CardHeader, Field, Input, Select, Skeleton, Textarea, Toggle } from "../ui/primitives";
import { Notice, RefreshFailed } from "../ui/status";
import { sectionTypeLabel } from "./grid";

type FormProps<S extends Section> = { section: S; onChange: (next: Section) => void };

/** A product found by the editor's search (hand-picked rails, the spotlight). */
export type EditorProduct = { id: string; key: string; name: string; category: string; country: string };
type Lookup<T> = { data: T | undefined; isLoading: boolean; isFetching?: boolean; error: unknown; refetch?: () => void };

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
};

const SourcesContext = createContext<EditorSources | null>(null);
/** Gives the inspector its data sources. */
export const EditorSourcesProvider = SourcesContext.Provider;
function useSources() {
  const sources = useContext(SourcesContext);
  if (!sources) throw new Error("Wrap the editor in EditorSourcesProvider.");
  return sources;
}

const categoryKeys = Object.keys(categoryLabels) as ProductCategory[];
const sourceOptions: Array<{ value: ProductSource; label: string }> = [
  { value: "trending", label: "Trending (most sold in 7 days)" },
  { value: "top_selling", label: "Top selling (30 days)" },
  { value: "new", label: "Newest products" },
  { value: "featured", label: "Featured brands" },
  { value: "category", label: "A category" },
  { value: "brand", label: "A brand" },
  { value: "manual", label: "Hand-picked products" },
];
const themes: Array<{ value: PromoTheme; label: string; swatch: string }> = [
  { value: "pink", label: "Pink", swatch: "linear-gradient(135deg, #ec4899, #db2777)" },
  { value: "sky", label: "Sky", swatch: "linear-gradient(135deg, #7dd3fc, #0ea5e9)" },
  { value: "navy", label: "Navy", swatch: "linear-gradient(135deg, #1e3a8a, #0b1739)" },
  { value: "light", label: "Light", swatch: "linear-gradient(135deg, #ffffff, #e2e8f0)" },
  { value: "sunset", label: "Sunset", swatch: "linear-gradient(135deg, #fb923c, #ec4899)" },
];
const illustrations: Array<{ value: PromoIllustration; label: string }> = [
  { value: "none", label: "None" },
  { value: "store", label: "Store" },
  { value: "esim", label: "eSIM" },
  { value: "gift", label: "Gift" },
  { value: "globe", label: "Globe" },
];
const trustIcons: Array<{ value: TrustIcon; label: string }> = [
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
const quickBuyLabels: Record<QuickBuyCategory, string> = { airtime: "Airtime", data: "Data", bills: "Electricity and bills", pay_tv: "Pay-TV", mobile_money: "Mobile money" };

/** Leaves optional text fields out when blank, as the API expects. */
const optional = (value: string) => (value.trim() ? value : undefined);

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
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

function TitleFields({ section, onChange, titleMax = 80, subtitleMax = 200 }: { section: Section & { title: string; subtitle: string }; onChange: (next: Section) => void; titleMax?: number; subtitleMax?: number }) {
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

function HeroForm({ section, onChange }: FormProps<HeroSection>) {
  const id = useId();
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} error={section.title.trim() ? undefined : "A title is required."}>
        <Input id={`${id}-title`} value={section.title} maxLength={80} onChange={event => onChange({ ...section, title: event.target.value })} />
      </Field>
      <Field label="Accent line" htmlFor={`${id}-accent`} hint="Shown after the title, highlighted.">
        <Input id={`${id}-accent`} value={section.accent} maxLength={80} onChange={event => onChange({ ...section, accent: event.target.value })} />
      </Field>
      <Field label="Subtitle" htmlFor={`${id}-subtitle`}>
        <Textarea id={`${id}-subtitle`} value={section.subtitle} maxLength={240} onChange={event => onChange({ ...section, subtitle: event.target.value })} />
      </Field>
      <SwitchRow label="Search box" hint="With the country picker." checked={section.search} onChange={search => onChange({ ...section, search })} />
      <SwitchRow label="Category shortcuts" hint="A chip for each category group." checked={section.categoryChips} onChange={categoryChips => onChange({ ...section, categoryChips })} />
    </>
  );
}

/** Finds products by name: the list to add from (a rail's hand-picked products, or the spotlight's one product). */
function ProductSearch({ chosen, full, onAdd, single = false }: { chosen: string[]; full: boolean; onAdd: (key: string) => void; single?: boolean }) {
  const id = useId();
  const sources = useSources();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const products = sources.useProductSearch(q);
  const results = products.data ?? [];
  return (
    <>
      <Field label={single ? "Find the product" : "Find products"} htmlFor={`${id}-search`} hint={full ? "A rail holds at most 24 products." : "Type at least 2 letters of a product or brand name."}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Amazon, MTN, Netflix…" />
        </div>
      </Field>
      {q.length >= 2 ? (
        products.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : products.error && !products.data ? (
          <Notice tone="red">{errorMessage(products.error)}</Notice>
        ) : results.length ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {products.error && !products.isFetching && products.refetch ? (
              <li>
                <RefreshFailed message={errorMessage(products.error)} onRetry={products.refetch} />
              </li>
            ) : null}
            {results.map(product => {
              const added = chosen.includes(product.key);
              return (
                <li key={product.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-canvas">
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-semibold">{product.name}</span>
                    <span className="block truncate text-xs text-muted">{`${categoryLabels[product.category as ProductCategory] ?? product.category} · ${product.country}`}</span>
                  </span>
                  <Button size="sm" variant={added ? "ghost" : "secondary"} disabled={added || full} onClick={() => onAdd(product.key)}>
                    {added ? (single ? "Chosen" : "Added") : single ? "Choose" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No products match.</p>
        )
      ) : null}
    </>
  );
}

function ProductPicker({ section, onChange }: FormProps<ProductRailSection>) {
  const keys = section.productKeys;
  const full = keys.length >= 24;
  const setKeys = (productKeys: string[]) => onChange({ ...section, productKeys });
  const move = (from: number, to: number) => {
    const next = keys.slice();
    const [key] = next.splice(from, 1);
    next.splice(to, 0, key);
    setKeys(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{`Products (${keys.length} of 24)`}</p>
      {keys.length ? (
        <ol className="space-y-1.5">
          {keys.map((key, index) => (
            <li key={key} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={key}>
                {key}
              </span>
              <button type="button" aria-label={`Move ${key} up`} disabled={index === 0} onClick={() => move(index, index - 1)} className="grid size-7 place-items-center rounded text-muted hover:bg-canvas disabled:opacity-40">
                <ArrowUp className="size-3.5" aria-hidden />
              </button>
              <button type="button" aria-label={`Move ${key} down`} disabled={index === keys.length - 1} onClick={() => move(index, index + 1)} className="grid size-7 place-items-center rounded text-muted hover:bg-canvas disabled:opacity-40">
                <ArrowDown className="size-3.5" aria-hidden />
              </button>
              <button type="button" aria-label={`Remove ${key}`} onClick={() => setKeys(keys.filter(item => item !== key))} className="grid size-7 place-items-center rounded text-muted hover:bg-canvas hover:text-red-600">
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <Notice tone="amber">Pick at least one product.</Notice>
      )}
      <ProductSearch chosen={keys} full={full} onAdd={key => setKeys([...keys, key])} />
    </div>
  );
}

function ProductRailForm({ section, onChange }: FormProps<ProductRailSection>) {
  const id = useId();
  const sources = useSources();
  const brands = sources.useBrands(section.source === "brand");
  const categories = sources.categories ?? categoryKeys;
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <Field label="Products to show" htmlFor={`${id}-source`}>
        <Select
          id={`${id}-source`}
          value={section.source}
          onChange={event => {
            const source = event.target.value as ProductSource;
            onChange({ ...section, source, category: source === "category" ? (section.category ?? "gift_cards") : undefined, brand: source === "brand" ? section.brand : undefined });
          }}
        >
          {sourceOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      {section.source === "category" ? (
        <Field label="Category" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={section.category ?? categories[0]} onChange={event => onChange({ ...section, category: event.target.value as ProductCategory })}>
            {categories.map(category => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {section.source === "brand" && !brands ? (
        <Field label="Brand" htmlFor={`${id}-brand`} hint="The brand's short name, for example mtn or amazon." error={section.brand ? undefined : "Enter a brand."}>
          <Input id={`${id}-brand`} value={section.brand ?? ""} maxLength={80} onChange={event => onChange({ ...section, brand: event.target.value.trim().toLowerCase() || undefined })} />
        </Field>
      ) : null}
      {section.source === "brand" && brands ? (
        <Field label="Brand" htmlFor={`${id}-brand`} error={brands.error ? errorMessage(brands.error) : section.brand ? undefined : "Choose a brand."}>
          <Select id={`${id}-brand`} value={section.brand ?? ""} onChange={event => onChange({ ...section, brand: event.target.value || undefined })}>
            <option value="">{brands.isLoading ? "Loading brands…" : "Choose a brand"}</option>
            {section.brand && !brands.data?.some(brand => brand.slug === section.brand) ? <option value={section.brand}>{section.brand}</option> : null}
            {brands.data?.map(brand => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {section.source === "manual" ? (
        <ProductPicker section={section} onChange={onChange} />
      ) : (
        <Field label="How many products" htmlFor={`${id}-limit`}>
          <Select id={`${id}-limit`} value={section.limit} onChange={event => onChange({ ...section, limit: Number(event.target.value) })}>
            {Array.from({ length: 24 }, (_, index) => index + 1).map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Layout" htmlFor={`${id}-layout`}>
        <Select id={`${id}-layout`} value={section.layout} onChange={event => onChange({ ...section, layout: event.target.value as "cards" | "list" })}>
          <option value="cards">Cards</option>
          <option value="list">List</option>
        </Select>
      </Field>
      <SwitchRow label="Filter chips" hint="All, the visitor's country, Global and brand tags." checked={section.filters} onChange={filters => onChange({ ...section, filters })} />
      <Field label="“View all” link" htmlFor={`${id}-href`} hint="A path such as /catalogs/esim or an https:// address. Optional.">
        <Input id={`${id}-href`} value={section.viewAllHref ?? ""} maxLength={500} onChange={event => onChange({ ...section, viewAllHref: optional(event.target.value) })} placeholder="/catalogs" />
      </Field>
    </>
  );
}

function CategoryGridForm({ section, onChange }: FormProps<CategoryGridSection>) {
  const categories = useSources().categories ?? categoryKeys;
  const toggle = (category: ProductCategory) =>
    onChange({ ...section, categories: section.categories.includes(category) ? section.categories.filter(item => item !== category) : [...section.categories, category] });
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Categories</legend>
        <p className="text-xs text-muted">None ticked shows every category on sale. Ticked categories are shown in the order you tick them.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map(category => {
            const position = section.categories.indexOf(category);
            return (
              <label key={category} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-500" checked={position >= 0} onChange={() => toggle(category)} />
                <span className="flex-1">{categoryLabels[category]}</span>
                {position >= 0 ? <span className="text-xs font-semibold text-brand-600">{position + 1}</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

function BrandGridForm({ section, onChange }: FormProps<BrandGridSection>) {
  const id = useId();
  const categories = useSources().categories ?? categoryKeys;
  const chosen = section.categories ?? [];
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <Field label="Tag" htmlFor={`${id}-tag`} hint="Only brands with this tag, for example gaming. Blank shows featured brands first.">
        <Input id={`${id}-tag`} value={section.tag} maxLength={40} onChange={event => onChange({ ...section, tag: event.target.value })} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Only brands selling</legend>
        <p className="text-xs text-muted">None ticked: brands in every category (for example tick Airtime for the networks).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map(category => (
            <label key={category} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand-500"
                checked={chosen.includes(category)}
                onChange={() => onChange({ ...section, categories: chosen.includes(category) ? chosen.filter(item => item !== category) : [...chosen, category] })}
              />
              {categoryLabels[category]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="How many brands" htmlFor={`${id}-limit`}>
        <Select id={`${id}-limit`} value={section.limit} onChange={event => onChange({ ...section, limit: Number(event.target.value) })}>
          {Array.from({ length: 24 }, (_, index) => index + 1).map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function PromoForm({ section, onChange }: FormProps<PromoSection>) {
  const id = useId();
  const { image } = useSources();
  const cta = section.cta ?? { label: "", href: "" };
  const setCta = (next: { label: string; href: string }) => onChange({ ...section, cta: next.label.trim() || next.href.trim() ? next : undefined });
  const setBullet = (index: number, value: string) => onChange({ ...section, bullets: section.bullets.map((bullet, at) => (at === index ? value : bullet)) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} subtitleMax={120} />
      <Field label="Body" htmlFor={`${id}-body`} hint="Optional.">
        <Textarea id={`${id}-body`} value={section.body} maxLength={300} onChange={event => onChange({ ...section, body: event.target.value })} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{`Bullets (${section.bullets.length} of 5)`}</legend>
        {section.bullets.map((bullet, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input aria-label={`Bullet ${index + 1}`} value={bullet} maxLength={80} onChange={event => setBullet(index, event.target.value)} />
            <button
              type="button"
              aria-label={`Remove bullet ${index + 1}`}
              onClick={() => onChange({ ...section, bullets: section.bullets.filter((_, at) => at !== index) })}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-red-600"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.bullets.length >= 5} onClick={() => onChange({ ...section, bullets: [...section.bullets, ""] })}>
          Add bullet
        </Button>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label" htmlFor={`${id}-cta-label`} error={cta.href.trim() && !cta.label.trim() ? "Add a label for the button." : undefined}>
          <Input id={`${id}-cta-label`} value={cta.label} maxLength={40} onChange={event => setCta({ ...cta, label: event.target.value })} placeholder="Start selling" />
        </Field>
        <Field label="Button link" htmlFor={`${id}-cta-href`} error={cta.label.trim() && !cta.href.trim() ? "Add a link for the button." : undefined} hint="A path or an https:// address.">
          <Input id={`${id}-cta-href`} value={cta.href} maxLength={500} onChange={event => setCta({ ...cta, href: event.target.value })} placeholder="/catalogs/esim" />
        </Field>
      </div>
      <ImageField
        label="Image"
        realm={image.realm}
        purpose={image.purpose}
        value={section.imageUrl ?? ""}
        onChange={value => onChange({ ...section, imageUrl: optional(value) })}
        shape="wide"
        hint="Leave empty to use the illustration."
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Theme</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
          {themes.map(theme => {
            const selected = section.theme === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...section, theme: theme.value })}
                className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", selected ? "border-brand-500 bg-brand-50 font-semibold" : "border-line hover:bg-canvas")}
              >
                <span aria-hidden className="size-5 rounded-full border border-line" style={{ background: theme.swatch }} />
                {theme.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label="Illustration" htmlFor={`${id}-illustration`} hint="Drawn when there is no image.">
        <Select id={`${id}-illustration`} value={section.illustration} onChange={event => onChange({ ...section, illustration: event.target.value as PromoIllustration })}>
          {illustrations.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function TrustBarForm({ section, onChange }: FormProps<TrustBarSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<TrustBarSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Item ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Item ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Icon" htmlFor={`${id}-${index}-icon`}>
            <Select id={`${id}-${index}-icon`} value={item.icon} onChange={event => setItem(index, { icon: event.target.value as TrustIcon })}>
              {trustIcons.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor={`${id}-${index}-title`} error={item.title.trim() ? undefined : "A title is required."}>
            <Input id={`${id}-${index}-title`} value={item.title} maxLength={60} onChange={event => setItem(index, { title: event.target.value })} />
          </Field>
          <Field label="Text" htmlFor={`${id}-${index}-body`}>
            <Input id={`${id}-${index}-body`} value={item.body} maxLength={120} onChange={event => setItem(index, { body: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 4} onClick={() => onChange({ ...section, items: [...section.items, { icon: "shield", title: "New item", body: "" }] })}>
        Add item
      </Button>
    </>
  );
}

/** Text items with an icon (features), like the trust bar's but up to six with longer text. */
function FeaturesForm({ section, onChange }: FormProps<FeaturesSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<FeaturesSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Item ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Item ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Icon" htmlFor={`${id}-${index}-icon`}>
            <Select id={`${id}-${index}-icon`} value={item.icon} onChange={event => setItem(index, { icon: event.target.value as TrustIcon })}>
              {trustIcons.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor={`${id}-${index}-title`} error={item.title.trim() ? undefined : "A title is required."}>
            <Input id={`${id}-${index}-title`} value={item.title} maxLength={60} onChange={event => setItem(index, { title: event.target.value })} />
          </Field>
          <Field label="Text" htmlFor={`${id}-${index}-body`}>
            <Textarea id={`${id}-${index}-body`} value={item.body} maxLength={200} onChange={event => setItem(index, { body: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 6} onClick={() => onChange({ ...section, items: [...section.items, { icon: "star", title: "New item", body: "" }] })}>
        Add item
      </Button>
    </>
  );
}

function FaqForm({ section, onChange }: FormProps<FaqSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<FaqSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} error={section.title.trim() ? undefined : "A title is required."}>
        <Input id={`${id}-title`} value={section.title} maxLength={80} onChange={event => onChange({ ...section, title: event.target.value })} />
      </Field>
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Question ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Question ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Question" htmlFor={`${id}-${index}-q`} error={item.question.trim() ? undefined : "A question is required."}>
            <Input id={`${id}-${index}-q`} value={item.question} maxLength={160} onChange={event => setItem(index, { question: event.target.value })} />
          </Field>
          <Field label="Answer" htmlFor={`${id}-${index}-a`} error={item.answer.trim() ? undefined : "An answer is required."}>
            <Textarea id={`${id}-${index}-a`} value={item.answer} maxLength={800} onChange={event => setItem(index, { answer: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 12} onClick={() => onChange({ ...section, items: [...section.items, { question: "New question", answer: "The answer." }] })}>
        Add question
      </Button>
    </>
  );
}

function QuickBuyForm({ section, onChange }: FormProps<QuickBuySection>) {
  const sells = useSources().categories;
  const offered = (Object.keys(quickBuyLabels) as QuickBuyCategory[]).filter(category => !sells || sells.includes(category));
  const toggle = (category: QuickBuyCategory) => {
    const next = section.categories.includes(category) ? section.categories.filter(item => item !== category) : [...section.categories, category];
    if (next.length) onChange({ ...section, categories: next });
  };
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Tabs</legend>
        <p className="text-xs text-muted">At least one; shown in the order you tick them.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {offered.map(category => {
            const position = section.categories.indexOf(category);
            return (
              <label key={category} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-500" checked={position >= 0} onChange={() => toggle(category)} />
                <span className="flex-1">{quickBuyLabels[category]}</span>
                {position >= 0 ? <span className="text-xs font-semibold text-brand-600">{position + 1}</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

function CryptoQuoteForm({ section, onChange }: FormProps<CryptoQuoteSection>) {
  const id = useId();
  const coins = useSources().coins ?? ["USDT", "USDC", "BTC", "ETH", "BNB", "TRX"];
  const toggle = (coin: string) => onChange({ ...section, assets: section.assets.includes(coin) ? section.assets.filter(item => item !== coin) : [...section.assets, coin].slice(0, 9) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Coins offered</legend>
        <p className="text-xs text-muted">None ticked: every coin on sale.</p>
        <div className="flex flex-wrap gap-2">
          {coins.map(coin => (
            <label key={coin} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-500" checked={section.assets.includes(coin)} onChange={() => toggle(coin)} />
              {coin}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Shown first" htmlFor={`${id}-side`}>
        <Select id={`${id}-side`} value={section.side} onChange={event => onChange({ ...section, side: event.target.value as "buy" | "sell" })}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </Select>
      </Field>
    </>
  );
}

function P2pMarketForm({ section, onChange }: FormProps<P2pMarketSection>) {
  const id = useId();
  const coins = useSources().coins ?? ["USDT", "USDC", "BTC", "ETH", "BNB", "TRX"];
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <Field label="Coin" htmlFor={`${id}-asset`}>
        <Select id={`${id}-asset`} value={section.asset} onChange={event => onChange({ ...section, asset: event.target.value })}>
          {[...new Set([section.asset, ...coins])].map(coin => (
            <option key={coin} value={coin}>
              {coin}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function ProductSpotlightForm({ section, onChange }: FormProps<ProductSpotlightSection>) {
  const id = useId();
  const { image } = useSources();
  const setBullet = (index: number, value: string) => onChange({ ...section, bullets: section.bullets.map((bullet, at) => (at === index ? value : bullet)) });
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} hint="Optional: the product's name when blank.">
        <Input id={`${id}-title`} value={section.title} maxLength={80} onChange={event => onChange({ ...section, title: event.target.value })} />
      </Field>
      <Field label="Text" htmlFor={`${id}-subtitle`} hint="Optional.">
        <Textarea id={`${id}-subtitle`} value={section.subtitle} maxLength={240} onChange={event => onChange({ ...section, subtitle: event.target.value })} />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Product</p>
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{section.productKey || "The store’s own product"}</span>
          {section.productKey ? (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...section, productKey: "" })}>
              Use the store’s
            </Button>
          ) : null}
        </div>
        <ProductSearch chosen={section.productKey ? [section.productKey] : []} full={false} single onAdd={productKey => onChange({ ...section, productKey })} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{`Selling points (${section.bullets.length} of 6)`}</legend>
        {section.bullets.map((bullet, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input aria-label={`Selling point ${index + 1}`} value={bullet} maxLength={80} onChange={event => setBullet(index, event.target.value)} />
            <button type="button" aria-label={`Remove selling point ${index + 1}`} onClick={() => onChange({ ...section, bullets: section.bullets.filter((_, at) => at !== index) })} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-red-600">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.bullets.length >= 6} onClick={() => onChange({ ...section, bullets: [...section.bullets, ""] })}>
          Add selling point
        </Button>
      </fieldset>
      <ImageField label="Image" realm={image.realm} purpose={image.purpose} value={section.imageUrl ?? ""} onChange={value => onChange({ ...section, imageUrl: optional(value) })} shape="wide" hint="Optional: shown beside the product in the Split design." />
    </>
  );
}

function SectionForm({ section, onChange }: FormProps<Section>) {
  switch (section.type) {
    case "hero":
      return <HeroForm section={section} onChange={onChange} />;
    case "product_rail":
      return <ProductRailForm section={section} onChange={onChange} />;
    case "category_grid":
      return <CategoryGridForm section={section} onChange={onChange} />;
    case "brand_grid":
      return <BrandGridForm section={section} onChange={onChange} />;
    case "promo":
      return <PromoForm section={section} onChange={onChange} />;
    case "trust_bar":
      return <TrustBarForm section={section} onChange={onChange} />;
    case "quick_buy":
      return <QuickBuyForm section={section} onChange={onChange} />;
    case "crypto_quote":
      return <CryptoQuoteForm section={section} onChange={onChange} />;
    case "p2p_market":
      return <P2pMarketForm section={section} onChange={onChange} />;
    case "product_spotlight":
      return <ProductSpotlightForm section={section} onChange={onChange} />;
    case "features":
      return <FeaturesForm section={section} onChange={onChange} />;
    case "faq":
      return <FaqForm section={section} onChange={onChange} />;
  }
}

/** The selected section's settings. Read-only admins see the values with every control disabled. */
export function Inspector({ section, index, error, editable, onChange }: { section: Section | null; index: number; error: string | null; editable: boolean; onChange: (next: Section) => void }) {
  if (!section) {
    return (
      <Card className="p-5 text-sm text-muted">
        <p className="font-semibold text-ink">No section selected</p>
        <p className="mt-1">Select a section on the canvas to change what it shows.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title={sectionTypeLabel(section.type)} description={`Section ${index + 1}${section.hidden ? " · hidden" : ""}${editable ? "" : " · view only"}`} />
      <fieldset disabled={!editable} className="min-w-0 space-y-4 p-5 sm:px-6">
        {error ? <Notice tone="red" title="This section cannot be saved">{error}</Notice> : null}
        <SectionForm section={section} onChange={onChange} />
      </fieldset>
    </Card>
  );
}
