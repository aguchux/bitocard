"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BadgePercent, Globe2, ImageIcon, LayoutGrid, LayoutPanelTop, Megaphone, Plus, Rows3, ShieldCheck, TrendingUp, X } from "lucide-react";
import { Button, Field, ImageField, Input, Select, Textarea, Toggle } from "@bitocard/admin-ui";
import { defineRegistry, StoreSectionForm } from "@bitocard/admin-ui/storefront";
import { conditionLabels } from "@bitocard/api-client/classifieds";
import type { StoreSection } from "@bitocard/api-client/storefront";
import { homeLinkText, type HomeGroupKind, type HomeLink, type HomeSection, type HomeTileSize, type HomeTone } from "@bitocard/api-client/home";

/** What the forms choose from: the page's scope, the categories (with their subcategories) and the open markets. */
export type HomeFormContext = {
  scope: "global" | "country";
  categories: Array<{ slug: string; name: string; children: Array<{ slug: string; name: string }> }>;
  markets: Array<{ country: string; name: string }>;
};
const FormContext = createContext<HomeFormContext>({ scope: "country", categories: [], markets: [] });
export const HomeFormProvider = FormContext.Provider;
const useForm = () => useContext(FormContext);

const full = { lg: 12, md: 6, rows: 1 } as const;
const image = { realm: "admin", purpose: "home_image" } as const;
const sizeLabels: Record<HomeTileSize, string> = { sm: "Small", wide: "Wide", tall: "Tall", lg: "Large" };
const toneLabels: Record<HomeTone, string> = { navy: "Navy", brand: "Brand colour", light: "Light" };
const groupLabels: Record<HomeGroupKind, string> = { newest: "The newest", trending: "Trending", category: "A category", area: "A state or area", condition: "A condition" };
const heroStyles = { search: "Search", carousel: "Carousel of slides", minimal: "Minimal" } as const;

type Of<T extends HomeSection["type"]> = Extract<HomeSection, { type: T }>;
type Props<T extends HomeSection["type"]> = { section: Of<T>; onChange: (next: HomeSection) => void };

function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; hint?: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint ?? `${min} to ${max}.`}>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} />
    </Field>
  );
}

function TextField({ label, value, max, onChange, hint, required = false, multiline = false }: { label: string; value: string; max: number; onChange: (value: string) => void; hint?: string; required?: boolean; multiline?: boolean }) {
  const id = useId();
  const error = required && !value.trim() ? `${label} is required.` : undefined;
  return (
    <Field label={label} htmlFor={id} hint={hint ?? (required ? undefined : "Optional.")} error={error}>
      {multiline ? <Textarea id={id} value={value} maxLength={max} onChange={event => onChange(event.target.value)} /> : <Input id={id} value={value} maxLength={max} onChange={event => onChange(event.target.value)} />}
    </Field>
  );
}

/** A category from the market's tree (subcategories under their top category). */
function CategorySelect({ label, value, onChange, optional = false }: { label: string; value: string | null; onChange: (slug: string | null) => void; optional?: boolean }) {
  const id = useId();
  const { categories } = useForm();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value ?? ""} onChange={event => onChange(event.target.value || null)}>
        {optional || !value ? <option value="">{optional ? "Every category" : "Choose a category"}</option> : null}
        {categories.map(top => (
          <optgroup key={top.slug} label={top.name}>
            <option value={top.slug}>{`All ${top.name}`}</option>
            {top.children.map(child => (
              <option key={child.slug} value={child.slug}>
                {child.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

/** Where a slide, banner or tile goes: a category, a search (a country's page only) or a page. */
function LinkField({ value, onChange }: { value: HomeLink; onChange: (next: HomeLink) => void }) {
  const id = useId();
  const { scope } = useForm();
  return (
    <div className="grid gap-3 rounded-xl bg-canvas p-3">
      <Field label="Links to" htmlFor={id} hint={scope === "global" ? "Across countries a link goes to a category or a page (searches are a country's)." : undefined}>
        <Select
          id={id}
          value={value.kind}
          onChange={event => {
            const kind = event.target.value as HomeLink["kind"];
            onChange(kind === "category" ? { kind, slug: "" } : kind === "search" ? { kind, q: "" } : { kind, href: "/" });
          }}
        >
          <option value="category">A category</option>
          {scope === "country" ? <option value="search">A search</option> : null}
          <option value="href">A page on Udozo or an https:// address</option>
        </Select>
      </Field>
      {value.kind === "category" ? <CategorySelect label="Category" value={value.slug || null} onChange={slug => onChange({ kind: "category", slug: slug ?? "" })} /> : null}
      {value.kind === "search" ? <TextField label="Search words" value={value.q} max={80} required onChange={q => onChange({ kind: "search", q })} /> : null}
      {value.kind === "href" ? <TextField label="Address" value={value.href} max={500} required hint="A path such as /sell, or an https:// address." onChange={href => onChange({ kind: "href", href })} /> : null}
    </div>
  );
}

/** A list the admin adds to, reorders and removes from (slides, tiles, banners). */
function ItemList<T>({ items, max, label, render, onChange, make }: { items: T[]; max: number; label: string; render: (item: T, change: (next: T) => void, index: number) => ReactNode; onChange: (next: T[]) => void; make: () => T }) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{`${label}s (${items.length} of ${max})`}</legend>
      {items.map((item, index) => (
        <div key={index} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`${label} ${index + 1}`}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Move ${label.toLowerCase()} ${index + 1} up`} icon={<ArrowUp className="size-4" aria-hidden />} disabled={index === 0} onClick={() => move(index, index - 1)} />
              <Button size="sm" variant="ghost" aria-label={`Move ${label.toLowerCase()} ${index + 1} down`} icon={<ArrowDown className="size-4" aria-hidden />} disabled={index === items.length - 1} onClick={() => move(index, index + 1)} />
              <Button size="sm" variant="ghost" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} icon={<X className="size-4" aria-hidden />} onClick={() => onChange(items.filter((_, at) => at !== index))} />
            </div>
          </div>
          {render(item, next => onChange(items.map((entry, at) => (at === index ? next : entry))), index)}
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={items.length >= max} onClick={() => onChange([...items, make()])}>
        {`Add ${label.toLowerCase()}`}
      </Button>
    </fieldset>
  );
}

function HeroForm({ section, onChange }: Props<"home_hero">) {
  const id = useId();
  return (
    <>
      <Field label="Style" htmlFor={id} hint={section.style === "carousel" ? "Until a slide is added, the title shows with the search." : undefined}>
        <Select id={id} value={section.style} onChange={event => onChange({ ...section, style: event.target.value as Of<"home_hero">["style"] })}>
          {Object.entries(heroStyles).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <TextField label="Title" value={section.title} max={80} required onChange={title => onChange({ ...section, title })} />
      <TextField label="Second line" value={section.accent} max={80} hint="Optional: shown in the accent colour." onChange={accent => onChange({ ...section, accent })} />
      <TextField label="Subtitle" value={section.subtitle} max={200} onChange={subtitle => onChange({ ...section, subtitle })} />
      {section.style === "carousel" ? (
        <ItemList
          label="Slide"
          max={5}
          items={section.slides}
          make={() => ({ image: "", title: "New slide", subtitle: "", link: { kind: "href" as const, href: "/" } })}
          onChange={slides => onChange({ ...section, slides })}
          render={(slide, change) => (
            <>
              <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={slide.image} onChange={url => change({ ...slide, image: url })} shape="wide" hint="Wide, at least 1600 pixels across." />
              <TextField label="Title" value={slide.title} max={80} required onChange={title => change({ ...slide, title })} />
              <TextField label="Subtitle" value={slide.subtitle} max={160} onChange={subtitle => change({ ...slide, subtitle })} />
              <LinkField value={slide.link} onChange={link => change({ ...slide, link })} />
            </>
          )}
        />
      ) : null}
    </>
  );
}

function MasonryForm({ section, onChange }: Props<"category_masonry">) {
  return (
    <>
      <TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <ItemList
        label="Tile"
        max={12}
        items={section.tiles}
        make={() => ({ slug: "", size: "sm" as const, image: null })}
        onChange={tiles => onChange({ ...section, tiles })}
        render={(tile, change) => (
          <TileFields tile={tile} change={change} />
        )}
      />
      {section.tiles.length ? null : <NumberField label="How many of the busiest categories" value={section.limit} min={4} max={12} hint="With no tiles chosen, the categories with the most listings, each with a photo of one of them." onChange={limit => onChange({ ...section, limit })} />}
    </>
  );
}

function TileFields({ tile, change }: { tile: Of<"category_masonry">["tiles"][number]; change: (next: Of<"category_masonry">["tiles"][number]) => void }) {
  const id = useId();
  return (
    <>
      <CategorySelect label="Category" value={tile.slug || null} onChange={slug => change({ ...tile, slug: slug ?? "" })} />
      <Field label="Size" htmlFor={id}>
        <Select id={id} value={tile.size} onChange={event => change({ ...tile, size: event.target.value as HomeTileSize })}>
          {Object.entries(sizeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={tile.image ?? ""} onChange={url => change({ ...tile, image: url || null })} hint="Optional: else a photo of one of its listings." />
    </>
  );
}

function DealsForm({ section, onChange }: Props<"deals_rail">) {
  return (
    <>
      <TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <NumberField label="Price drops of the last … days" value={section.days} min={7} max={30} onChange={days => onChange({ ...section, days })} />
      <NumberField label="Listings" value={section.limit} min={4} max={24} onChange={limit => onChange({ ...section, limit })} />
      <CategorySelect label="Category" value={section.category} optional onChange={category => onChange({ ...section, category })} />
      <p className="text-xs text-muted">Only genuine drops: the listing’s price is below the lowest it was in the 30 days before.</p>
    </>
  );
}

function SponsoredForm({ section, onChange }: Props<"sponsored_rail">) {
  return (
    <>
      <TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <NumberField label="Listings" value={section.limit} min={1} max={12} onChange={limit => onChange({ ...section, limit })} />
      <p className="text-xs text-muted">Shows this page’s live placements (Marketplace › Sponsored), each always labelled Sponsored. Empty, the section is not shown.</p>
    </>
  );
}

function TopSellingForm({ section, onChange }: Props<"top_selling_rail">) {
  return (
    <>
      <TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <TextField label="Title while few have sold" value={section.fallbackTitle} max={80} hint="Until enough sell with Safe pay, the most contacted listings show under this title instead." onChange={fallbackTitle => onChange({ ...section, fallbackTitle })} />
      <NumberField label="Sales needed" value={section.minimum} min={1} max={12} hint="Listings sold with Safe pay in 30 days before the rail shows sales." onChange={minimum => onChange({ ...section, minimum })} />
      <NumberField label="Listings" value={section.limit} min={4} max={24} onChange={limit => onChange({ ...section, limit })} />
    </>
  );
}

function GroupForm({ section, onChange }: Props<"listing_group">) {
  const id = useId();
  const { scope } = useForm();
  const kinds = (Object.keys(groupLabels) as HomeGroupKind[]).filter(kind => scope === "country" || kind === "newest" || kind === "trending");
  return (
    <>
      <TextField label="Title" value={section.title} max={80} required onChange={title => onChange({ ...section, title })} />
      <Field label="Listings" htmlFor={`${id}-by`}>
        <Select id={`${id}-by`} value={section.by} onChange={event => onChange({ ...section, by: event.target.value as HomeGroupKind, value: null })}>
          {kinds.map(kind => (
            <option key={kind} value={kind}>
              {groupLabels[kind]}
            </option>
          ))}
        </Select>
      </Field>
      {section.by === "category" ? <CategorySelect label="Category" value={section.value} onChange={value => onChange({ ...section, value })} /> : null}
      {section.by === "area" ? <TextField label="State or area" value={section.value ?? ""} max={80} required hint="Its address name, as in /ng/lagos or /ng/lagos/ikeja: lagos, or ikeja." onChange={value => onChange({ ...section, value: value.trim().toLowerCase() || null })} /> : null}
      {section.by === "condition" ? (
        <Field label="Condition" htmlFor={`${id}-condition`}>
          <Select id={`${id}-condition`} value={section.value ?? ""} onChange={event => onChange({ ...section, value: event.target.value || null })}>
            <option value="">Choose a condition</option>
            {Object.entries(conditionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Shown as" htmlFor={`${id}-display`}>
        <Select id={`${id}-display`} value={section.display} onChange={event => onChange({ ...section, display: event.target.value as "rail" | "grid" })}>
          <option value="rail">A row that slides</option>
          <option value="grid">A grid</option>
        </Select>
      </Field>
      <NumberField label="How many" value={section.limit} min={4} max={24} onChange={limit => onChange({ ...section, limit })} />
      <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3 text-sm">
        <span className="font-semibold">See all link</span>
        <Toggle label="See all link" checked={section.viewAll} onChange={viewAll => onChange({ ...section, viewAll })} />
      </div>
    </>
  );
}

function BannerForm({ section, onChange }: Props<"banner">) {
  return (
    <ItemList
      label="Banner"
      max={2}
      items={section.items}
      make={() => ({ image: null, title: "New banner", body: "", link: { kind: "href" as const, href: "/sell" }, tone: "navy" as const })}
      onChange={items => onChange({ ...section, items: items.length ? items : section.items })}
      render={(item, change) => <BannerFields item={item} change={change} />}
    />
  );
}

function BannerFields({ item, change }: { item: Of<"banner">["items"][number]; change: (next: Of<"banner">["items"][number]) => void }) {
  const id = useId();
  return (
    <>
      <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={item.image ?? ""} onChange={url => change({ ...item, image: url || null })} shape="wide" hint="Optional: else the colour below." />
      <TextField label="Title" value={item.title} max={80} required onChange={title => change({ ...item, title })} />
      <TextField label="Text" value={item.body} max={160} multiline onChange={body => change({ ...item, body })} />
      <Field label="Colour" htmlFor={id}>
        <Select id={id} value={item.tone} onChange={event => change({ ...item, tone: event.target.value as HomeTone })}>
          {Object.entries(toneLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <LinkField value={item.link} onChange={link => change({ ...item, link })} />
    </>
  );
}

function CountryTilesForm({ section, onChange }: Props<"country_tiles">) {
  const { markets } = useForm();
  const toggle = (country: string, on: boolean) => onChange({ ...section, countries: on ? [...section.countries, country] : section.countries.filter(code => code !== country) });
  return (
    <>
      <TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Countries</legend>
        <p className="text-xs text-muted">None ticked: every open market, as they open. Opening one remembers it as the visitor’s country.</p>
        {markets.map(market => (
          <label key={market.country} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={section.countries.includes(market.country)} onChange={event => toggle(market.country, event.target.checked)} />
            {market.name}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function HomeSectionForm({ section, onChange }: { section: HomeSection; onChange: (next: HomeSection) => void }) {
  switch (section.type) {
    case "home_hero":
      return <HeroForm section={section} onChange={onChange} />;
    case "category_masonry":
      return <MasonryForm section={section} onChange={onChange} />;
    case "deals_rail":
      return <DealsForm section={section} onChange={onChange} />;
    case "sponsored_rail":
      return <SponsoredForm section={section} onChange={onChange} />;
    case "top_selling_rail":
      return <TopSellingForm section={section} onChange={onChange} />;
    case "listing_group":
      return <GroupForm section={section} onChange={onChange} />;
    case "banner":
      return <BannerForm section={section} onChange={onChange} />;
    case "country_tiles":
      return <CountryTilesForm section={section} onChange={onChange} />;
    case "trust_bar":
      return <StoreSectionForm section={section as StoreSection} onChange={next => onChange(next as HomeSection)} />;
  }
}

const icons = { home_hero: LayoutPanelTop, category_masonry: LayoutGrid, deals_rail: BadgePercent, sponsored_rail: Megaphone, top_selling_rail: TrendingUp, listing_group: Rows3, banner: ImageIcon, country_tiles: Globe2, trust_bar: ShieldCheck };

/** A new section of each type, valid as the API expects. */
function newSection(type: HomeSection["type"], id: string): HomeSection {
  const base = { id, span: full, hidden: false };
  switch (type) {
    case "home_hero":
      return { ...base, type, style: "search", title: "Buy and sell near you", accent: "", subtitle: "", slides: [] };
    case "category_masonry":
      return { ...base, type, title: "Shop by category", tiles: [], limit: 8 };
    case "deals_rail":
      return { ...base, type, title: "Trending deals", days: 14, limit: 12, category: null };
    case "sponsored_rail":
      return { ...base, type, title: "Sponsored", limit: 8 };
    case "top_selling_rail":
      return { ...base, type, title: "Top selling", fallbackTitle: "Popular", minimum: 4, limit: 12 };
    case "listing_group":
      return { ...base, type, title: "Just listed", by: "newest", value: null, display: "rail", limit: 8, viewAll: true };
    case "banner":
      return { ...base, type, items: [{ image: null, title: "Sell what you no longer use", body: "Post an ad in minutes. Listing is free.", link: { kind: "href", href: "/sell" }, tone: "brand" }] };
    case "country_tiles":
      return { ...base, type, title: "Shop by country", countries: [] };
    case "trust_bar":
      return { ...base, type, items: [{ icon: "shield", title: "Safe pay", body: "Udozo holds the money until you have the item." }] };
  }
}

function summary(section: HomeSection): string {
  switch (section.type) {
    case "home_hero":
      return section.style === "carousel" ? `Carousel · ${section.slides.length} slide${section.slides.length === 1 ? "" : "s"}` : heroStyles[section.style];
    case "category_masonry":
      return section.tiles.length ? section.tiles.map(tile => tile.slug || "—").join(", ") : `The ${section.limit} busiest categories`;
    case "deals_rail":
      return [`Price drops in ${section.days} days`, section.category ? `in ${section.category}` : null, `up to ${section.limit}`].filter(Boolean).join(" · ");
    case "sponsored_rail":
      return `Sponsored placements · up to ${section.limit}`;
    case "top_selling_rail":
      return `Safe pay sales in 30 days (else “${section.fallbackTitle}”) · up to ${section.limit}`;
    case "listing_group":
      return [groupLabels[section.by] + (section.value ? `: ${section.value}` : ""), section.display, `up to ${section.limit}`].join(" · ");
    case "banner":
      return section.items.map(item => `${item.title} → ${homeLinkText(item.link)}`).join(" · ");
    case "country_tiles":
      return section.countries.length ? section.countries.join(", ") : "Every open market";
    case "trust_bar":
      return `${section.items.length} item${section.items.length === 1 ? "" : "s"}`;
  }
}

function title(section: HomeSection): string {
  if (section.type === "trust_bar") return section.items.map(item => item.title).join(" · ");
  if (section.type === "banner") return section.items[0]?.title ?? "";
  return section.title;
}

/** udozo.com's home page sections for the shared editor. */
export const homeRegistry = defineRegistry<HomeSection>({
  types: [
    { type: "home_hero", label: "Hero", description: "The top of the page: search, a carousel of slides, or a short welcome." },
    { type: "category_masonry", label: "Category tiles", description: "Categories as photo tiles of different sizes: chosen, or the busiest." },
    { type: "deals_rail", label: "Trending deals", description: "Listings whose price came down lately (a country’s page)." },
    { type: "sponsored_rail", label: "Sponsored", description: "Listings placed by Udozo’s team, labelled Sponsored." },
    { type: "top_selling_rail", label: "Top selling", description: "What sold most with Safe pay; until then, the most contacted." },
    { type: "listing_group", label: "Listing group", description: "Newest, trending, or one category’s, area’s or condition’s listings." },
    { type: "banner", label: "Banners", description: "One or two banners linking to a category, a search or a page." },
    { type: "country_tiles", label: "Countries", description: "Each open market, for the page across countries." },
    { type: "trust_bar", label: "Trust bar", description: "Up to four short reassurances, such as Safe pay." },
  ],
  newSection,
  summary,
  title,
  icon: type => icons[type],
  Form: HomeSectionForm,
});
