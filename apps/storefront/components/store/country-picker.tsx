"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { StoreCountry } from "@bitocard/api-client/storefront";
import { Flag } from "./flag";

type Option = { value: string; label: string; flag: string | null };

/**
 * The search bar's country choice, with each country's flag. Submits as `country` with the search form (a hidden
 * field), so the form still works before this script loads.
 */
export function CountryPicker({ countries, value = "", className = "" }: { countries: StoreCountry[]; value?: string; className?: string }) {
  const id = useId();
  const options = useMemo<Option[]>(
    () => [
      { value: "", label: "All countries", flag: null },
      { value: "global", label: "Usable anywhere", flag: null },
      ...countries.map(country => ({ value: country.code, label: country.name, flag: country.code })),
    ],
    [countries],
  );
  const [selected, setSelected] = useState(value);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const filterField = useRef<HTMLInputElement>(null);
  const current = options.find(option => option.value.toLowerCase() === selected.toLowerCase()) ?? options[0];
  const shown = filter.trim() ? options.filter(option => option.label.toLowerCase().includes(filter.trim().toLowerCase()) || option.value.toLowerCase() === filter.trim().toLowerCase()) : options;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    // Straight into the filter with a mouse or keyboard; not on touch screens, where the keyboard would cover the list.
    if (window.matchMedia("(pointer: fine)").matches) filterField.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (option: Option) => {
    setSelected(option.value);
    setOpen(false);
    setFilter("");
  };

  return (
    <div
      ref={root}
      className={`relative ${className}`}
      onKeyDown={event => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <input type="hidden" name="country" value={current.value} />
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`Country: ${current.label}`}
        onClick={() => setOpen(value => !value)}
        className="flex h-full w-full min-w-0 items-center gap-2.5 px-4 text-left text-[15px] font-medium text-[#070f4c]"
      >
        <Flag code={current.flag} className="h-4 w-6" />
        <span className="min-w-0 flex-1 truncate">{current.label}</span>
        <ChevronDown className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+8px)] right-0 left-0 z-40 min-w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white text-[#070f4c] shadow-2xl sm:left-auto sm:w-72">
          <label className="flex items-center gap-2 border-b border-slate-100 px-3 focus-within:bg-slate-50">
            <Search className="size-4 text-slate-400" aria-hidden="true" />
            <span className="sr-only">Find a country</span>
            <input ref={filterField} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a country" className="min-h-11 w-full bg-transparent text-base outline-none focus-visible:outline-none sm:text-sm" />
          </label>
          <ul id={`${id}-list`} role="listbox" aria-label="Countries" className="max-h-[min(18rem,45svh)] overflow-y-auto overscroll-contain p-1.5">
            {shown.map(option => {
              const active = option.value === current.value;
              return (
                <li key={option.value || "all"} role="option" aria-selected={active}>
                  <button type="button" onClick={() => choose(option)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-slate-50 ${active ? "font-semibold" : ""}`}>
                    <Flag code={option.flag} className="h-4 w-6" />
                    <span className="flex-1">{option.label}</span>
                    {active ? <Check className="size-4 text-[#ff2382]" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">No country matches.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
