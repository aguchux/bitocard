import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, History, Landmark, Megaphone, Wallet, type LucideIcon } from "lucide-react";
import { accountSections, activeAccountSection } from "./account-sections";

export type SubMenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Not built yet: shown with a Soon label. */
  soon?: boolean;
  /** Other paths that belong to this item (a withdrawal's own page belongs to Withdraw). */
  also?: string[];
};

export type SubMenu = { key: "crypto" | "account"; label: string; href: string; items: SubMenuItem[] };

/** The Crypto tab's places: pills under the title on phones and tablets, the sub rail on desktop. */
export const cryptoSections: SubMenuItem[] = [
  { href: "/account/crypto", label: "Wallets", icon: Wallet },
  { href: "/account/crypto/market", label: "Market", icon: ArrowLeftRight },
  { href: "/account/crypto/ads", label: "My ads", icon: Megaphone },
  { href: "/account/crypto/trades", label: "Trades", icon: History },
  { href: "/account/crypto/deposit", label: "Deposit", icon: ArrowDownToLine },
  { href: "/account/crypto/withdraw", label: "Withdraw", icon: ArrowUpFromLine, also: ["/account/crypto/withdrawals"] },
  { href: "/account/crypto/cash-out", label: "Cash out", icon: Landmark },
];

/** The tabs with screens of their own, shown as a second rail beside the app's rail on desktop. */
export const subMenus: SubMenu[] = [
  { key: "crypto", label: "Crypto", href: "/account/crypto", items: cryptoSections },
  { key: "account", label: "Account", href: "/account/profile", items: accountSections.map(({ href, label, icon, soon }) => ({ href, label, icon, soon })) },
];

const clean = (pathname: string) => pathname.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * Which sub menu a path shows, and its current item (null when none is current, as on a trade's confirmation). The
 * Crypto rail shows on every crypto page; the Account rail only on its screens, not on the Account page, whose rows are
 * the menu. Elsewhere: none.
 */
export function subMenuFor(pathname: string): { menu: SubMenu; active: string | null } | null {
  const path = clean(pathname);
  if (under(path, "/account/crypto")) {
    const menu = subMenus[0]!;
    // The most specific item wins; Wallets is the crypto home only.
    const active =
      menu.items
        .filter(item => (item.href === "/account/crypto" ? path === item.href : [item.href, ...(item.also ?? [])].some(base => under(path, base))))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
    return { menu, active };
  }
  const section = activeAccountSection(path);
  if (section) return { menu: subMenus[1]!, active: accountSections.find(item => item.key === section)!.href };
  return null;
}
