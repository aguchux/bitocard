/** What the account's places show beside their names: unread messages, and resellers waiting on the seller. */
export type PlaceCounts = { unread: number; resellers: { count: number; waiting: number } };

export type PlaceKey = "listings" | "messages" | "orders" | "favourites" | "resellers" | "wallet" | "safe-pay" | "payouts" | "profile";

export type Place = { key: PlaceKey; href: string; label: string; badge?: number; also?: string[] };

/**
 * The seller's area on udozo.com (`/account`), in order. My Resellers shows once a reseller carries the seller's
 * listings (B2B reselling), badged with what waits on them; Messages with its unread count.
 */
export function accountPlaces(counts: PlaceCounts): Place[] {
  return [
    { key: "listings", href: "/account", label: "My listings", also: ["/account/listings"] },
    { key: "messages", href: "/account/messages", label: "Messages", ...(counts.unread ? { badge: counts.unread } : {}) },
    { key: "orders", href: "/account/orders", label: "Orders" },
    { key: "favourites", href: "/account/favourites", label: "Favourites" },
    ...(counts.resellers.count ? [{ key: "resellers" as const, href: "/account/resellers", label: "My Resellers", ...(counts.resellers.waiting ? { badge: counts.resellers.waiting } : {}) }] : []),
    { key: "wallet", href: "/account/wallet", label: "Wallet" },
    { key: "safe-pay", href: "/account/safe-pay", label: "Safe pay" },
    { key: "payouts", href: "/account/payouts", label: "Payouts" },
    { key: "profile", href: "/account/profile", label: "Profile", also: ["/account/verification"] },
  ];
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The current place's address on a path: the most specific place it is under (`/account` only for itself and its listings). */
export function currentPlace(places: Place[], pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  let best: { href: string; length: number } | null = null;
  for (const place of places) {
    for (const base of [place.href, ...(place.also ?? [])]) {
      const matches = base === "/account" ? path === base : under(path, base);
      if (matches && (!best || base.length > best.length)) best = { href: place.href, length: base.length };
    }
  }
  return best?.href ?? null;
}
