import { PackageCheck, PackageX } from "lucide-react";

/**
 * How many the seller has left, on a live listing's page: "3 in stock", "Last one in stock", or "Out of stock" (buying
 * is closed until the seller restocks). Older answers without `in_stock` say nothing.
 */
export function StockLine({ inStock, available }: { inStock?: boolean; available?: number }) {
  if (inStock === undefined) return null;
  if (!inStock) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
        <PackageX className="size-3.5" aria-hidden="true" /> Out of stock
      </span>
    );
  }
  const text = available === undefined ? "In stock" : available <= 0 ? "All held for other buyers" : available === 1 ? "Last one in stock" : `${available.toLocaleString("en-GB")} in stock`;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-mint-50 px-3 py-1 text-xs font-bold text-mint-700">
      <PackageCheck className="size-3.5" aria-hidden="true" /> {text}
    </span>
  );
}

/** The card's badge over its photo while a listing is out of stock. */
export function OutOfStockBadge() {
  return <span className="rounded-full bg-navy-900/85 px-2 py-0.5 text-[11px] font-bold text-white">Out of stock</span>;
}
