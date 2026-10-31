"use client";

import type { ReactNode } from "react";
import {
  Banknote,
  Bell,
  BookCheck,
  Bot,
  Building2,
  ChartNoAxesColumn,
  Cpu,
  Crown,
  Flag,
  FlaskConical,
  Globe2,
  HandCoins,
  History,
  House,
  Inbox,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  MessagesSquare,
  Package,
  Paintbrush,
  Percent,
  PlugZap,
  ReceiptText,
  Repeat,
  ScanFace,
  Settings,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Store,
  Tags,
  ToggleRight,
  TrendingUp,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { cn, humanise } from "@bitocard/admin-ui";
import { AccountMenu, AppLink, ConsoleShell, type Crumb, type NavItem, NotificationBell, StepUpPrompt, type SubNavItem, useAdmin, useMode } from "@bitocard/admin-ui/shell";
import { useAdminSignOutMutation } from "@bitocard/api-client/admin";

export type { Crumb };

export type UdozoSection = "home" | "marketplace" | "assistants" | "resellers" | "money" | "plans" | "theme" | "verifications" | "support" | "reports" | "settings";

/** The left rail of admin.udozo.com, in order. BitoCard's own areas (catalogue, orders, suppliers, crypto) are not here. */
export const sections: Array<NavItem<UdozoSection>> = [
  { key: "home", label: "Home", href: "/", icon: House },
  { key: "marketplace", label: "Marketplace", href: "/classifieds", icon: Store },
  { key: "assistants", label: "Shop assistants", href: "/support/assistants", icon: Bot },
  { key: "resellers", label: "Resellers", href: "/resellers", icon: Users },
  { key: "money", label: "Money", href: "/money/payouts", icon: Wallet },
  { key: "plans", label: "Plans & fees", href: "/plans", icon: Crown },
  { key: "theme", label: "Theme", href: "/theme", icon: Paintbrush },
  { key: "verifications", label: "Identity", href: "/verifications", icon: ShieldCheck },
  { key: "support", label: "Support", href: "/support", icon: LifeBuoy },
  { key: "reports", label: "Reports", href: "/reports", icon: TrendingUp },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

/** Each section's menu (the second column). */
export const menus: Record<UdozoSection, { title: string; items: SubNavItem[] }> = {
  home: {
    title: "Dashboard",
    items: [
      { label: "Overview", href: "/", icon: ChartNoAxesColumn },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Activity log", href: "/activity", icon: History },
    ],
  },
  marketplace: {
    title: "Marketplace",
    items: [
      { label: "Moderation queue", href: "/classifieds", icon: ListChecks },
      { label: "Reports", href: "/classifieds/reports", icon: Flag },
      { label: "Listings", href: "/classifieds/listings", icon: Package },
      { label: "Sellers", href: "/classifieds/sellers", icon: Users },
      { label: "Accounts", href: "/customers", icon: UserRound },
      { label: "Categories", href: "/classifieds/categories", icon: Shapes },
      { label: "Feature registry", href: "/classifieds/features", icon: Tags },
      { label: "Areas", href: "/classifieds/areas", icon: MapPin },
      { label: "Safe pay orders", href: "/classifieds/orders", icon: HandCoins },
      { label: "Disputes", href: "/classifieds/disputes", icon: MessageSquareWarning },
      { label: "Limits and words", href: "/classifieds/rules", icon: SlidersHorizontal },
      { label: "Safe pay settings", href: "/classifieds/safe-pay", icon: Percent },
      { label: "Resale settings", href: "/classifieds/resale", icon: Repeat },
      { label: "Store reports", href: "/classifieds/resale-reports", icon: Flag },
    ],
  },
  assistants: {
    title: "Shop assistants",
    items: [
      { label: "Assistants", href: "/support/assistants", icon: Bot },
      { label: "Who answers", href: "/support/assistants/who-answers", icon: Globe2 },
      { label: "AI usage", href: "/support/ai", icon: Cpu },
    ],
  },
  resellers: {
    title: "Resellers",
    items: [
      { label: "All resellers", href: "/resellers", icon: Building2 },
      { label: "Domains", href: "/resellers/domains", icon: Globe2 },
      { label: "Identity checks", href: "/verifications", icon: ShieldCheck },
    ],
  },
  money: {
    title: "Money",
    items: [
      { label: "Safe pay payouts", href: "/money/payouts", icon: Banknote },
      { label: "Manual top-ups", href: "/money/top-ups", icon: HandCoins },
      { label: "Books check", href: "/money/ledger", icon: BookCheck },
    ],
  },
  plans: {
    title: "Plans & fees",
    items: [
      { label: "Plans", href: "/plans", icon: Crown },
      { label: "Setup fees", href: "/plans/setup-fees", icon: ReceiptText },
    ],
  },
  theme: { title: "Theme", items: [{ label: "Colour theme", href: "/theme", icon: Paintbrush }] },
  verifications: {
    title: "Identity",
    items: [
      { label: "Needs review", href: "/verifications", icon: ListChecks },
      { label: "All checks", href: "/verifications/all", icon: ShieldCheck },
      { label: "Udozo Verify", href: "/verifications/verify", icon: ScanFace },
    ],
  },
  support: {
    title: "Support",
    items: [
      { label: "Tickets", href: "/support", icon: Inbox },
      { label: "Chats", href: "/support/chats", icon: MessagesSquare },
      { label: "Assistants", href: "/support/assistants", icon: Bot },
    ],
  },
  reports: {
    title: "Reports",
    items: [
      { label: "P&L", href: "/reports", icon: ChartNoAxesColumn },
      { label: "Growth", href: "/reports/growth", icon: TrendingUp },
      { label: "Safe pay and resale", href: "/reports/resale", icon: HandCoins },
      { label: "Statements", href: "/reports/statements", icon: ReceiptText },
    ],
  },
  settings: {
    title: "Settings",
    items: [
      { label: "Feature switches", href: "/settings", icon: ToggleRight },
      { label: "Markets", href: "/settings/markets", icon: Globe2 },
      { label: "Integrations", href: "/settings/integrations", icon: PlugZap },
      { label: "pawaPay coverage", href: "/settings/pawapay", icon: Smartphone },
      { label: "Team", href: "/settings/team", icon: UsersRound },
    ],
  },
};

/** The inbox bell; given the admin's ID, it keeps this browser registered for push after they sign in again. */
function InboxBell() {
  return <NotificationBell realm="admin" userId={useAdmin().id} />;
}

function AccountArea() {
  const admin = useAdmin();
  const [signOut, { isLoading }] = useAdminSignOutMutation();
  return (
    <AccountMenu
      name={admin.name}
      email={admin.email}
      detail={admin.roles.map(humanise).join(", ")}
      signingOut={isLoading}
      onSignOut={async () => {
        await signOut().unwrap().catch(() => undefined);
        // A full page load clears the API cache, so the next admin never sees this one's data.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/signin");
      }}
    >
      <AppLink href="/account" className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink hover:bg-canvas">
        <UserRound className="size-4" aria-hidden />
        Your account
        {admin.authenticator === false ? <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">2-step off</span> : null}
      </AppLink>
    </AccountMenu>
  );
}

/** Live or sandbox figures. Shown where a page has mode-dependent data. */
export function ModeSwitch() {
  const { mode, setMode } = useMode();
  return (
    <button
      type="button"
      onClick={() => setMode(mode === "live" ? "test" : "live")}
      aria-pressed={mode === "test"}
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", mode === "test" ? "bg-amber-100 text-amber-800" : "bg-canvas text-muted hover:text-ink")}
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {mode === "test" ? "Sandbox data" : "Live data"}
    </button>
  );
}

/**
 * The layout of every page on admin.udozo.com: the shared console (rail, section menu, breadcrumbs, account menu) in
 * Udozo's name and mark, its inbox bell with push to the admin's browsers, and step-up prompts.
 */
export function UdozoShell({ section, current, crumbs, actions, children }: { section: UdozoSection; current: string; crumbs: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <ConsoleShell brand="Udozo" logo="/udozo-mark-light.png" sections={sections} menus={menus} section={section} current={current} crumbs={crumbs} actions={actions} notifications={<InboxBell />} account={<AccountArea />}>
      {children}
      <StepUpPrompt />
    </ConsoleShell>
  );
}
