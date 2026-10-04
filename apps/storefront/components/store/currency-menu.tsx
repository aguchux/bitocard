"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Flag } from "./flag";

const currencies = [
  { code: "USD", symbol: "$", flag: "us", name: "US dollar" },
  { code: "GBP", symbol: "£", flag: "gb", name: "British pound" },
  { code: "EUR", symbol: "€", flag: "eu", name: "Euro" },
  { code: "NGN", symbol: "₦", flag: "ng", name: "Nigerian naira" },
  { code: "GHS", symbol: "GH₵", flag: "gh", name: "Ghanaian cedi" },
  { code: "KES", symbol: "KSh", flag: "ke", name: "Kenyan shilling" },
] as const;

/**
 * The currency to pay in. Until checkout (M10b), prices are face values in each product's own currency, and the
 * choice is not remembered (the site sets no cookies or storage until the cookie notice says so).
 */
export function CurrencyMenu() {
  const [selected, setSelected] = useState<(typeof currencies)[number]["code"]>("USD");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = currencies.find(item => item.code === selected)!;

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
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-[#070f4c] hover:border-slate-300"
      >
        <Flag code={current.flag} className="h-3.5 w-5" />
        {current.code} ({current.symbol})
        <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+8px)] right-0 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-1.5 text-[#070f4c] shadow-2xl">
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
                  {item.code === selected ? <Check className="size-4 text-[#ff2382]" aria-hidden="true" /> : null}
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
