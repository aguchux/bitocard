"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { type BrandGridSection, type CategoryGridSection, categoryLabels, type HeroSection, type ProductCategory, type ProductRailSection, type ProductSource, type ProductSpotlightSection } from "@bitocard/api-client/storefront";
import { errorMessage } from "../format";
import { useDebouncedValue } from "../ui/hooks";
import { ImageField } from "../ui/image-field";
import { Button, Field, Input, Select, Skeleton, Textarea } from "../ui/primitives";
import { Notice, RefreshFailed } from "../ui/status";
import { type FormProps, useSources, categoryKeys, sourceOptions, optional, SwitchRow, TitleFields } from "./inspector-fields";

export function HeroForm({ section, onChange }: FormProps<HeroSection>) {
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

export function ProductRailForm({ section, onChange }: FormProps<ProductRailSection>) {
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

export function CategoryGridForm({ section, onChange }: FormProps<CategoryGridSection>) {
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

export function BrandGridForm({ section, onChange }: FormProps<BrandGridSection>) {
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


export function ProductSpotlightForm({ section, onChange }: FormProps<ProductSpotlightSection>) {
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
