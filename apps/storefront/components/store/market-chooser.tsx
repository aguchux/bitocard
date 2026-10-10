"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Globe2, Search, X } from "lucide-react";
import type { StoreCountry } from "@bitocard/api-client/storefront";
import { chooseMarket } from "@/app/(store)/market-action";
import { Flag } from "./flag";

/**
 * Where the shopper is buying from. On the first visit (no choice remembered) a dialog asks for their country from the
 * markets on sale, or to stay global; the choice is kept in a cookie and the store then leaves out other countries'
 * local products (their airtime, data, bills…). The header button shows the choice and changes it.
 */
export function MarketChooser({ countries, market, locked = false }: { countries: StoreCountry[]; market: string | null; locked?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const current = market && market !== "global" ? countries.find(country => country.code === market) : null;
  const words = filter.trim().toLowerCase();
  const shown = countries.filter(country => !words || country.name.toLowerCase().includes(words) || country.code.toLowerCase() === words);

  // Ask on the first visit, once the page has loaded.
  useEffect(() => {
    if (market === null && !dialog.current?.open) dialog.current?.showModal();
  }, [market]);

  const choose = (value: string) =>
    startTransition(async () => {
      await chooseMarket(value);
      dialog.current?.close();
    });

  // Signed in, the market is the customer's own country (chosen at sign-up and fixed): shown, not changed.
  if (locked) {
    return (
      <span title="Your account's country" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] font-semibold text-[#070f4c] sm:px-3">
        <Flag code={market} className="h-4 w-6" />
        <span className="hidden max-w-28 truncate sm:inline">{current?.name ?? market}</span>
        <span className="sr-only">, your account&apos;s country</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={current ? `Shopping in ${current.name}. Change country` : "Shopping globally. Choose your country"}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] font-semibold text-[#070f4c] hover:bg-slate-50 sm:px-3"
      >
        <Flag code={current?.code ?? null} className="h-4 w-6" />
        <span className="hidden max-w-28 truncate sm:inline">{current ? current.name : "Global"}</span>
        <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl p-0 text-[#070f4c] shadow-2xl backdrop:bg-[#070f4c]/50"
        onClose={() => setFilter("")}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              Where are you shopping from?
            </h2>
            <p className="mt-1 text-sm text-slate-600">We’ll show products for your country, plus everything usable anywhere. You can change this at any time.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="grid size-10 shrink-0 place-items-center rounded-xl hover:bg-slate-50">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {countries.length > 8 ? (
            <label className="relative flex items-center">
              <span className="sr-only">Find your country</span>
              <Search className="pointer-events-none absolute left-3 size-4 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Find your country"
                className="min-h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-[15px] focus:border-[#070f4c] focus:ring-2 focus:ring-[#070f4c]/15"
              />
            </label>
          ) : null}
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Countries">
            {shown.map(country => (
              <li key={country.code}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(country.code)}
                  aria-pressed={market === country.code}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  <Flag code={country.code} className="h-4 w-6" />
                  <span className="flex-1">{country.name}</span>
                  {market === country.code ? <Check className="size-4 text-[#ff2382]" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">No country matches.</li> : null}
          </ul>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            disabled={pending}
            onClick={() => choose("global")}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-[15px] font-semibold hover:border-slate-300 disabled:opacity-60"
          >
            <Globe2 className="size-5" aria-hidden="true" />
            Stay global: show everything
            {market === "global" ? <Check className="size-4 text-[#ff2382]" aria-hidden="true" /> : null}
          </button>
        </div>
      </dialog>
    </>
  );
}
