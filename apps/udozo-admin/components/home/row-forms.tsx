"use client";

/* eslint-disable @next/next/no-img-element -- listings' photos and stores' logos come from the media CDN; thumbnails only. */
import { useId, useState } from "react";
import { Plus, Search, Store, X } from "lucide-react";
import { Button, Field, ImageField, Input, Select, Toggle, useDebouncedValue } from "@bitocard/admin-ui";
import type { EditorRow } from "@bitocard/admin-ui/storefront";
import { useClassifiedListingsQuery, useHomeStoresQuery } from "@bitocard/api-client/admin";
import type { HomeCard, HomeLink, HomeMasonryCell, HomeRow, HomeSection, HomeStoreCard, HomeTileSize, HomeTone } from "@bitocard/api-client/home";

/** What the row and block forms need from the page: its id, scope and the shared fields (from registry.tsx). */
export type RowFormKit = {
  page: string;
  scope: "global" | "country";
  TextField: (props: { label: string; value: string; max: number; onChange: (value: string) => void; hint?: string; required?: boolean; multiline?: boolean }) => React.ReactNode;
  NumberField: (props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; hint?: string }) => React.ReactNode;
  CategorySelect: (props: { label: string; value: string | null; onChange: (slug: string | null) => void; optional?: boolean }) => React.ReactNode;
  LinkField: (props: { value: HomeLink; onChange: (next: HomeLink) => void }) => React.ReactNode;
};

const image = { realm: "admin", purpose: "home_image" } as const;
const sizeLabels: Record<HomeTileSize, string> = { sm: "Small", wide: "Wide", tall: "Tall", lg: "Large" };
const toneLabels: Record<HomeTone, string> = { navy: "Navy", brand: "Brand colour", light: "Light" };
const speedLabels = { slow: "Slow", normal: "Normal", fast: "Fast" } as const;
const fillLabels = { none: "Only the ones picked", newest: "The newest", trending: "Trending", category: "A category's newest", deals: "Price drops" } as const;
const storeFillLabels = { none: "Only the ones picked", most_listings: "Most listings", newest: "Newest stores" } as const;
const backgroundLabels = { none: "None (the page)", soft: "Soft grey", navy: "Navy", brand: "Brand colour", image: "A photo" } as const;

type Of<T extends HomeSection["type"]> = Extract<HomeSection, { type: T }>;

function Choice<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: Record<T, string> | Partial<Record<T, string>>; onChange: (value: T) => void; hint?: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value} onChange={event => onChange(event.target.value as T)}>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text as string}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Listings picked by title or SKU (live ones in the page's country), kept in order; each can be moved or removed. */
export function ListingPicker({ kit, value, max, onChange }: { kit: RowFormKit; value: string[]; max: number; onChange: (refs: string[]) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const words = useDebouncedValue(q.trim());
  const results = useClassifiedListingsQuery({ status: "active", ...(kit.scope === "country" ? { country: kit.page.toUpperCase() } : {}), q: words }, { skip: words.length < 2 });
  const add = (ref: string, title: string) => {
    if (value.includes(ref) || value.length >= max) return;
    setNames(current => ({ ...current, [ref]: title }));
    onChange([...value, ref]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      <Field label={`Picked listings (${value.length} of ${max})`} htmlFor={id} hint="Search by title or SKU (PHN-000123). Sold or expired ones drop out by themselves.">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id={id} type="search" className="pl-9" placeholder="Search live listings" value={q} onChange={event => setQ(event.target.value)} />
        </div>
      </Field>
      {words.length >= 2 ? (
        <ul aria-label="Listings found" className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-line p-1">
          {(results.data?.data ?? []).slice(0, 12).map(listing => {
            const ref = String(listing.ref);
            const picked = value.includes(ref);
            return (
              <li key={listing.id}>
                <button type="button" disabled={picked || value.length >= max} onClick={() => add(ref, listing.title ?? `Listing ${ref}`)} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-canvas disabled:opacity-50">
                  {listing.photos[0]?.url ? <img src={listing.photos[0].url} alt="" className="size-9 shrink-0 rounded-md object-cover" /> : <span className="size-9 shrink-0 rounded-md bg-canvas" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{listing.title ?? "Untitled"}</span>
                    <span className="block text-xs text-muted">{[listing.sku, listing.country].filter(Boolean).join(" · ")}</span>
                  </span>
                  {picked ? <span className="text-xs text-muted">Picked</span> : <Plus className="size-4 text-brand-600" aria-hidden />}
                </button>
              </li>
            );
          })}
          {results.data && results.data.data.length === 0 ? <li className="p-2 text-sm text-muted">No live listing matches.</li> : null}
        </ul>
      ) : null}
      {value.length ? (
        <ol className="grid gap-1">
          {value.map((ref, index) => (
            <li key={ref} className="flex items-center gap-2 rounded-lg bg-canvas px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{names[ref] ?? `Listing ${ref}`}</span>
              <Button size="sm" variant="ghost" aria-label={`Move listing ${index + 1} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove listing ${index + 1}`} icon={<X className="size-4" aria-hidden />} onClick={() => onChange(value.filter(item => item !== ref))} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Resellers' stores live on their own domain in the page's country, picked by name, kept in order. */
export function StorePicker({ kit, value, onChange }: { kit: RowFormKit; value: string[]; onChange: (ids: string[]) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const words = useDebouncedValue(q.trim());
  const stores = useHomeStoresQuery({ page: kit.page, ...(words ? { q: words } : {}) });
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-3">
      <Field label={`Picked stores (${value.length} of 24)`} htmlFor={id} hint="Only stores live on their own domain show; a store that closes drops out by itself.">
        <Input id={id} type="search" placeholder="Search stores by name" value={q} onChange={event => setQ(event.target.value)} />
      </Field>
      <ul aria-label="Stores found" className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-line p-1">
        {(stores.data?.data ?? []).map(store => {
          const picked = value.includes(store.id);
          return (
            <li key={store.id}>
              <button
                type="button"
                disabled={picked || value.length >= 24}
                onClick={() => {
                  setNames(current => ({ ...current, [store.id]: store.name }));
                  onChange([...value, store.id]);
                }}
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-canvas disabled:opacity-50"
              >
                <StoreMark store={store} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{store.name}</span>
                  <span className="block truncate text-xs text-muted">{`${store.url.replace(/^https:\/\//, "")} · ${store.listings} listings`}</span>
                </span>
                {picked ? <span className="text-xs text-muted">Picked</span> : <Plus className="size-4 text-brand-600" aria-hidden />}
              </button>
            </li>
          );
        })}
        {stores.data && stores.data.data.length === 0 ? <li className="p-2 text-sm text-muted">No store is live on its own domain here yet.</li> : null}
      </ul>
      {value.length ? (
        <ol className="grid gap-1">
          {value.map((storeId, index) => (
            <li key={storeId} className="flex items-center gap-2 rounded-lg bg-canvas px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{names[storeId] ?? stores.data?.data.find(store => store.id === storeId)?.name ?? `Store ${index + 1}`}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove store ${index + 1}`} icon={<X className="size-4" aria-hidden />} onClick={() => onChange(value.filter(item => item !== storeId))} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StoreMark({ store }: { store: HomeStoreCard }) {
  return store.logo_url ? (
    <img src={store.logo_url} alt="" className="size-9 shrink-0 rounded-md object-contain ring-1 ring-line" />
  ) : (
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: store.primary_color }}>
      <Store className="size-4" />
    </span>
  );
}

export function ListingMarqueeForm({ kit, section, onChange }: { kit: RowFormKit; section: Of<"listing_marquee">; onChange: (next: HomeSection) => void }) {
  const fills = kit.scope === "global" ? { none: fillLabels.none, newest: fillLabels.newest, trending: fillLabels.trending } : fillLabels;
  return (
    <>
      <kit.TextField label="Title" value={section.title} max={80} hint="Optional: the row's heading may say it." onChange={title => onChange({ ...section, title })} />
      <ListingPicker kit={kit} value={section.picks} max={24} onChange={picks => onChange({ ...section, picks })} />
      <Choice label="Then fill with" value={section.fill.by} options={fills} onChange={by => onChange({ ...section, fill: { by, value: by === "category" ? section.fill.value : null } })} hint="Topped up to the number below, never repeating a listing shown above it." />
      {section.fill.by === "category" ? <kit.CategorySelect label="Category" value={section.fill.value} onChange={value => onChange({ ...section, fill: { by: "category", value } })} /> : null}
      <kit.NumberField label="Listings" value={section.limit} min={6} max={30} onChange={limit => onChange({ ...section, limit })} />
      <Choice label="Speed" value={section.speed} options={speedLabels} onChange={speed => onChange({ ...section, speed })} />
      <Choice label="Moves" value={section.direction} options={{ left: "Right to left", right: "Left to right" }} onChange={direction => onChange({ ...section, direction })} />
      <Choice label="Cards" value={section.cards} options={{ standard: "Standard", compact: "Compact" }} onChange={cards => onChange({ ...section, cards })} />
      <p className="text-xs text-muted">Visitors can pause it, it stops while pointed at, and it stands still for anyone who asks their device for less motion.</p>
    </>
  );
}

export function StoreMarqueeForm({ kit, section, onChange }: { kit: RowFormKit; section: Of<"store_marquee">; onChange: (next: HomeSection) => void }) {
  return (
    <>
      <kit.TextField label="Title" value={section.title} max={80} hint="Optional: the row's heading may say it." onChange={title => onChange({ ...section, title })} />
      <StorePicker kit={kit} value={section.picks} onChange={picks => onChange({ ...section, picks })} />
      <Choice label="Then fill with" value={section.fill} options={storeFillLabels} onChange={fill => onChange({ ...section, fill })} />
      <kit.NumberField label="Stores" value={section.limit} min={3} max={24} onChange={limit => onChange({ ...section, limit })} />
      <Choice label="Speed" value={section.speed} options={speedLabels} onChange={speed => onChange({ ...section, speed })} />
      <Choice label="Moves" value={section.direction} options={{ left: "Right to left", right: "Left to right" }} onChange={direction => onChange({ ...section, direction })} />
    </>
  );
}

type Tile = Of<"masonry_grid">["tiles"][number];

function TileFields({ kit, tile, change }: { kit: RowFormKit; tile: Tile; change: (next: Tile) => void }) {
  return (
    <>
      <Choice
        label="Tile shows"
        value={tile.kind}
        options={{ category: "A category", listing: "A listing", image: "A photo with a link" }}
        onChange={kind => change(kind === "category" ? { kind, slug: "", size: tile.size, image: null } : kind === "listing" ? { kind, ref: "", size: tile.size } : { kind, image: "", title: "", link: { kind: "href", href: "/" }, size: tile.size })}
      />
      <Choice label="Size" value={tile.size} options={sizeLabels} onChange={size => change({ ...tile, size })} />
      {tile.kind === "category" ? (
        <>
          <kit.CategorySelect label="Category" value={tile.slug || null} onChange={slug => change({ ...tile, slug: slug ?? "" })} />
          <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={tile.image ?? ""} onChange={url => change({ ...tile, image: url || null })} hint="Optional: else a photo of one of its listings." />
        </>
      ) : null}
      {tile.kind === "listing" ? <ListingPicker kit={kit} value={tile.ref ? [tile.ref] : []} max={1} onChange={refs => change({ ...tile, ref: refs[0] ?? "" })} /> : null}
      {tile.kind === "image" ? (
        <>
          <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={tile.image} onChange={url => change({ ...tile, image: url })} />
          <kit.TextField label="Words on it" value={tile.title} max={80} onChange={title => change({ ...tile, title })} />
          <kit.LinkField value={tile.link} onChange={link => change({ ...tile, link })} />
        </>
      ) : null}
    </>
  );
}

export function MasonryGridForm({ kit, section, onChange, ItemList }: { kit: RowFormKit; section: Of<"masonry_grid">; onChange: (next: HomeSection) => void; ItemList: <T>(props: { items: T[]; max: number; label: string; render: (item: T, change: (next: T) => void, index: number) => React.ReactNode; onChange: (next: T[]) => void; make: () => T }) => React.ReactNode }) {
  return (
    <>
      <kit.TextField label="Title" value={section.title} max={80} onChange={title => onChange({ ...section, title })} />
      <ItemList<Tile> items={section.tiles} max={16} label="Tile" make={() => ({ kind: "category", slug: "", size: "sm", image: null })} onChange={tiles => onChange({ ...section, tiles })} render={(tile, change) => <TileFields kit={kit} tile={tile} change={change} />} />
    </>
  );
}

export function CategoryBannerForm({ kit, section, onChange }: { kit: RowFormKit; section: Of<"category_banner">; onChange: (next: HomeSection) => void }) {
  return (
    <>
      <kit.CategorySelect label="Category" value={section.category || null} onChange={category => onChange({ ...section, category: category ?? "" })} />
      <kit.TextField label="Title" value={section.title} max={80} hint="Optional: else the category's name." onChange={title => onChange({ ...section, title })} />
      <kit.TextField label="Text" value={section.body} max={160} multiline onChange={body => onChange({ ...section, body })} />
      <ImageField label="Photo" realm={image.realm} purpose={image.purpose} value={section.image ?? ""} onChange={url => onChange({ ...section, image: url || null })} shape="wide" hint="Optional: else a photo of one of its live listings." />
      <Choice label="Colour" value={section.tone} options={toneLabels} onChange={tone => onChange({ ...section, tone })} />
      <Choice label="Style" value={section.style} options={{ split: "Words beside the photo", overlay: "Words on the photo" }} onChange={style => onChange({ ...section, style })} />
      <kit.TextField label="Button words" value={section.cta} max={30} onChange={cta => onChange({ ...section, cta })} />
      <Toggle label="Show how many listings it has" checked={section.showCount} onChange={showCount => onChange({ ...section, showCount })} />
    </>
  );
}

type ListOf = <T>(props: { items: T[]; max: number; label: string; render: (item: T, change: (next: T) => void, index: number) => React.ReactNode; onChange: (next: T[]) => void; make: () => T }) => React.ReactNode;

export function CategorySpotlightsForm({ kit, section, onChange, ItemList }: { kit: RowFormKit; section: Of<"category_spotlights">; onChange: (next: HomeSection) => void; ItemList: ListOf }) {
  return (
    <>
      <kit.TextField label="Title" value={section.title} max={80} hint="Optional: the row's heading usually names it." onChange={title => onChange({ ...section, title })} />
      <p className="text-xs text-muted">Each category&apos;s spotlight image is set on Marketplace › Categories (Pictures); a category without one shows its icon.</p>
      <ItemList<string>
        items={section.categories}
        max={30}
        label="Category"
        make={() => ""}
        onChange={categories => onChange({ ...section, categories })}
        render={(slug, change) => <kit.CategorySelect label="Category" value={slug || null} onChange={next => change(next ?? "")} />}
      />
      <p className="text-xs text-muted">None chosen: every top category open on the page, those with listings first.</p>
      <Choice label="Rows" value={String(section.rows) as "1" | "2" | "3"} options={{ 1: "One row", 2: "Two rows", 3: "Three rows" }} onChange={rows => onChange({ ...section, rows: Number(rows) })} />
      <p className="text-xs text-muted">Rows on computers, showing every category. Phones show one row to swipe.</p>
      <Toggle label="Show how many listings each has" checked={section.showCount} onChange={showCount => onChange({ ...section, showCount })} />
      <Toggle label="Show View all beside the title" checked={section.viewAll !== false} onChange={viewAll => onChange({ ...section, viewAll })} />
    </>
  );
}

/** A row's own settings: its heading, "See all", background, width and spacing. */
export function RowSettingsForm({ kit, row, onChange }: { kit: RowFormKit; row: EditorRow<HomeSection>; onChange: (next: EditorRow<HomeSection>) => void }) {
  const value = row as unknown as HomeRow;
  const set = (patch: Partial<HomeRow>) => onChange({ ...row, ...patch } as unknown as EditorRow<HomeSection>);
  return (
    <>
      <kit.TextField label="Heading" value={value.title} max={80} hint="Optional: shown above the row's blocks." onChange={title => set({ title })} />
      <kit.TextField label="Words under the heading" value={value.subtitle} max={200} onChange={subtitle => set({ subtitle })} />
      <Toggle label="A “See all” link" checked={Boolean(value.viewAll)} onChange={on => set({ viewAll: on ? { kind: "category", slug: "" } : null })} />
      {value.viewAll ? <kit.LinkField value={value.viewAll} onChange={viewAll => set({ viewAll })} /> : null}
      <Choice label="Background" value={value.background} options={backgroundLabels} onChange={background => set({ background })} hint="Navy, brand and photo backgrounds run edge to edge with white words." />
      {value.background === "image" ? <ImageField label="Background photo" realm={image.realm} purpose={image.purpose} value={value.image ?? ""} onChange={url => set({ image: url || null })} shape="wide" /> : null}
      <Choice label="Width" value={value.width} options={{ contained: "The page's width", full: "Edge to edge" }} onChange={width => set({ width })} />
      <Choice label="Space around it" value={value.spacing} options={{ tight: "Tight", normal: "Normal", loose: "Roomy" }} onChange={spacing => set({ spacing })} />
    </>
  );
}

/** A new row's settings: no heading, the page's background, its width. */
export const blankRow = () => ({ hidden: false, title: "", subtitle: "", viewAll: null, background: "none", image: null, width: "contained", spacing: "normal" }) as unknown as Omit<EditorRow<HomeSection>, "id" | "blocks">;

/** What a block will show, drawn small on its card: photos, logos or the banner, or a warning when it shows nothing. */
export function BlockThumb({ block, resolved }: { block: HomeSection; resolved: unknown }) {
  // A personal row is a placeholder (`data: { kind }`): udozo.com fills it for each visitor, so there is nothing to show.
  if (block.type === "personal_rail") return <p className="rounded-lg bg-canvas px-2 py-1.5 text-xs text-muted">Filled for each visitor when the page loads: nothing to preview here.</p>;
  const data = (resolved as { data?: Record<string, unknown> } | undefined)?.data;
  if (!data) return null;
  const items = (data.items as HomeCard[] | undefined) ?? [];
  const stores = (data.stores as HomeStoreCard[] | undefined) ?? [];
  const tiles = (data.tiles as Array<HomeMasonryCell & { name?: string }> | undefined) ?? [];
  const banner = data.category !== undefined ? (data as { category: { name: string; listings: number } | null; title?: string; image?: string | null }) : null;
  const empty = <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800">Nothing to show here now: visitors will not see it.</p>;
  if (banner) {
    if (!banner.category) return empty;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-canvas p-1.5">
        {banner.image ? <img src={banner.image} alt="" className="h-10 w-16 shrink-0 rounded object-cover" /> : null}
        <span className="min-w-0 truncate text-xs">{`${banner.title || banner.category.name} · ${banner.category.listings} listings`}</span>
      </div>
    );
  }
  if ("stores" in data) {
    if (!stores.length) return empty;
    return (
      <ul aria-label="Stores it will show" className="flex flex-wrap gap-1">
        {stores.slice(0, 6).map(store => (
          <li key={store.id} title={store.name}>
            <StoreMark store={store} />
          </li>
        ))}
        {stores.length > 6 ? <li className="self-center text-xs text-muted">{`+${stores.length - 6}`}</li> : null}
      </ul>
    );
  }
  if ("items" in data && Array.isArray(data.items)) {
    if (!items.length) return empty;
    return (
      <ul aria-label="Listings it will show" className="flex flex-wrap gap-1">
        {items.slice(0, 6).map(card => (
          <li key={card.id} title={card.title}>
            {card.cover?.url ? <img src={card.cover.url} alt="" className="size-9 rounded-md object-cover" /> : <span className="block size-9 rounded-md bg-canvas" />}
          </li>
        ))}
        {items.length > 6 ? <li className="self-center text-xs text-muted">{`+${items.length - 6}`}</li> : null}
      </ul>
    );
  }
  if ("tiles" in data) {
    if (!tiles.length) return empty;
    return (
      <ul aria-label="Tiles it will show" className="flex flex-wrap gap-1">
        {tiles.slice(0, 6).map((tile, index) => (
          <li key={index} title={tile.title ?? tile.name}>
            {tile.image ? <img src={tile.image} alt="" className="size-9 rounded-md object-cover" /> : <span className="block size-9 rounded-md bg-canvas" />}
          </li>
        ))}
      </ul>
    );
  }
  if ("countries" in data && Array.isArray(data.countries) && data.countries.length === 0) return empty;
  return null;
}
