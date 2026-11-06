/** A notice in the customer's inbox, as the API presents it. */
export type CustomerNotification = {
  object: "notification";
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "critical";
  title: string;
  body: string;
  link: string | null;
  mode: "test" | "live" | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = { object: "list"; data: CustomerNotification[]; has_more: boolean };

export type PushPreference = { type: string; label: string; severity: string; push: boolean; default: boolean; locked: boolean };

export type PushDevice = { id: string; label: string; current: boolean; last_pushed_at: string | null; last_seen_at: string; created_at: string };

/** Where a notice opens: a page of this site only (never another site, never `//host`), else the inbox itself. */
export function noticeHref(link: string | null | undefined): string {
  return link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : "/account/notifications";
}

/** When a notice came, in words: just now, minutes or hours ago, then the date. */
export function noticeWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** The badge's words: up to 99, then 99+. */
export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));
