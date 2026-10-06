"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import type { SearchEntry } from "@/lib/nav";

const score = (entry: SearchEntry, words: string[]) => {
  const title = entry.title.toLowerCase();
  const haystack = `${title} ${entry.detail.toLowerCase()} ${entry.method?.toLowerCase() ?? ""}`;
  if (!words.every(word => haystack.includes(word))) return 0;
  let points = 1;
  for (const word of words) if (title.includes(word)) points += title.startsWith(word) ? 4 : 2;
  if (entry.kind === "Guide") points += 1;
  return points;
};

/** Search guides, sections, endpoints and events (⌘K or Ctrl K, or /). Everything is searched in the browser. */
export function Search({ index }: { index: SearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return index.filter(entry => entry.kind === "Guide").slice(0, 8);
    return index
      .map(entry => ({ entry, points: score(entry, words) }))
      .filter(item => item.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 12)
      .map(item => item.entry);
  }, [index, query]);

  const go = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    setQuery("");
    router.push(entry.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-500 hover:border-slate-300 md:w-full md:max-w-sm md:px-3"
        aria-label="Search the documentation"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate text-left md:inline">Search</span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 font-sans text-[11px] text-slate-400 sm:inline">Ctrl K</kbd>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#070f4c]/40 p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
            <label className="flex items-center gap-3 border-b border-slate-200 px-4">
              <SearchIcon className="size-5 text-slate-400" aria-hidden />
              <span className="sr-only">Search</span>
              <input
                ref={input}
                value={query}
                onChange={event => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={event => {
                  if (event.key === "Escape") setOpen(false);
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive(current => Math.min(results.length - 1, current + 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive(current => Math.max(0, current - 1));
                  }
                  if (event.key === "Enter") go(results[active]);
                }}
                placeholder="Orders, webhooks, insufficient_funds…"
                className="min-h-14 w-full bg-transparent text-base outline-none"
                aria-controls="search-results"
                aria-activedescendant={results[active] ? `result-${active}` : undefined}
              />
            </label>
            <ul id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
              {results.length === 0 ? <li className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches.</li> : null}
              {results.map((entry, position) => (
                <li key={`${entry.href}-${position}`} id={`result-${position}`} role="option" aria-selected={position === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(position)}
                    onClick={() => go(entry)}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${position === active ? "bg-pink-50" : ""}`}
                  >
                    <span className="mt-0.5 w-16 shrink-0 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{entry.method ?? entry.kind}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#070f4c]">{entry.title}</span>
                      <span className="block truncate text-xs text-slate-500">{entry.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
