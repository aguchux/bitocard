"use client";

import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Ban, Bell, BookOpen, ChartNoAxesColumn, Coins, Flag, Gauge, Gavel, Headset, History, House, ListChecks, MessagesSquare, Percent, PlugZap, ReceiptText, Settings, ShieldCheck, Snowflake, Ticket, Wallet } from "lucide-react";
import { humanise } from "@bitocard/admin-ui";
import { AccountMenu, ConsoleShell, type Crumb, type NavItem, NotificationBell, StepUpPrompt, type SubNavItem, useAdmin } from "@bitocard/admin-ui/shell";
import { useAdminSignOutMutation } from "@bitocard/api-client/admin";

export type { Crumb };

export type AfrippaSection = "home" | "orders" | "crypto" | "support" | "settings";

/** The left rail of admin.afrippa.com, in order. */
export const sections: Array<NavItem<AfrippaSection>> = [
  { key: "home", label: "Home", href: "/", icon: House },
  { key: "orders", label: "Orders", href: "/orders", icon: ReceiptText },
  { key: "crypto", label: "Crypto", href: "/crypto", icon: Wallet },
  { key: "support", label: "Help", href: "/support", icon: Headset },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

/** Each section's menu. */
export const menus: Record<AfrippaSection, { title: string; items: SubNavItem[] }> = {
  home: {
    title: "Dashboard",
    items: [
      { label: "Overview", href: "/", icon: ChartNoAxesColumn },
      { label: "Books", href: "/books", icon: BookOpen },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Activity log", href: "/activity", icon: History },
    ],
  },
  orders: {
    title: "Orders",
    items: [
      { label: "Appeals", href: "/orders", icon: Gavel },
      { label: "All orders", href: "/orders/all", icon: ReceiptText },
      { label: "Reports", href: "/reports", icon: Flag },
    ],
  },
  crypto: {
    title: "Crypto",
    items: [
      { label: "Wallets & freezes", href: "/crypto", icon: Snowflake },
      { label: "P2P ads", href: "/crypto/ads", icon: ListChecks },
      { label: "Deposits", href: "/crypto/deposits", icon: ArrowDownToLine },
      { label: "Withdrawals", href: "/crypto/withdrawals", icon: ArrowUpFromLine },
      { label: "Chains", href: "/crypto/chains", icon: PlugZap },
      { label: "Assets", href: "/crypto/assets", icon: Coins },
    ],
  },
  support: {
    title: "Help",
    items: [
      { label: "Tickets", href: "/support", icon: Ticket },
      { label: "Chats", href: "/support/chats", icon: MessagesSquare },
    ],
  },
  settings: {
    title: "Settings",
    items: [
      { label: "Fee rates", href: "/settings", icon: Percent },
      { label: "Market limits", href: "/settings/limits", icon: Gauge },
      { label: "Two-step methods", href: "/settings/two-step", icon: ShieldCheck },
      { label: "Refused words", href: "/settings/words", icon: Ban },
      { label: "Integrations", href: "/settings/integrations", icon: PlugZap },
    ],
  },
};

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
    />
  );
}

/**
 * The layout of every page on admin.afrippa.com: the shared console (rail, section menu, breadcrumbs, account menu) in
 * Afrippa's name and mark, its inbox bell (no push yet: Afrippa's admins have no devices), and step-up prompts.
 */
export function AfrippaShell({ section, current, crumbs, actions, children }: { section: AfrippaSection; current: string; crumbs: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <ConsoleShell brand="Afrippa" logo="/afrippa-mark-light.png" sections={sections} menus={menus} section={section} current={current} crumbs={crumbs} actions={actions} notifications={<NotificationBell realm="admin" />} account={<AccountArea />}>
      {children}
      <StepUpPrompt />
    </ConsoleShell>
  );
}
