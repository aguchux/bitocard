"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { ShopBrand } from "@bitocard/api-client/classifieds";
import { BrandLogo } from "@/components/brand-logo";
import { useDismiss } from "@/components/dropdown";
import { searchBrands } from "@/lib/shop-actions";

/** Letters and digits only, as the API matches brands ("mercedes benz" is Mercedes-Benz). */
export const brandMatchKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * The brand field of the listing form: the category's brands with their logos as soon as it opens, those matching what
 * the seller types, and the brand as typed when it is not in the list yet (Udozo saves it and looks at adding it).
 */
export function BrandField({ value, categoryId, label, onChange }: { value: string; categoryId: string | null; label: string; onChange: (value: string) => void }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ShopBrand[]>([]);
  const [active, setActive] = useState(-1);
  const [known, setKnown] = useState<ShopBrand | null>(null);
  useDismiss(box, open, () => setOpen(false), () => input.current);

  const words = value.trim();
  useEffect(() => {
    if (!open) return;
    let current = true;
    const wait = setTimeout(
      async () => {
        const result = await searchBrands(words, categoryId);
        if (current && result.ok) {
          setOptions(result.data);
          setActive(-1);
        }
      },
      words ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [open, words, categoryId]);

  const exact = options.find(brand => brandMatchKey(brand.name) === brandMatchKey(words));
  const shown = known && brandMatchKey(known.name) === brandMatchKey(words) ? known : (exact ?? null);
  const fresh = words.length >= 1 && !exact;
  const total = options.length + (fresh ? 1 : 0);

  const choose = (brand: ShopBrand | null) => {
    if (brand) {
      setKnown(brand);
      onChange(brand.name);
    }
    setOpen(false);
  };

  return (
    <div ref={box} className="relative w-44 sm:w-56">
      <span className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pr-1 pl-1.5 focus-within:border-slate-400">
        {shown ? <BrandLogo brand={shown} size="sm" /> : null}
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          aria-label={label}
          value={value}
          placeholder="Choose or type it"
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
              choose(active < options.length ? options[active] : null);
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
          {options.map((brand, index) => (
            <li
              key={brand.slug}
              id={`${id}-${index}`}
              role="option"
              aria-selected={brandMatchKey(brand.name) === brandMatchKey(words)}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(brand)}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm ${index === active ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              <BrandLogo brand={brand} size="sm" />
              <span className="min-w-0 flex-1 truncate">{brand.name}</span>
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
                Use “{words}”<span className="block text-xs font-normal text-slate-600">Not in the list yet: we will look at adding it.</span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
