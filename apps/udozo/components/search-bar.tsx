"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import type { ShopSuggestions } from "@bitocard/api-client/classifieds";
import { useAssistant } from "./assistant";

/**
 * The Shop's search: a GET form to the country's `/search` (it works without script), with suggestions as the buyer
 * types (categories, then titles of live listings like it), read from this site's own `/api/suggest`. Where the
 * country's assistant answers, Ask hands what was typed to it ("Describe what you want").
 */
export function SearchBar({ country, q = "", area, state, autoFocus }: { country: string; q?: string; area?: string | null; state?: string | null; autoFocus?: boolean }) {
  const cc = country.toLowerCase();
  const [value, setValue] = useState(q);
  const [suggestions, setSuggestions] = useState<ShopSuggestions | null>(null);
  const [open, setOpen] = useState(false);
  const list = useId();
  const form = useRef<HTMLFormElement>(null);
  const assistant = useAssistant();

  useEffect(() => {
    const words = value.trim();
    if (words.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/suggest?country=${cc}&q=${encodeURIComponent(words)}`, { signal: controller.signal })
        .then(res => (res.ok ? (res.json() as Promise<ShopSuggestions>) : null))
        .then(data => setSuggestions(data))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, cc]);

  const shown = open && value.trim().length >= 2 && suggestions && (suggestions.categories.length || suggestions.queries.length) ? suggestions : null;

  return (
    <form ref={form} action={`/${cc}/search`} method="get" role="search" className="relative" onSubmit={() => setOpen(false)}>
      <label className="flex h-12 items-center gap-2.5 rounded-2xl bg-white px-3.5 text-navy-600 focus-within:ring-2 focus-within:ring-brand-500">
        <Search className="size-5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          name="q"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Phones, cars, flats, jobs…"
          aria-label="Search the Shop"
          aria-autocomplete="list"
          aria-controls={shown ? list : undefined}
          aria-expanded={Boolean(shown)}
          role="combobox"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-navy-900 outline-none placeholder:text-navy-500"
        />
        {assistant.available ? (
          <button
            type="button"
            onClick={() => assistant.open({ question: value.trim() || undefined })}
            className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-navy-50 px-2.5 text-sm font-semibold text-navy-900 hover:bg-navy-100"
            aria-label={`Describe what you want to ${assistant.name}`}
          >
            <Sparkles className="size-4 text-brand-700" aria-hidden="true" /> <span className="hidden sm:inline">Ask {assistant.name}</span>
          </button>
        ) : null}
      </label>
      {area ? <input type="hidden" name="area" value={area} /> : null}
      {state ? <input type="hidden" name="state" value={state} /> : null}
      {shown ? (
        <ul id={list} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border border-navy-200 bg-white py-1.5 text-sm text-navy-900 shadow-lg">
          {shown.categories.map(category => (
            <li key={category.slug} role="option" aria-selected="false">
              <Link href={`/${cc}/c/${category.slug}`} className="flex items-baseline justify-between gap-3 px-3.5 py-2 hover:bg-navy-50">
                <strong>{category.name}</strong>
                {category.parent ? <span className="text-xs text-navy-500">in {category.parent.name}</span> : null}
              </Link>
            </li>
          ))}
          {shown.queries.map(text => (
            <li key={text} role="option" aria-selected="false">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-navy-50"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  setValue(text);
                  setOpen(false);
                  // The input is controlled: submit once React has written the chosen words into it.
                  requestAnimationFrame(() => form.current?.requestSubmit());
                }}
              >
                <Search className="size-4 shrink-0 text-navy-400" aria-hidden="true" /> {text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
