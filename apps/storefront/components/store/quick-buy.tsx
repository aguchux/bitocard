"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { QuickBuyCategory, StoreProduct } from "@bitocard/api-client/storefront";
import { quickBuyHref, quickBuyNeeds } from "@/lib/quick-buy";

type Tab = { category: QuickBuyCategory; label: string; products: StoreProduct[] };

/**
 * Top up or pay a bill at once: the tab, the network or biller (each product on sale), the number and, for any-amount
 * top-ups, the amount; then the product's page opens with them filled in, where the price is quoted and paid.
 */
export function QuickBuyForm({ id, tabs, tone }: { id: string; tabs: Tab[]; tone: "light" | "hero" }) {
  const router = useRouter();
  const [tab, setTab] = useState(tabs[0]?.category);
  const current = tabs.find(item => item.category === tab) ?? tabs[0];
  const [productKey, setProductKey] = useState(current?.products[0]?.key ?? "");
  const product = useMemo(() => current?.products.find(item => item.key === productKey) ?? current?.products[0], [current, productKey]);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  if (!current || !product) return <p className="text-sm text-slate-500">Top-ups are not on sale here yet.</p>;
  const needs = quickBuyNeeds(current.category, product);
  const field = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-navy-900";
  const label = tone === "hero" ? "block text-sm font-semibold text-[var(--st-hero-ink)]" : "block text-sm font-semibold text-navy-900";
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        router.push(quickBuyHref(product.key, { number, amount: needs.amount ? amount : "" }));
      }}
      className="space-y-4"
      aria-label="Quick buy"
    >
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="What do you need?" className="flex flex-wrap gap-2">
          {tabs.map(item => (
            <button
              key={item.category}
              type="button"
              role="tab"
              aria-selected={item.category === current.category}
              onClick={() => {
                setTab(item.category);
                setProductKey(item.products[0]?.key ?? "");
              }}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${item.category === current.category ? "bg-brand-500 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] lg:items-end">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-product`} className={label}>
            {current.category === "bills" || current.category === "pay_tv" ? "Biller" : "Network and plan"}
          </label>
          <select id={`${id}-product`} value={product.key} onChange={event => setProductKey(event.target.value)} className={field}>
            {current.products.map(item => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-number`} className={label}>
            {needs.numberLabel}
          </label>
          <input id={`${id}-number`} value={number} onChange={event => setNumber(event.target.value)} inputMode={needs.numberMode} autoComplete={needs.numberMode === "tel" ? "tel" : "off"} required className={field} />
        </div>
        {needs.amount ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-amount`} className={label}>
              Amount ({product.face_currency})
            </label>
            <input id={`${id}-amount`} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" required className={field} />
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}
        <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 font-semibold text-white hover:bg-brand-600 sm:col-span-2 lg:col-span-1">
          Continue <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
