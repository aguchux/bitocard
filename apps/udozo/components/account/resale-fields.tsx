"use client";

import Link from "next/link";
import { ScanBarcode, Store } from "lucide-react";
import { shopMoney, type ShopPosStatus, type ShopResaleAvailability } from "@bitocard/api-client/classifieds";
import { posUrl } from "@/lib/connect";
import { bpsText, resaleSums } from "@/lib/shop";

/** Where it sells: Udozo, resellers' stores, and the seller's own shop through Udozo POS (with what its till needs). */
export type SellWhere = { onShop: boolean; resale: boolean; discountBps: number; markupMaxBps: number; stock: number; pos: boolean; barcode: string; reorderLevel: string };

/** Where a new listing starts: on Udozo, not resold, none in stock until the seller says; the resale terms at the country's smallest discount. */
export function sellWhereFrom(
  listing: { on_shop: boolean; resale: { enabled: boolean; discount_bps: number | null; markup_max_bps: number | null }; stock: number; pos_enabled?: boolean; barcode?: string | null; reorder_level?: number | null } | null,
  availability: ShopResaleAvailability | null,
): SellWhere {
  const limits = availability ?? { discount_min_bps: 500, markup_max_bps: 3000 };
  return {
    onShop: listing?.on_shop ?? true,
    resale: listing?.resale.enabled ?? false,
    discountBps: listing?.resale.discount_bps ?? limits.discount_min_bps,
    markupMaxBps: listing?.resale.markup_max_bps ?? Math.min(2000, limits.markup_max_bps),
    stock: listing?.stock ?? 0,
    pos: listing?.pos_enabled ?? false,
    barcode: listing?.barcode ?? "",
    reorderLevel: listing?.reorder_level === null || listing?.reorder_level === undefined ? "" : String(listing.reorder_level),
  };
}

/**
 * Whether the seller can tick Sell at POS now, and what to say: no Udozo POS yet (set it up at pos.udozo.com), its plan's
 * product limit reached (untick another or upgrade), or how many they have used. A listing already ticked can always stay.
 */
export function posOption(status: ShopPosStatus | null, ticked: boolean): { allowed: boolean; note: string } {
  if (ticked) return { allowed: true, note: "Your shop's till sells it from the same stock, and shows it as soon as it is live." };
  if (!status) return { allowed: false, note: "Udozo POS could not be checked just now. Try again shortly." };
  if (!status.account) return { allowed: false, note: "Set up your shop on Udozo POS first: it is free to start." };
  const { used, limit } = status.products;
  if (limit !== null && used >= limit) return { allowed: false, note: `Your ${status.plan?.name ?? "plan"} sells ${limit} products at your shop, and all are used. Untick another listing, or choose a bigger plan on Udozo POS.` };
  return { allowed: true, note: limit === null ? "Sold at your shop's till from the same stock." : `Sold at your shop's till from the same stock (${used} of ${limit} on ${status.plan?.name ?? "your plan"}).` };
}

/** The resale terms as the API takes them, sent together so a listing never holds half of them. */
export const resaleChanges = (value: SellWhere) => ({ resale: value.resale, resale_discount_bps: value.discountBps, resale_markup_max_bps: value.markupMaxBps });

/** Out of stock, an ad stays live this long, then Anjio takes it off (the API's `outOfStockDays`). */
export const outOfStockDays = 90;

/** What the stock box holds: a whole number from 0 (out of stock) to 100,000. */
export const stockFrom = (typed: string) => Math.max(0, Math.min(100000, Math.floor(Number(typed) || 0)));

/** The stock as the summary reads it. */
export const stockText = (stock: number) => (stock > 0 ? `${stock.toLocaleString("en-GB")} in stock` : "Out of stock");

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
  pos = null,
  shopCategory = false,
  priceMinor,
  priceOnRequest,
  currency,
  invalid,
  onChange,
}: {
  value: SellWhere;
  availability: ShopResaleAvailability | null;
  /** Whether the seller has Udozo POS and room in its plan (null: not known). */
  pos?: ShopPosStatus | null;
  /** Its category sells only at the seller's shop (a pharmacy's medicines): never on Udozo or through resellers. */
  shopCategory?: boolean;
  priceMinor: number | null;
  priceOnRequest: boolean;
  currency: string;
  invalid: (param: string) => boolean;
  /** `save` names the fields to save now; sliders save once let go, the barcode and reorder level once left. */
  onChange: (next: SellWhere, save: Array<"on_shop" | "resale" | "stock" | "pos_enabled" | "pos_details">) => void;
}) {
  const sums = resaleSums(priceMinor, value.discountBps, value.markupMaxBps);
  const money = (minor: number) => shopMoney(minor, currency);
  const open = availability?.open ?? false;
  // The identity check counts only where the market requires it (older answers say nothing: required).
  const identityMissing = Boolean(availability && !availability.identity_checked && availability.identity_required !== false);
  const box = "size-5 shrink-0 accent-brand-700";
  const shop = shopCategory ? { allowed: false, note: "Its category is sold only at your shop with Udozo POS: it never shows on Udozo or with resellers." } : posOption(pos, value.pos);
  const field = (param: string) => `h-12 rounded-xl border bg-white px-3 text-base font-normal ${invalid(param) ? "border-brand-600" : "border-slate-200"}`;
  return (
    <section aria-labelledby="sell-where" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="sell-where" className="text-base font-bold">
        Where to sell
      </h2>
      <label className="grid max-w-sm gap-1.5 text-sm font-semibold">
        How many do you have in stock?
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={value.stock}
          onChange={event => onChange({ ...value, stock: stockFrom(event.target.value) }, ["stock"])}
          className={`h-12 max-w-56 rounded-xl border bg-white px-3 text-base font-normal ${invalid("stock") ? "border-brand-600" : "border-slate-200"}`}
        />
        <span className="text-xs font-normal text-slate-600">
          {value.stock > 0
            ? "Each sale takes one, wherever it is sold. When none are left, buyers can no longer buy it."
            : `With none in stock, buyers can see it and chat but cannot buy it. It stays up ${outOfStockDays} days, then Anjio takes it off unless you restock.`}
        </span>
      </label>
      <div className="grid gap-3">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className={box} checked={value.onShop} disabled={shopCategory} onChange={event => onChange({ ...value, onShop: event.target.checked }, ["on_shop"])} />
          <span>
            <span className="font-semibold">Sell on Udozo</span>
            <span className="block text-slate-600">Buyers find it on Udozo and contact you.</span>
          </span>
        </label>
        <label className={`flex items-start gap-3 text-sm ${open ? "" : "opacity-60"}`}>
          <input type="checkbox" className={box} checked={value.resale} disabled={shopCategory || (!open && !value.resale)} onChange={event => onChange({ ...value, resale: event.target.checked }, ["resale"])} />
          <span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Store className="size-4 text-brand-700" aria-hidden="true" />
              Let resellers sell this
            </span>
            <span className="block text-slate-600">
              {open
                ? "Resellers sell it on their own stores and earn a discount; you hand it to their buyer, paid through UdozoPay."
                : availability?.reason === "not_set_up"
                  ? "Udozo is still setting up selling through resellers in your country. You can turn it on here once it opens."
                  : "Selling through resellers is not open in your country yet."}
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-3 text-sm ${shop.allowed ? "" : "opacity-70"}`}>
          <input type="checkbox" className={box} checked={value.pos} disabled={!shop.allowed} onChange={event => onChange({ ...value, pos: event.target.checked }, ["pos_enabled"])} />
          <span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ScanBarcode className="size-4 text-brand-700" aria-hidden="true" />
              Sell at your shop with Udozo POS
            </span>
            <span className="block text-slate-600">
              {shop.note}{" "}
              {!shopCategory && (!pos?.account || !shop.allowed) ? (
                <a href={pos?.account ? `${posUrl}/app/billing` : `${posUrl}/signup`} target="_blank" rel="noopener" className="font-semibold text-brand-700 underline">
                  {pos?.account ? "See the plans" : "Set up Udozo POS"}
                </a>
              ) : null}
            </span>
            {value.pos && !value.onShop && !value.resale ? <span className="mt-1 block text-xs font-semibold text-navy-900">At your shop only: it never shows on Udozo.</span> : null}
          </span>
        </label>
        {invalid("on_shop") ? <p className="text-sm font-semibold text-brand-700">Choose at least one.</p> : null}
      </div>

      {value.pos ? (
        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold">
            Barcode (optional)
            <input
              value={value.barcode}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={48}
              placeholder="Scan or type it"
              aria-invalid={invalid("barcode") || undefined}
              onChange={event => onChange({ ...value, barcode: event.target.value }, [])}
              onBlur={() => onChange(value, ["pos_details"])}
              className={field("barcode")}
            />
            <span className="text-xs font-normal text-slate-600">What your till scans. Most packaging has one; a code of your own works too.</span>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Reorder level (optional)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              value={value.reorderLevel}
              aria-invalid={invalid("reorder_level") || undefined}
              onChange={event => onChange({ ...value, reorderLevel: event.target.value }, [])}
              onBlur={() => onChange(value, ["pos_details"])}
              className={field("reorder_level")}
            />
            <span className="text-xs font-normal text-slate-600">Udozo POS marks it low on stock at this many or fewer.</span>
          </label>
        </div>
      ) : null}

      {value.resale ? (
        <div className="grid gap-4 border-t border-slate-100 pt-4">
          {availability?.checks_waived && open ? (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">Udozo is testing reselling here: no identity check or payout account is needed to let resellers sell this item for now.</p>
          ) : null}
          {availability && !availability.ready && open ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Before posting:{" "}
              {identityMissing ? (
                <Link href="/account/verification" className="font-semibold underline">
                  finish your identity check
                </Link>
              ) : null}
              {identityMissing && !availability.payout_account ? " and " : null}
              {!availability.payout_account ? (
                <Link href="/account/udozopay" className="font-semibold underline">
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
