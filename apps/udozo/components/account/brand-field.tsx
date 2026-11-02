"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { ShopBrand } from "@bitocard/api-client/classifieds";
import { BrandLogo } from "@/components/brand-logo";
import { useDismiss } from "@/components/dropdown";
import { searchBrands } from "@/lib/shop-actions";

/** Letters and digits only, as the API matches brands and models ("mercedes benz" is Mercedes-Benz). */
export const brandMatchKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * A registry's field on the listing form: the list as soon as it opens, what matches as the seller types, and what they
 * typed when the list lacks it. `listKey` says when the list changes (a new category, a new brand).
 */
export function PickField<Item>({
  value,
  label,
  placeholder,
  listKey,
  load,
  nameOf,
  keyOf,
  icon,
  hint,
  leading,
  freshHint,
  onChange,
  onPick,
}: {
  value: string;
  label: string;
  placeholder: string;
  listKey: string;
  load: (words: string) => Promise<Item[] | null>;
  nameOf: (item: Item) => string;
  keyOf: (item: Item) => string;
  icon?: (item: Item) => ReactNode;
  hint?: (item: Item) => string | undefined;
  /** What sits at the field's start, given the list's entry matching what is typed. */
  leading?: (exact: Item | null) => ReactNode;
  freshHint: string;
  onChange: (value: string) => void;
  onPick: (item: Item) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const loader = useRef(load);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Item[]>([]);
  const [active, setActive] = useState(-1);
  useDismiss(box, open, () => setOpen(false), () => input.current);
  useEffect(() => {
    loader.current = load;
  });

  const words = value.trim();
  useEffect(() => {
    if (!open) return;
    let current = true;
    const wait = setTimeout(
      async () => {
        const items = await loader.current(words);
        if (current && items) {
          setOptions(items);
          setActive(-1);
        }
      },
      words ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [open, words, listKey]);

  const exact = options.find(item => brandMatchKey(nameOf(item)) === brandMatchKey(words)) ?? null;
  const fresh = words.length >= 1 && !exact;
  const total = options.length + (fresh ? 1 : 0);

  const choose = (item: Item | null) => {
    if (item) onPick(item);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative w-44 sm:w-56">
      <span className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pr-1 pl-1.5 focus-within:border-slate-400">
        {leading?.(exact)}
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={event => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (total) setActive(index => (event.key === "ArrowDown" ? (index + 1) % total : (index - 1 + total) % total));
            } else if (event.key === "Enter" && open && active >= 0) {
              event.preventDefault();
              choose(active < options.length ? options[active]! : null);
            }
          }}
          className="min-w-0 flex-1 bg-transparent pl-1 text-sm outline-none"
        />
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => (open ? setOpen(false) : input.current?.focus())} className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
          <ChevronDown className="size-4" />
        </button>
      </span>
      {open && total ? (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`} className="absolute top-11 right-0 z-20 grid max-h-72 w-64 max-w-[calc(100vw-2rem)] gap-0.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((item, index) => (
            <li
              key={keyOf(item)}
              id={`${id}-${index}`}
              role="option"
              aria-selected={brandMatchKey(nameOf(item)) === brandMatchKey(words)}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(item)}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm ${index === active ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              {icon?.(item)}
              <span className="min-w-0 flex-1 truncate">
                {nameOf(item)}
                {hint?.(item) ? <span className="block truncate text-xs text-slate-600">{hint(item)}</span> : null}
              </span>
            </li>
          ))}
          {fresh ? (
            <li
              id={`${id}-${options.length}`}
              role="option"
              aria-selected={false}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(null)}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-700 ${active === options.length ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Use “{words}”<span className="block text-xs font-normal text-slate-600">{freshHint}</span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The brand field of the listing form: the category's brands with their logos as soon as it opens, those matching what
 * the seller types, and the brand as typed when it is not in the list yet (Udozo saves it and looks at adding it).
 */
export function BrandField({ value, categoryId, label, onChange, onPick }: { value: string; categoryId: string | null; label: string; onChange: (value: string) => void; onPick?: (brand: ShopBrand) => void }) {
  const [known, setKnown] = useState<ShopBrand | null>(null);
  return (
    <PickField<ShopBrand>
      value={value}
      label={label}
      placeholder="Choose or type it"
      listKey={categoryId ?? ""}
      load={async words => {
        const result = await searchBrands(words, categoryId);
        return result.ok ? result.data : null;
      }}
      nameOf={brand => brand.name}
      keyOf={brand => brand.slug}
      icon={brand => <BrandLogo brand={brand} size="sm" />}
      leading={exact => {
        const shown = known && brandMatchKey(known.name) === brandMatchKey(value) ? known : exact;
        return shown ? <BrandLogo brand={shown} size="sm" /> : null;
      }}
      freshHint="Not in the list yet: we will look at adding it."
      onChange={onChange}
      onPick={brand => {
        setKnown(brand);
        if (onPick) onPick(brand);
        else onChange(brand.name);
      }}
    />
  );
}
