import {
  Banknote,
  BarChart3,
  Bell,
  BellRing,
  Building,
  Code2,
  CreditCard,
  FileClock,
  Globe,
  Headset,
  House,
  Inbox,
  KeyRound,
  LifeBuoy,
  ListOrdered,
  type LucideIcon,
  MessageSquarePlus,
  MessagesSquare,
  PieChart,
  ReceiptText,
  Repeat,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";

/**
 * Udozo's Seller HQ (shq.udozo.com): resale, stores, wallet and the rest. BitoCard's own SHQ screens that Udozo does not
 * have (its catalogue and pricing, its orders, numbers, eSIMs, VPN, disputes, own integrations and platform fees) are
 * never listed here.
 */
export type ShqSection = "home" | "resale" | "store" | "wallet" | "reports" | "support" | "developers" | "team" | "settings";
export type ShqNavItem = { key: ShqSection; label: string; href: string; icon: LucideIcon };
export type ShqSubNavItem = { label: string; href: string; icon?: LucideIcon };

/** The left rail, in order. */
export const sections: ShqNavItem[] = [
  { key: "home", label: "Home", href: "/", icon: House },
  { key: "resale", label: "Resale", href: "/resale", icon: Repeat },
  { key: "store", label: "Stores", href: "/store", icon: Store },
  { key: "wallet", label: "Wallet", href: "/wallet", icon: Wallet },
  { key: "reports", label: "Reports", href: "/reports", icon: PieChart },
  { key: "support", label: "Support", href: "/support", icon: LifeBuoy },
  { key: "developers", label: "Developers", href: "/developers", icon: Code2 },
  { key: "team", label: "Team", href: "/team", icon: Users },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Each section's menu (the second column). A new Seller HQ page is a folder in `app/(console)` plus its entry here.
 * Plans are listed only while Udozo charges sellers (`menusFor`).
 */
export const menus: Record<ShqSection, { title: string; items: ShqSubNavItem[] }> = {
  home: {
    title: "Home",
    items: [
      { label: "Overview", href: "/", icon: BarChart3 },
      { label: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  resale: {
    title: "Resale",
    items: [
      { label: "Browse", href: "/resale", icon: Repeat },
      { label: "Your listings", href: "/resale/listings", icon: ListOrdered },
      { label: "Orders", href: "/resale/orders", icon: ShoppingBag },
      { label: "Rules", href: "/resale/rules", icon: SlidersHorizontal },
      { label: "Suppliers", href: "/resale/suppliers", icon: Truck },
    ],
  },
  store: {
    title: "Stores",
    items: [
      { label: "Your stores", href: "/store", icon: Store },
      { label: "Domains", href: "/store/domains", icon: Globe },
    ],
  },
  wallet: {
    title: "Wallet",
    items: [
      { label: "Balance", href: "/wallet", icon: Wallet },
      { label: "Top-ups", href: "/wallet/top-ups", icon: CreditCard },
      { label: "Withdrawals", href: "/wallet/payouts", icon: Banknote },
      { label: "Payout accounts", href: "/wallet/bank-accounts", icon: Building },
      { label: "Invoices", href: "/wallet/invoices", icon: ReceiptText },
    ],
  },
  reports: {
    title: "Reports",
    items: [
      { label: "P&L", href: "/reports", icon: PieChart },
      { label: "Growth", href: "/reports/growth", icon: TrendingUp },
      { label: "Statements", href: "/reports/statements", icon: ReceiptText },
    ],
  },
  support: {
    title: "Support",
    items: [
      { label: "Tickets", href: "/support", icon: Inbox },
      { label: "Chats", href: "/support/chats", icon: MessagesSquare },
      { label: "New ticket", href: "/support/new", icon: MessageSquarePlus },
      { label: "Chat with Udozo", href: "/support/udozo", icon: Headset },
    ],
  },
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
      { label: "Plans", href: "/settings/plan", icon: Sparkles },
      { label: "Notifications", href: "/settings/notifications", icon: BellRing },
      { label: "Your profile", href: "/settings/profile", icon: UserCog },
      { label: "Security", href: "/settings/security", icon: KeyRound },
    ],
  },
};

/** The menus, without Plans while Udozo has no paid plans (every store has every feature). */
export const menusFor = (paidPlans: boolean): typeof menus =>
  paidPlans ? menus : { ...menus, settings: { ...menus.settings, items: menus.settings.items.filter(item => item.href !== "/settings/plan") } };
