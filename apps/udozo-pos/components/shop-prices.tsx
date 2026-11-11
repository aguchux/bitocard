"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { money, type PosShopPrices, readAmount } from "@/lib/pos";
import { setShopPrice, shopPrices } from "@/lib/pos-actions";

/**
 * A product's price in each shop (milestone 9): a shop may sell it at its own price, which its tills charge, even
 * offline; everywhere else, udozo.com included, the listing's price stands. Needs `prices` for staff.
 */
export function ShopPrices({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [prices, setPrices] = useState<PosShopPrices | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = (data: PosShopPrices) => {
    setPrices(data);
    setDrafts(Object.fromEntries(data.shops.map(shop => [shop.shop_id, shop.own && shop.price !== null ? (shop.price / 100).toFixed(2) : ""])));
  };
  const open = () => {
    setMessage(null);
    dialog.current?.showModal();
    start(async () => {
      const result = await shopPrices(id);
      if (result.ok) load(result.data);
      else setMessage({ ok: false, text: result.message });
    });
  };
  const save = (shopId: string, value: string | null) =>
    start(async () => {
      const amount = value === null ? null : readAmount(value);
      if (value !== null && (amount === null || amount < 1)) return setMessage({ ok: false, text: "Give the price, like 1500 or 1500.50." });
      const result = await setShopPrice(id, shopId, amount);
      if (!result.ok) return setMessage({ ok: false, text: result.message });
      load(result.data);
      const shop = result.data.shops.find(item => item.shop_id === shopId);
      setMessage({ ok: true, text: value === null ? `${shop?.name ?? "The shop"} sells it at the listing's price again.` : `${shop?.name ?? "The shop"} now sells it at ${money(amount!, result.data.currency)}.` });
      router.refresh();
    });

  return (
    <>
      <button type="button" onClick={open} className="w-fit text-left text-sm font-semibold text-pos-700 underline">
        Prices per shop<span className="sr-only"> ({title})</span>
      </button>
      <dialog ref={dialog} aria-labelledby={`${ids}-title`} className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 shadow-xl sm:m-auto sm:max-w-lg sm:rounded-3xl">
        <div className="grid gap-4 p-5 sm:p-6">
          <div>
            <h2 id={`${ids}-title`} className="font-display text-xl font-bold text-pos-ink">
              {title}: prices per shop
            </h2>
            <p className="mt-1 text-sm text-pos-ink-2">
              {prices ? `udozo.com and every shop without its own price: ${prices.udozo_price === null ? "no price" : money(prices.udozo_price, prices.currency)}.` : "Reading the prices…"}
            </p>
          </div>
          {prices ? (
            <ul className="grid gap-3">
              {prices.shops.map(shop => (
                <li key={shop.shop_id} className="grid gap-2 rounded-xl border border-pos-line p-3">
                  <label htmlFor={`${ids}-${shop.shop_id}`} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-pos-ink">{shop.name}</span>
                    <span className="text-sm text-pos-muted">{shop.own ? `Its own price, set by ${shop.by}` : "The listing's price"}</span>
                  </label>
                  <span className="flex flex-wrap gap-2">
                    <input id={`${ids}-${shop.shop_id}`} inputMode="decimal" value={drafts[shop.shop_id] ?? ""} onChange={event => setDrafts(current => ({ ...current, [shop.shop_id]: event.target.value }))} placeholder={prices.udozo_price === null ? "Price" : (prices.udozo_price / 100).toFixed(2)} className="h-11 min-w-0 flex-1 rounded-xl border border-pos-line px-3" />
                    <button type="button" disabled={pending || !drafts[shop.shop_id]?.trim()} onClick={() => save(shop.shop_id, drafts[shop.shop_id] ?? "")} className="h-11 rounded-xl bg-pos-600 px-4 font-bold text-white disabled:opacity-50">
                      Save<span className="sr-only"> {shop.name}&apos;s price</span>
                    </button>
                    {shop.own ? (
                      <button type="button" disabled={pending} onClick={() => save(shop.shop_id, null)} className="h-11 rounded-xl border border-pos-line px-4 font-semibold disabled:opacity-50">
                        Use the listing&apos;s price<span className="sr-only"> at {shop.name}</span>
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {message ? (
            <p role={message.ok ? "status" : "alert"} className={message.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
              {message.text}
            </p>
          ) : null}
          <button type="button" onClick={() => dialog.current?.close()} className="h-12 rounded-xl border border-pos-line font-semibold">
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
