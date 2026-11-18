"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { StoreCountry } from "@bitocard/api-client/storefront";
import { Flag } from "./flag";

type Currency = { code: string; symbol: string; flag: string; name: string };

/** The narrow symbol (₦, GH₵) of a currency, else its code. */
function symbolOf(code: string) {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find(item => item.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

function nameOf(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** US dollars, then the currencies of the markets in the country picker (BitoCard's switched-on African markets). */
export function currencyChoices(countries: StoreCountry[]): Currency[] {
  const choices: Currency[] = [{ code: "USD", symbol: "$", flag: "us", name: "US dollar" }];
  for (const country of [...countries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!country.currency || choices.some(item => item.code === country.currency)) continue;
    choices.push({ code: country.currency, symbol: symbolOf(country.currency), flag: country.code.toLowerCase(), name: nameOf(country.currency) });
  }
  return choices;
}

/**
 * The currency to pay in: US dollars or one of the markets' currencies. Prices are face values in each product's own
 * currency, and the choice is not remembered (the site sets no cookies or storage for it until the cookie notice says so).
 */
export function CurrencyMenu({ countries }: { countries: StoreCountry[] }) {
  const currencies = currencyChoices(countries);
  const [selected, setSelected] = useState("USD");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = currencies.find(item => item.code === selected) ?? currencies[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={root} className="relative" onKeyDown={event => event.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Currency: ${current.code}`}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold whitespace-nowrap text-navy-900 hover:border-slate-300"
      >
        <Flag code={current.flag} className="h-3.5 w-5" />
        {current.code}
        <span className="-ml-1 xl:max-2xl:hidden">({current.symbol})</span>
        <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+8px)] right-0 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-1.5 text-navy-900 shadow-2xl">
          <ul role="listbox" aria-label="Currency">
            {currencies.map(item => (
              <li key={item.code} role="option" aria-selected={item.code === selected}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(item.code);
                    setOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-slate-50 ${item.code === selected ? "font-semibold" : ""}`}
                >
                  <Flag code={item.flag} className="h-4 w-6" />
                  <span className="flex-1">
                    {item.code} <span className="text-slate-500">· {item.name}</span>
                  </span>
                  {item.code === selected ? <Check className="size-4 text-brand-500" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-3 pt-2 pb-1.5 text-xs text-slate-500">Prices show each product&apos;s face value. You choose how to pay at checkout.</p>
        </div>
      ) : null}
    </div>
  );
}
