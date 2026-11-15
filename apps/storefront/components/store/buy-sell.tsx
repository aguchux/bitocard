"use client";

import { type ReactNode, useId, useState } from "react";

/**
 * Buy or Sell on a gift card's page, where the card can be sold: two tabs over the buy form and the sell form. Both
 * stay mounted, so switching never loses what was typed. `?sell=1` opens on Sell.
 */
export function BuySell({ buy, sell, initial = "buy" }: { buy: ReactNode; sell: ReactNode; initial?: "buy" | "sell" }) {
  const id = useId();
  const [tab, setTab] = useState<"buy" | "sell">(initial);
  const tabs = [
    { key: "buy" as const, label: "Buy" },
    { key: "sell" as const, label: "Sell" },
  ];
  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Buy or sell this card" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {tabs.map(item => (
          <button
            key={item.key}
            id={`${id}-${item.key}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            aria-controls={`${id}-${item.key}`}
            onClick={() => setTab(item.key)}
            className={`min-h-11 rounded-xl font-display text-base font-bold transition ${tab === item.key ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`${id}-buy`} role="tabpanel" aria-labelledby={`${id}-buy-tab`} hidden={tab !== "buy"}>
        {buy}
      </div>
      <div id={`${id}-sell`} role="tabpanel" aria-labelledby={`${id}-sell-tab`} hidden={tab !== "sell"}>
        {sell}
      </div>
    </div>
  );
}
