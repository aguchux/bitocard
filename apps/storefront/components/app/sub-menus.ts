import { CircleCheck, DollarSign, Gift, LayoutGrid, ListOrdered, MessageSquareWarning, ReceiptText, RotateCcw, Truck, Wallet, type LucideIcon } from "lucide-react";
import { groupIcon } from "@/components/store/theme";
import { accountSections, activeAccountSection } from "./account-sections";

export type SubMenuItem = {
  /** A path, or a path and the one query parameter that picks it on the tab's page (`/account/orders?show=delivered`). */
  href: string;
  label: string;
  icon: LucideIcon;
  /** Not built yet: shown with a Soon label. */
  soon?: boolean;
  /** Other paths that belong to this item (a withdrawal's own page belongs to Withdraw). */
  also?: string[];
};

export type SubMenuKey = "catalog" | "orders" | "wallet" | "account";

export type SubMenu = {
  key: SubMenuKey;
  label: string;
  /** The tab's page; the rail's heading leads back to it. */
  href: string;
  /** On the tab's page, the query parameter that picks the item (`show`, `group`, `wallet`); without it, or with a value no item has, the item without it is current. */
  param?: string;
  /** Paths whose pages show this rail. */
  owns: string[];
  items: SubMenuItem[];
};

/** What the rails need from the signed-in customer and the store: the catalogue's groups and the customer's wallet currency. */
export type SubMenuContext = { groups: Array<{ key: string; label: string }>; currency: string | null };

/** The Orders tab: its filters (the API's `?show=` groups, as the page's chips) and the customer's disputes. */
export const orderSections: SubMenuItem[] = [
  { href: "/account/orders", label: "All orders", icon: ListOrdered },
  { href: "/account/orders?show=progress", label: "On the way", icon: Truck },
  { href: "/account/orders?show=delivered", label: "Delivered", icon: CircleCheck },
  { href: "/account/orders?show=refunded", label: "Refunded", icon: RotateCcw },
  { href: "/account/disputes", label: "Your disputes", icon: MessageSquareWarning },
];

/** The Catalog tab: everything, then each menu group on sale (as the page's chips). */
export const catalogSections = (groups: SubMenuContext["groups"]): SubMenuItem[] => [
  { href: "/account/catalog", label: "All products", icon: LayoutGrid },
  ...groups.map(group => ({ href: `/account/catalog?group=${encodeURIComponent(group.key)}`, label: group.label, icon: groupIcon[group.key] ?? Gift })),
];

/**
 * The Wallet tab: the country's wallet (the page's default) and the US dollar wallet (`?wallet=`, as the page's
 * tabs), then all their activity (its own screen, reached on phones by each activity card's View all). A
 * country that uses dollars has one money wallet; an account still without a country has its default.
 */
export const walletSections = (currency: string | null): SubMenuItem[] => [
  { href: "/account/wallet", label: !currency ? "Your wallet" : currency === "USD" ? "US dollars" : `${currency} wallet`, icon: Wallet },
  ...(currency && currency !== "USD" ? [{ href: "/account/wallet?wallet=USD", label: "US dollars", icon: DollarSign }] : []),
  { href: "/account/wallet/transactions", label: "Transactions", icon: ReceiptText },
];

/** The tabs with places of their own, in the app's tab order, shown as a second rail beside the app's rail on desktop. */
export function subMenusFor(context: SubMenuContext): SubMenu[] {
  return [
    { key: "catalog", label: "Catalog", href: "/account/catalog", param: "group", owns: ["/account/catalog", "/account/p"], items: catalogSections(context.groups) },
    { key: "orders", label: "Orders", href: "/account/orders", param: "show", owns: ["/account/orders", "/account/disputes"], items: orderSections },
    { key: "wallet", label: "Wallet", href: "/account/wallet", param: "wallet", owns: ["/account/wallet"], items: walletSections(context.currency) },
    // Shown only on its screens (activeAccountSection), not on the Account page, whose rows are its menu.
    { key: "account", label: "Account", href: "/account/profile", owns: [], items: accountSections.map(({ href, label, icon, soon }) => ({ href, label, icon, soon })) },
  ];
}

const clean = (pathname: string) => pathname.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);
const split = (href: string) => {
  const [path, search = ""] = href.split("?");
  return { path: path!, params: new URLSearchParams(search) };
};

/** The current item of a menu on a path (null when none is, as on an order's own page or a trade's confirmation). */
function activeItem(menu: SubMenu, path: string, params: URLSearchParams): string | null {
  const base = clean(menu.href);
  if (menu.param && path === base) {
    // The tab's own page: the item whose parameter matches (case aside), else the one without it.
    const value = params.get(menu.param)?.toLowerCase() ?? null;
    const onBase = menu.items.filter(item => split(item.href).path === base);
    const picked = onBase.find(item => (split(item.href).params.get(menu.param!)?.toLowerCase() ?? null) === value) ?? onBase.find(item => !split(item.href).params.has(menu.param!));
    return picked?.href ?? null;
  }
  // Elsewhere the most specific item wins; the tab's own page is current only on itself.
  return (
    menu.items
      .filter(item => {
        const own = split(item.href).path;
        return own === base ? path === own || (item.also ?? []).some(prefix => under(path, prefix)) : [own, ...(item.also ?? [])].some(prefix => under(path, prefix));
      })
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
  );
}

/**
 * Which sub menu a page shows, and its current item. `search` is the page's query string (the Orders, Catalog and
 * Wallet items are picked by it). Home and the Account page have none.
 */
export function subMenuFor(
  pathname: string,
  search: string | URLSearchParams = "",
  context: SubMenuContext = { groups: [], currency: null },
): { menu: SubMenu; active: string | null } | null {
  const path = clean(pathname);
  const params = typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const menus = subMenusFor(context);
  const menu = activeAccountSection(path) ? menus.find(item => item.key === "account")! : menus.find(item => item.owns.some(prefix => under(path, prefix)));
  return menu ? { menu, active: activeItem(menu, path, params) } : null;
}
