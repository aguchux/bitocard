import { Coins, Home, LayoutGrid, ReceiptText, Store, UserRound, Wallet, type LucideIcon } from "lucide-react";

export type AppTab = { href: string; label: string; icon: LucideIcon };

/** The customer account app's places (resellers' stores, and customers where BitoCard Shop is not open). */
export const appTabs: AppTab[] = [
  { href: "/account", label: "Home", icon: Home },
  { href: "/account/catalog", label: "Catalog", icon: LayoutGrid },
  { href: "/account/orders", label: "Orders", icon: ReceiptText },
  { href: "/account/wallet", label: "Wallet", icon: Wallet },
  { href: "/account/crypto", label: "Crypto", icon: Coins },
  { href: "/account/profile", label: "Account", icon: UserRound },
];

/** BitoCard Shop's tab: the customer's listings, chats, Safe pay orders and favourites (docs/BITOCARD_CLASSIFIEDS_PLAN.md). */
export const shopTab: AppTab = { href: "/shop", label: "Shop", icon: Store };

/**
 * The tabs for this customer: where BitoCard Shop is open for them (BitoCard's own sites, their country's market), Shop
 * takes the last tab and Account moves to the header's account button and the menu.
 */
export function tabsFor(shop: boolean): AppTab[] {
  return shop ? [...appTabs.filter(tab => tab.href !== "/account/profile"), shopTab] : appTabs;
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Which tab a path belongs to: Home is exact; product pages belong to the catalogue. Null when it is no tab's. */
export function activeTab(pathname: string, tabs: AppTab[] = appTabs) {
  const owner = (() => {
    if (pathname === "/account") return "/account";
    if (pathname.startsWith("/account/p/")) return "/account/catalog";
    if (pathname.startsWith("/account/verification")) return "/account/profile";
    if (pathname.startsWith("/account/disputes")) return "/account/orders";
    if (pathname.startsWith("/account/support")) return "/account/profile";
    if (under(pathname, "/shop")) return "/shop";
    return appTabs.find(tab => tab.href !== "/account" && pathname.startsWith(tab.href))?.href ?? null;
  })();
  return owner && tabs.some(tab => tab.href === owner) ? owner : null;
}
