"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type NavLink, ownerLinks } from "@/lib/nav";

/** Which group of the navigation pane each place sits in. */
const groups: ReadonlyArray<{ name: string; hrefs: readonly string[] }> = [
  { name: "Sell", hrefs: ["/app", "/app/till", "/app/shifts", "/app/sales", "/app/offline"] },
  { name: "Business", hrefs: ["/app/overview", "/app/reports", "/app/customers", "/app/collections", "/app/products"] },
  { name: "Shop", hrefs: ["/app/staff", "/app/setup", "/app/billing"] },
];

/** Each place's icon: plain strokes on a 24-unit grid, drawn in the text's colour. */
const icons: Record<string, string> = {
  "/app": "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  "/app/overview": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/app/till": "M3 7h18v13H3zM7 3h10v4M7 12h2M11 12h2M15 12h2M7 16h2M11 16h2M15 16h2",
  "/app/shifts": "M12 7v5l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  "/app/sales": "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  "/app/offline": "M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18",
  "/app/reports": "M14 3H6v18h12V7zM14 3v4h4M9 17v-3M12 17v-6M15 17v-4",
  "/app/customers": "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8",
  "/app/collections": "M2 6h20v12H2zM2 10h20M6 15h4",
  "/app/products": "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  "/app/staff": "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  "/app/setup": "M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  "/app/billing": "M3 5h18v14H3zM3 9h18M7 15h3",
};

export function NavIcon({ href, className = "size-5" }: { href: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={icons[href] ?? "M4 4h16v16H4z"} />
    </svg>
  );
}

const isCurrent = (path: string, href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));

/**
 * The navigation pane, as Windows draws it: places in groups, each with its icon, the current one on a white tile with
 * the green pill at its left. `compact` shows icons only (names stay for screen readers and as tooltips).
 */
export function OwnerNav({ links = ownerLinks, compact = false, onNavigate }: { links?: readonly NavLink[]; compact?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const shown = groups
    .map(group => ({ name: group.name, links: links.filter(link => group.hrefs.includes(link.href)) }))
    .filter(group => group.links.length);
  const other = links.filter(link => !groups.some(group => group.hrefs.includes(link.href)));
  if (other.length) shown.push({ name: "More", links: other });
  return (
    <nav aria-label="POS" className="grid gap-4">
      {shown.map(group => (
        <div key={group.name}>
          <p className={compact ? "sr-only" : "px-3 pb-1 text-[11px] font-semibold tracking-wider text-pos-muted uppercase"}>{group.name}</p>
          <ul className="grid gap-0.5">
            {group.links.map(link => {
              const current = isCurrent(path, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    title={compact ? link.label : undefined}
                    aria-current={current ? "page" : undefined}
                    className={`relative flex h-10 items-center gap-3 rounded-lg text-sm no-underline transition-colors ${compact ? "justify-center px-0" : "px-3"} ${current ? "bg-white font-semibold text-pos-ink shadow-[0_1px_2px_rgba(16,35,28,0.08)]" : "text-pos-ink-2 hover:bg-white/70 hover:text-pos-ink"}`}
                  >
                    {current ? <span aria-hidden="true" className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-pos-600" /> : null}
                    <NavIcon href={link.href} className={`size-5 shrink-0 ${current ? "text-pos-600" : ""}`} />
                    <span className={compact ? "sr-only" : "truncate"}>{link.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
