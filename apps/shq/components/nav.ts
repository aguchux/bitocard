import {
  Banknote,
  BarChart3,
  BadgePercent,
  Bell,
  Building,
  Code2,
  CreditCard,
  FileClock,
  House,
  KeyRound,
  Landmark,
  ListOrdered,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  UserCog,
  Users,
  Wallet,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export type ShqSection = "home" | "orders" | "catalogue" | "wallet" | "store" | "developers" | "team" | "settings";
export type ShqNavItem = { key: ShqSection; label: string; href: string; icon: LucideIcon };
export type ShqSubNavItem = { label: string; href: string; icon?: LucideIcon };

/** The left rail, in order. */
export const sections: ShqNavItem[] = [
  { key: "home", label: "Home", href: "/", icon: House },
  { key: "orders", label: "Orders", href: "/orders", icon: ReceiptText },
  { key: "catalogue", label: "Catalogue", href: "/catalogue", icon: Package },
  { key: "wallet", label: "Wallet", href: "/wallet", icon: Wallet },
  { key: "store", label: "Store", href: "/store", icon: Store },
  { key: "developers", label: "Developers", href: "/developers", icon: Code2 },
  { key: "team", label: "Team", href: "/team", icon: Users },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

/** Each section's menu (the second column). A new SHQ page is a folder in `app/(console)` plus its entry here. */
export const menus: Record<ShqSection, { title: string; items: ShqSubNavItem[] }> = {
  home: { title: "Home", items: [{ label: "Overview", href: "/", icon: BarChart3 }] },
  orders: { title: "Orders", items: [{ label: "All orders", href: "/orders", icon: ListOrdered }, { label: "New order", href: "/orders/new", icon: Sparkles }] },
  catalogue: {
    title: "Catalogue",
    items: [
      { label: "Products", href: "/catalogue", icon: Package },
      { label: "Pricing", href: "/catalogue/pricing", icon: BadgePercent },
    ],
  },
  wallet: {
    title: "Wallet",
    items: [
      { label: "Balance", href: "/wallet", icon: Wallet },
      { label: "Top-ups", href: "/wallet/top-ups", icon: CreditCard },
      { label: "Bank transfer accounts", href: "/wallet/reserved-accounts", icon: Landmark },
      { label: "Withdrawals", href: "/wallet/payouts", icon: Banknote },
      { label: "Payout bank accounts", href: "/wallet/bank-accounts", icon: Building },
    ],
  },
  store: { title: "Store", items: [{ label: "Your store", href: "/store", icon: Store }] },
  developers: {
    title: "Developers",
    items: [
      { label: "API keys", href: "/developers", icon: KeyRound },
      { label: "Webhooks", href: "/developers/webhooks", icon: Webhook },
      { label: "Events", href: "/developers/events", icon: FileClock },
    ],
  },
  team: { title: "Team", items: [{ label: "Members", href: "/team", icon: Users }] },
  settings: {
    title: "Settings",
    items: [
      { label: "Business", href: "/settings", icon: Building },
      { label: "Identity check", href: "/settings/verification", icon: ShieldCheck },
      { label: "Plan", href: "/settings/plan", icon: Sparkles },
      { label: "Preferences", href: "/settings/preferences", icon: Bell },
      { label: "Your profile", href: "/settings/profile", icon: UserCog },
    ],
  },
};
