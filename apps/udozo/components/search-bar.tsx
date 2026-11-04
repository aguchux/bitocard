"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Clock, Search, Sparkles, TrendingUp, X } from "lucide-react";
import type { ShopSuggestions } from "@bitocard/api-client/classifieds";
import type { SearchSuggestions } from "@/lib/discovery";
import { useAssistant } from "./assistant";

/**
 * The Shop's search: a GET form to the country's `/search` (it works without script), with suggestions as the buyer
 * types (categories, then titles of live listings like it), read from this site's own `/api/suggest`. Where the
 * country's assistant answers, Ask hands what was typed to it ("Describe what you want"). Focused and empty, it offers
 * the person's recent searches (each can be removed) and the market's popular ones (`/api/searches`). `blended`: inside
 * the header's bar beside the Categories menu, which draws the border.
 */
export function SearchBar({ country, q = "", area, state, autoFocus, blended = false }: { country: string; q?: string; area?: string | null; state?: string | null; autoFocus?: boolean; blended?: boolean }) {
  const cc = country.toLowerCase();
  const [value, setValue] = useState(q);
  const [suggestions, setSuggestions] = useState<ShopSuggestions | null>(null);
  const [open, setOpen] = useState(false);
  const list = useId();
  const form = useRef<HTMLFormElement>(null);
  const assistant = useAssistant();
  const [before, setBefore] = useState<SearchSuggestions | null>(null);

  // Before anything is typed: recent and popular searches, read again each time the box is focused.
  const loadBefore = () => {
    fetch(`/api/searches?country=${cc}`, { cache: "no-store" })
      .then(res => (res.ok ? (res.json() as Promise<SearchSuggestions>) : null))
      .then(data => setBefore(data && Array.isArray(data.recent) && Array.isArray(data.popular) ? data : null))
      .catch(() => undefined);
  };
  const removeRecent = (text: string) => {
    setBefore(current => (current ? { ...current, recent: current.recent.filter(item => item !== text) } : current));
    void fetch(`/api/searches?country=${cc}&q=${encodeURIComponent(text)}`, { method: "DELETE" }).catch(() => undefined);
  };
  const searchFor = (text: string) => {
    setValue(text);
    setOpen(false);
    // The input is controlled: submit once React has written the chosen words into it.
    requestAnimationFrame(() => form.current?.requestSubmit());
  };

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
  const empty = open && !value.trim() && before && (before.recent.length || before.popular.length) ? before : null;
  const popular = empty ? empty.popular.filter(text => !empty.recent.includes(text)) : [];

  return (
    <form ref={form} action={`/${cc}/search`} method="get" role="search" className={blended ? "relative min-w-0 flex-1" : "relative"} onSubmit={() => setOpen(false)}>
      <label className={blended ? "flex h-full items-center gap-2 px-3 text-navy-600" : "flex h-12 items-center gap-2.5 rounded-2xl bg-white px-3.5 text-navy-600 focus-within:ring-2 focus-within:ring-brand-500"}>
        <Search className="size-5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          name="q"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            loadBefore();
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Phones, cars, flats, generators…"
          aria-label="Search Udozo"
          aria-autocomplete="list"
          aria-controls={shown || empty ? list : undefined}
          aria-expanded={Boolean(shown || empty)}
          role="combobox"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          autoFocus={autoFocus}
          // `w-0`: the field fills what the bar leaves, never asking for the browser's 20 characters (which widened phones' pages).
          className="w-0 min-w-0 flex-1 bg-transparent text-[15px] font-medium text-navy-900 outline-none placeholder:text-navy-500"
        />
        {assistant.available ? (
          <button
            type="button"
            onClick={() => assistant.open({ question: value.trim() || undefined })}
            className="flex h-8 shrink-0 items-center gap-1 rounded-xl bg-navy-50 px-2.5 text-sm font-semibold text-navy-900 hover:bg-navy-100"
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
                onClick={() => searchFor(text)}
              >
                <Search className="size-4 shrink-0 text-navy-400" aria-hidden="true" /> {text}
              </button>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <BeforeTyping id={list} recent={empty.recent} popular={popular} onSearch={searchFor} onRemove={removeRecent} />
      ) : null}
    </form>
  );
}

const heading = "px-3.5 pt-1.5 pb-1 text-xs font-bold tracking-wide text-navy-500 uppercase";

/** Recent searches (with remove) and the market's popular searches, shown in the empty, focused search box. */
export function BeforeTyping({ id, recent, popular, onSearch, onRemove }: { id: string; recent: string[]; popular: string[]; onSearch: (text: string) => void; onRemove: (text: string) => void }) {
  const keep = (event: React.MouseEvent) => event.preventDefault();
  return (
    <div id={id} className="absolute inset-x-0 top-full z-30 mt-1.5 grid gap-1 overflow-hidden rounded-2xl border border-navy-200 bg-white py-1.5 text-sm text-navy-900 shadow-lg">
      {recent.length ? (
        <div role="group" aria-label="Your recent searches">
          <p className={heading}>Recent searches</p>
          <ul>
            {recent.map(text => (
              <li key={text} className="flex items-center hover:bg-navy-50">
                <button type="button" onMouseDown={keep} onClick={() => onSearch(text)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3.5 text-left">
                  <Clock className="size-4 shrink-0 text-navy-400" aria-hidden="true" />
                  <span className="truncate">{text}</span>
                </button>
                <button type="button" onMouseDown={keep} onClick={() => onRemove(text)} aria-label={`Remove ${text} from your recent searches`} className="grid size-10 shrink-0 place-items-center text-navy-500 hover:text-navy-900">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {popular.length ? (
        <div role="group" aria-label="Popular searches">
          <p className={heading}>Popular searches</p>
          <ul>
            {popular.map(text => (
              <li key={text}>
                <button type="button" onMouseDown={keep} onClick={() => onSearch(text)} className="flex min-h-10 w-full items-center gap-2 px-3.5 text-left hover:bg-navy-50">
                  <TrendingUp className="size-4 shrink-0 text-navy-400" aria-hidden="true" />
                  <span className="truncate">{text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
