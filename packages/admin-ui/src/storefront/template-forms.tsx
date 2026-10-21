"use client";

import { useId } from "react";
import { type CryptoQuoteSection, type P2pMarketSection, type QuickBuyCategory, type QuickBuySection } from "@bitocard/api-client/storefront";
import { Field, Select } from "../ui/primitives";
import { type FormProps, useSources, quickBuyLabels, TitleFields } from "./inspector-fields";

export function QuickBuyForm({ section, onChange }: FormProps<QuickBuySection>) {
  const sells = useSources().categories;
  const offered = (Object.keys(quickBuyLabels) as QuickBuyCategory[]).filter(category => !sells || sells.includes(category));
  const toggle = (category: QuickBuyCategory) => {
    const next = section.categories.includes(category) ? section.categories.filter(item => item !== category) : [...section.categories, category];
    if (next.length) onChange({ ...section, categories: next });
  };
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Tabs</legend>
        <p className="text-xs text-muted">At least one; shown in the order you tick them.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {offered.map(category => {
            const position = section.categories.indexOf(category);
            return (
              <label key={category} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-500" checked={position >= 0} onChange={() => toggle(category)} />
                <span className="flex-1">{quickBuyLabels[category]}</span>
                {position >= 0 ? <span className="text-xs font-semibold text-brand-600">{position + 1}</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

export function CryptoQuoteForm({ section, onChange }: FormProps<CryptoQuoteSection>) {
  const id = useId();
  const coins = useSources().coins ?? ["USDT", "USDC", "BTC", "ETH", "BNB", "TRX"];
  const toggle = (coin: string) => onChange({ ...section, assets: section.assets.includes(coin) ? section.assets.filter(item => item !== coin) : [...section.assets, coin].slice(0, 9) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Coins offered</legend>
        <p className="text-xs text-muted">None ticked: every coin on sale.</p>
        <div className="flex flex-wrap gap-2">
          {coins.map(coin => (
            <label key={coin} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-500" checked={section.assets.includes(coin)} onChange={() => toggle(coin)} />
              {coin}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Shown first" htmlFor={`${id}-side`}>
        <Select id={`${id}-side`} value={section.side} onChange={event => onChange({ ...section, side: event.target.value as "buy" | "sell" })}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </Select>
      </Field>
    </>
  );
}

export function P2pMarketForm({ section, onChange }: FormProps<P2pMarketSection>) {
  const id = useId();
  const coins = useSources().coins ?? ["USDT", "USDC", "BTC", "ETH", "BNB", "TRX"];
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      <Field label="Coin" htmlFor={`${id}-asset`}>
        <Select id={`${id}-asset`} value={section.asset} onChange={event => onChange({ ...section, asset: event.target.value })}>
          {[...new Set([section.asset, ...coins])].map(coin => (
            <option key={coin} value={coin}>
              {coin}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
