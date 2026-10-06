"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

const storageKey = "bitocard-docs-language";
const listeners = new Set<() => void>();
let chosen: string | null = null;

function readChoice() {
  if (chosen === null) {
    try {
      chosen = window.localStorage.getItem(storageKey) ?? "";
    } catch {
      chosen = "";
    }
  }
  return chosen;
}

function choose(language: string) {
  chosen = language;
  try {
    window.localStorage.setItem(storageKey, language);
  } catch {
    /* not remembered */
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export type CodeTab = { id: string; label: string; html: string; code: string };

/**
 * Code in several languages, highlighted at build time. Choosing a language here switches every example on the page,
 * and is remembered in this browser.
 */
export function CodeTabs({ tabs, title }: { tabs: CodeTab[]; title?: string }) {
  const preferred = useSyncExternalStore(subscribe, readChoice, () => "");
  const active = tabs.find(tab => tab.id === preferred) ?? tabs[0];
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-sm">
      <div className="flex items-center gap-1 border-b border-white/10 px-2">
        {title ? <span className="mr-2 hidden pl-2 text-xs font-semibold text-slate-400 sm:inline">{title}</span> : null}
        {tabs.length === 1 ? (
          <span className="min-h-10 flex-1 content-center px-3 text-xs font-semibold text-slate-300">{active.label}</span>
        ) : (
        <div role="tablist" aria-label="Language" className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              onClick={() => choose(tab.id)}
              className={`min-h-10 shrink-0 border-b-2 px-3 text-xs font-semibold ${tab.id === active.id ? "border-[#ff2382] text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
        <button type="button" onClick={() => void copy()} className="grid size-9 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Copy code">
          {copied ? <Check className="size-4 text-emerald-400" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
      <div role="tabpanel" className="code-panel" dangerouslySetInnerHTML={{ __html: active.html }} />
    </div>
  );
}

/** One block of code (a JSON example), with copy. */
export function CodeBlock({ html, code, title }: { html: string; code: string; title?: string }) {
  return <CodeTabs tabs={[{ id: "json", label: title ?? "JSON", html, code }]} />;
}
