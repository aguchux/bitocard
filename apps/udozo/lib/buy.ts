import type { ShopListingPage, ShopViewer } from "@bitocard/api-client/classifieds";

/** How the Buy with Safe pay button reads and where it goes, from what the buyer already has with the listing. */
export function buyButton(listing: Pick<ShopListingPage, "status" | "reserved" | "price"> & Partial<Pick<ShopListingPage, "in_stock">>, viewer: ShopViewer | null, buyPath: string, safePayOpen: boolean) {
  if (listing.status !== "active" || viewer?.own) return null;
  if (viewer?.order) return { href: buyPath, label: `Continue Safe pay order ${viewer.order.number}` };
  if (!safePayOpen) return null;
  // Out of stock (none to sell) or every unit held for other buyers: nothing to pay for.
  if (listing.in_stock === false || listing.reserved) return null;
  if (listing.price.kind === "on_request" || listing.price.amount === null) return null;
  return { href: buyPath, label: "Buy with Safe pay" };
}

