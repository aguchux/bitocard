"use client";

import Link from "next/link";
import { Store } from "lucide-react";
import { shopMoney, type ShopResaleAvailability } from "@bitocard/api-client/classifieds";
import { bpsText, resaleSums } from "@/lib/shop";

export type SellWhere = { onShop: boolean; resale: boolean; discountBps: number; markupMaxBps: number; stock: number };

/** Where a new listing starts: on Udozo, not resold, one unit; the resale terms at the country's smallest discount. */
export function sellWhereFrom(listing: { on_shop: boolean; resale: { enabled: boolean; discount_bps: number | null; markup_max_bps: number | null }; stock: number } | null, availability: ShopResaleAvailability | null): SellWhere {
  const limits = availability ?? { discount_min_bps: 500, markup_max_bps: 3000 };
  return {
    onShop: listing?.on_shop ?? true,
    resale: listing?.resale.enabled ?? false,
    discountBps: listing?.resale.discount_bps ?? limits.discount_min_bps,
    markupMaxBps: listing?.resale.markup_max_bps ?? Math.min(2000, limits.markup_max_bps),
    stock: listing?.stock ?? 1,
  };
}

/** The resale terms as the API takes them, sent together so a listing never holds half of them. */
export const resaleChanges = (value: SellWhere) => ({ resale: value.resale, resale_discount_bps: value.discountBps, resale_markup_max_bps: value.markupMaxBps });

const slider = "h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-700";

/**
 * Post an ad's "Where to sell" (B2B reselling): how many there are (one stock for every channel), Udozo and
 * resellers' stores (at least one), and when resellers may sell it, the discount they earn and how far above the price
 * they may sell, inside Udozo's limits, with what that means at the price typed. Resellers can never change what is
 * written here; their stores name the seller.
 */
export function ResaleFields({
  value,
  availability,
  priceMinor,
  priceOnRequest,
  currency,
  invalid,
  onChange,
}: {
  value: SellWhere;
  availability: ShopResaleAvailability | null;
  priceMinor: number | null;
  priceOnRequest: boolean;
  currency: string;
  invalid: (param: string) => boolean;
  /** `save` names the fields to save now; sliders save once let go. */
  onChange: (next: SellWhere, save: Array<"on_shop" | "resale" | "stock">) => void;
}) {
  const sums = resaleSums(priceMinor, value.discountBps, value.markupMaxBps);
  const money = (minor: number) => shopMoney(minor, currency);
  const open = availability?.open ?? false;
  const box = "size-5 shrink-0 accent-brand-700";
  return (
    <section aria-labelledby="sell-where" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="sell-where" className="text-base font-bold">
        Where to sell
      </h2>
      <label className="grid max-w-56 gap-1.5 text-sm font-semibold">
        How many do you have?
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          value={value.stock}
          onChange={event => onChange({ ...value, stock: Math.max(1, Math.min(100000, Math.floor(Number(event.target.value) || 1))) }, ["stock"])}
          className={`h-12 rounded-xl border bg-white px-3 text-base font-normal ${invalid("stock") ? "border-brand-600" : "border-slate-200"}`}
        />
        <span className="text-xs font-normal text-slate-600">Each sale takes one, wherever it is sold.</span>
      </label>
      <div className="grid gap-3">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className={box} checked={value.onShop} onChange={event => onChange({ ...value, onShop: event.target.checked }, ["on_shop"])} />
          <span>
            <span className="font-semibold">Sell on Udozo</span>
            <span className="block text-slate-600">Buyers find it on Udozo and contact you.</span>
          </span>
        </label>
        <label className={`flex items-start gap-3 text-sm ${open ? "" : "opacity-60"}`}>
          <input type="checkbox" className={box} checked={value.resale} disabled={!open && !value.resale} onChange={event => onChange({ ...value, resale: event.target.checked }, ["resale"])} />
          <span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Store className="size-4 text-brand-700" aria-hidden="true" />
              Let resellers sell this
            </span>
            <span className="block text-slate-600">
              {open ? "Resellers sell it on their own stores and earn a discount; you hand it to their buyer, paid through Safe pay." : "Selling through resellers is not open in your country yet."}
            </span>
          </span>
        </label>
        {invalid("on_shop") ? <p className="text-sm font-semibold text-brand-700">Choose at least one.</p> : null}
      </div>

      {value.resale ? (
        <div className="grid gap-4 border-t border-slate-100 pt-4">
          {availability && !availability.ready && open ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Before posting:{" "}
              {!availability.identity_checked ? (
                <Link href="/account/verification" className="font-semibold underline">
                  finish your identity check
                </Link>
              ) : null}
              {!availability.identity_checked && !availability.payout_account ? " and " : null}
              {!availability.payout_account ? (
                <Link href="/account/safe-pay" className="font-semibold underline">
                  add a payout bank account
                </Link>
              ) : null}
              .
            </p>
          ) : null}
          {priceOnRequest ? <p className="text-sm font-semibold text-brand-700">Resellers sell at a price: give one above to let them sell it.</p> : null}
          {availability ? (
            <>
              <label className="grid gap-2 text-sm font-semibold">
                <span className="flex items-baseline justify-between gap-3">
                  Resellers&apos; discount
                  <output className="text-base font-bold text-navy-900">{bpsText(value.discountBps)}</output>
                </span>
                <input
                  type="range"
                  className={slider}
                  min={availability.discount_min_bps}
                  max={availability.discount_max_bps}
                  step={50}
                  value={value.discountBps}
                  aria-invalid={invalid("resale_discount_bps") || undefined}
                  onChange={event => onChange({ ...value, discountBps: Number(event.target.value) }, [])}
                  onPointerUp={() => onChange(value, ["resale"])}
                  onKeyUp={() => onChange(value, ["resale"])}
                />
                <span className="text-xs font-normal text-slate-600">
                  What a reseller earns off your price ({bpsText(availability.discount_min_bps)} to {bpsText(availability.discount_max_bps)}).
                </span>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                <span className="flex items-baseline justify-between gap-3">
                  Highest they may sell above your price
                  <output className="text-base font-bold text-navy-900">{bpsText(value.markupMaxBps)}</output>
                </span>
                <input
                  type="range"
                  className={slider}
                  min={0}
                  max={availability.markup_max_bps}
                  step={50}
                  value={value.markupMaxBps}
                  aria-invalid={invalid("resale_markup_max_bps") || undefined}
                  onChange={event => onChange({ ...value, markupMaxBps: Number(event.target.value) }, [])}
                  onPointerUp={() => onChange(value, ["resale"])}
                  onKeyUp={() => onChange(value, ["resale"])}
                />
                <span className="text-xs font-normal text-slate-600">Resellers never sell below your price; this is how far above it they may go (at most {bpsText(availability.markup_max_bps)}).</span>
              </label>
            </>
          ) : null}
          <div className="rounded-xl bg-slate-50 p-3 text-sm" aria-live="polite">
            {sums ? (
              <>
                <p>
                  When a reseller sells it, you receive <strong>{money(sums.net)}</strong> before Udozo&apos;s fees.
                </p>
                <p className="text-slate-600">
                  They sell it from {money(priceMinor!)} to {money(sums.top)}, and keep the difference.
                </p>
              </>
            ) : (
              <p className="text-slate-600">Give a price to see what you would receive.</p>
            )}
          </div>
          <p className="text-xs text-slate-600">Resellers&apos; stores show your photos and words exactly as you wrote them, with your name, and link to your page. A reseller&apos;s note shows only if you approve it.</p>
        </div>
      ) : null}
    </section>
  );
}
