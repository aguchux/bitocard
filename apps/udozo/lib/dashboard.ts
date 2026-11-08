import { dashboardPeriods, type BoardTone, type DashboardMetric, type DashboardPeriod, type DashboardTotal } from "@bitocard/api-client/classifieds";

/** The period asked for in the address (`?days=7|30|90`), else 30 days. */
export function periodOf(value: string | undefined): DashboardPeriod {
  const days = Number(value);
  return (dashboardPeriods as readonly number[]).includes(days) ? (days as DashboardPeriod) : 30;
}

/** Each figure's name, what it counts, and how one of them reads ("1 view", "3 views"). */
export const metricLabels: Record<DashboardMetric, { name: string; detail: string; one: string; many: string }> = {
  views: { name: "Views", detail: "Times your listings were looked at", one: "view", many: "views" },
  leads: { name: "Leads", detail: "Buyers who chatted, called or asked for your number", one: "lead", many: "leads" },
  chats: { name: "Chats", detail: "New chats buyers started with you", one: "chat", many: "chats" },
  saves: { name: "Saves", detail: "Times buyers saved your listings", one: "save", many: "saves" },
  sales: { name: "Sales", detail: "Sales completed through Safe pay or a buy order", one: "sale", many: "sales" },
};
export const metricOrder: DashboardMetric[] = ["views", "leads", "chats", "saves", "sales"];

export const countOf = (metric: DashboardMetric, value: number) => `${value.toLocaleString("en-GB")} ${value === 1 ? metricLabels[metric].one : metricLabels[metric].many}`;

/** The change from the period before in words, so it never rests on colour alone. */
export function changeText(total: DashboardTotal): { text: string; trend: "up" | "down" | "flat" | "new" } {
  if (total.change_pct === null) return total.value > 0 ? { text: "New this period", trend: "new" } : { text: "None yet", trend: "flat" };
  if (total.change_pct === 0) return { text: "Same as before", trend: "flat" };
  return total.change_pct > 0 ? { text: `Up ${total.change_pct}%`, trend: "up" } : { text: `Down ${Math.abs(total.change_pct)}%`, trend: "down" };
}

/** A tidy top for the chart's scale (1, 2 or 5 times a power of ten) at or above the largest value, never below 4. */
export function niceMax(largest: number) {
  if (largest <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(largest));
  for (const step of [1, 2, 5, 10]) if (step * power >= largest) return step * power;
  return 10 * power;
}

/** Where each day sits on a chart `width` by `height`, oldest on the left, with the scale's top. */
export function chartPoints(values: number[], width: number, height: number) {
  const max = niceMax(Math.max(0, ...values));
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return { max, points: values.map((value, index) => ({ x: values.length > 1 ? index * step : width / 2, y: height - (value / max) * height, value })) };
}

/** A day (`2026-11-08`) as people read it: "8 Nov". */
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** How each kind of message board post is marked: an icon's name and words, never colour alone. */
export const boardTones: Record<BoardTone, { label: string; className: string }> = {
  news: { label: "News", className: "bg-navy-50 text-navy-800" },
  tip: { label: "Tip", className: "bg-emerald-50 text-emerald-900" },
  alert: { label: "Important", className: "bg-amber-50 text-amber-900" },
};

/** A board post's link: a page on this site, or an https address elsewhere (opened in a new tab); anything else is dropped. */
export function boardLink(href: string | null): { href: string; external: boolean } | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return { href, external: false };
  try {
    return new URL(href).protocol === "https:" ? { href, external: true } : null;
  } catch {
    return null;
  }
}
