import { Home, LayoutGrid, ReceiptText, UserRound, type LucideIcon } from "lucide-react";

/** The customer account app's four places. */
export const appTabs: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/account", label: "Home", icon: Home },
  { href: "/account/catalog", label: "Catalog", icon: LayoutGrid },
  { href: "/account/orders", label: "Orders", icon: ReceiptText },
  { href: "/account/profile", label: "Account", icon: UserRound },
];

/** Which tab a path belongs to: Home is exact; product pages belong to the catalogue. */
export function activeTab(pathname: string) {
  if (pathname === "/account") return "/account";
  if (pathname.startsWith("/account/p/")) return "/account/catalog";
  if (pathname.startsWith("/account/verification")) return "/account/profile";
  if (pathname.startsWith("/account/disputes")) return "/account/orders";
  return appTabs.find(tab => tab.href !== "/account" && pathname.startsWith(tab.href))?.href ?? null;
}
