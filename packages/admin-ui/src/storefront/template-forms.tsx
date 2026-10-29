"use client";

import { useId } from "react";
import { type ListingGridSection, type ListingRailSection, type QuickBuyCategory, type QuickBuySection, type ResaleCategoriesSection } from "@bitocard/api-client/storefront";
import { Field, Input, Select } from "../ui/primitives";
import { type FormProps, useSources, quickBuyLabels, TitleFields } from "./inspector-fields";

export function QuickBuyForm({ section, onChange }: FormProps<QuickBuySection>) {
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


/** A Resale shop's category picker: every category of the reseller's country, or a typed slug when the list is not loaded. */
function ResaleCategoryField({ value, onChange, allowAll }: { value: string | undefined; onChange: (slug: string | undefined) => void; allowAll: boolean }) {
  const id = useId();
  const list = useSources().resaleCategories;
  return (
    <Field label="Category" htmlFor={`${id}-category`}>
      {list ? (
        <Select id={`${id}-category`} value={value ?? ""} onChange={event => onChange(event.target.value || undefined)}>
          {allowAll ? <option value="">Every category</option> : <option value="">Choose a category</option>}
          {list.map(category => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
      ) : (
        <Input id={`${id}-category`} value={value ?? ""} placeholder="phones" onChange={event => onChange(event.target.value.trim() || undefined)} />
      )}
    </Field>
  );
}

function LimitField({ value, max, onChange }: { value: number; max: number; onChange: (limit: number) => void }) {
  const id = useId();
  return (
    <Field label="How many" htmlFor={`${id}-limit`} hint={`1 to ${max}.`}>
      <Input id={`${id}-limit`} type="number" min={1} max={max} value={value} onChange={event => onChange(Math.max(1, Math.min(max, Number(event.target.value) || 1)))} />
    </Field>
  );
}

export function ListingRailForm({ section, onChange }: FormProps<ListingRailSection>) {
  const id = useId();
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <Field label="Shows" htmlFor={`${id}-source`}>
        <Select id={`${id}-source`} value={section.source} onChange={event => onChange({ ...section, source: event.target.value as ListingRailSection["source"] })}>
          <option value="newest">Newest listings</option>
          <option value="price_low">Lowest price first</option>
          <option value="category">One category</option>
        </Select>
      </Field>
      {section.source === "category" ? <ResaleCategoryField value={section.category} allowAll={false} onChange={category => onChange({ ...section, category })} /> : null}
      <LimitField value={section.limit} max={24} onChange={limit => onChange({ ...section, limit })} />
    </>
  );
}

export function ListingGridForm({ section, onChange }: FormProps<ListingGridSection>) {
  const id = useId();
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <ResaleCategoryField value={section.category} allowAll onChange={category => onChange({ ...section, category })} />
      <Field label="Order" htmlFor={`${id}-sort`}>
        <Select id={`${id}-sort`} value={section.sort} onChange={event => onChange({ ...section, sort: event.target.value as ListingGridSection["sort"] })}>
          <option value="newest">Newest first</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </Select>
      </Field>
      <LimitField value={section.limit} max={48} onChange={limit => onChange({ ...section, limit })} />
    </>
  );
}

export function ResaleCategoriesForm({ section, onChange }: FormProps<ResaleCategoriesSection>) {
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <p className="text-xs text-muted">Shows the categories you have listings in, most first, each with one listing’s photo.</p>
      <LimitField value={section.limit} max={12} onChange={limit => onChange({ ...section, limit })} />
    </>
  );
}