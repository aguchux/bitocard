import { Bell, Gift, KeyRound, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";

export type AccountSectionKey = "profile" | "security" | "identity" | "referrals" | "notifications";

export type AccountSection = {
  key: AccountSectionKey;
  href: string;
  /** The pill's and the row's name. */
  label: string;
  /** The row's second line on the Account page. */
  note: string;
  icon: LucideIcon;
  /** Not built yet: shown with a Soon label, opening a screen that says so. */
  soon?: boolean;
};

/**
 * The Account tab's screens, in menu order: each its own route, listed as rows on `/account/profile` and as pills at
 * the top of every screen. The identity check keeps its own address (`/account/verification`), which checkout, the
 * crypto pages and the identity partners' return links already use.
 */
export const accountSections: AccountSection[] = [
  { key: "profile", href: "/account/profile/details", label: "Profile", note: "Your name, email and country", icon: UserRound },
  { key: "security", href: "/account/profile/security", label: "Security", note: "Password and signing out", icon: KeyRound },
  { key: "identity", href: "/account/verification", label: "Identity check", note: "Needed once for some products in some countries", icon: ShieldCheck },
  { key: "referrals", href: "/account/profile/referrals", label: "Referrals", note: "Invite friends to the store", icon: Gift, soon: true },
  { key: "notifications", href: "/account/profile/notifications", label: "Notifications", note: "Choose the updates you get", icon: Bell, soon: true },
];

/** Which account screen a path is (null on the Account page itself and elsewhere). */
export function activeAccountSection(pathname: string): AccountSectionKey | null {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return accountSections.find(section => path === section.href || path.startsWith(`${section.href}/`))?.key ?? null;
}
