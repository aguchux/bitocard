import type { ShopListingPage, ShopViewer } from "@bitocard/api-client/classifieds";

/** How the Buy with UdozoPay button reads and where it goes, from what the buyer already has with the listing. */
export function buyButton(listing: Pick<ShopListingPage, "status" | "reserved" | "price"> & Partial<Pick<ShopListingPage, "in_stock" | "sale_method">>, viewer: ShopViewer | null, buyPath: string, safePayOpen: boolean) {
  if (listing.status !== "active" || viewer?.own) return null;
  if (viewer?.order) return { href: buyPath, label: `Continue UdozoPay order ${viewer.order.number}` };
  // Sold by auction: only its winner pays, at their bid.
  // (Udozo's own lots are paid from the wallet on the auction panel, and collected at its warehouse.)
  if (listing.sale_method === "auction") return viewer?.auction?.kind === "listing" && viewer.auction.viewer?.to_pay ? { href: buyPath, label: "Pay for your winning bid" } : null;
  if (!safePayOpen) return null;
  // Out of stock (none to sell) or every unit held for other buyers: nothing to pay for.
  if (listing.in_stock === false || listing.reserved) return null;
  if (listing.price.kind === "on_request" || listing.price.amount === null) return null;
  return { href: buyPath, label: "Buy with UdozoPay" };
}

