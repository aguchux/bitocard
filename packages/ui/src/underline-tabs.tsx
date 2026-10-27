"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentType } from "react";

export type UnderlineTab = {
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  /** A count beside the label (unread messages), shown as 99+ above 99. */
  badge?: number;
  /** Not built yet: a Soon label beside the name. */
  soon?: boolean;
  /** Another site (a plain link, never prefetched); never the current tab. */
  external?: boolean;
};

/**
 * BitoCard's tabs, the standard for every row of places or filters in the apps: each tab sits on a grey line, the
 * current one on a pink line in navy text. The row slides sideways on its own where it does not fit (smooth scrolling,
 * no snapping to fight a swipe, no scroll bar) and never scrolls the page; when it opens, the current tab is slid into
 * the middle of the view, so a tab far along the row is never off screen. `bleed` runs the row (and its grey line) out
 * to the screen's edges through the page's gutter (16px on phones, 24px from `sm`), as on the account app's pages.
 */
export function UnderlineTabs({
  tabs,
  current,
  label,
  bleed = true,
  className = "",
}: {
  tabs: UnderlineTab[];
  current: string | null;
  label: string;
  bleed?: boolean;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = row.current;
    const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !active || scroller.scrollWidth <= scroller.clientWidth) return;
    // The row is positioned, so offsetLeft is the tab's place in the row.
    const left = active.offsetLeft - (scroller.clientWidth - active.clientWidth) / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [current]);
  const line = "border-b-2 border-slate-200";
  return (
    <nav aria-label={label} className={`${bleed ? "-mx-4 sm:-mx-6" : ""} ${className}`}>
      <div
        ref={row}
        className="relative flex overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {/* The page's gutter, as line rather than padding, so the grey line runs edge to edge. */}
        {bleed ? <span aria-hidden="true" className={`w-4 shrink-0 sm:w-6 ${line}`} /> : null}
        {tabs.map(tab => {
          const on = !tab.external && tab.href === current;
          const className = `inline-flex min-h-12 shrink-0 items-center gap-1.5 px-3.5 text-sm font-semibold whitespace-nowrap text-slate-500 transition-colors ${line} hover:border-slate-300 hover:text-navy-900 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-brand-700 aria-[current=page]:border-brand-500 aria-[current=page]:text-navy-900`;
          const inner = (
            <>
              {tab.icon ? <tab.icon className="size-4" aria-hidden="true" /> : null}
              {tab.label}
              {tab.soon ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide text-slate-500 uppercase">Soon</span> : null}
              {tab.badge ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-700 px-1 text-[11px] text-white">
                  {tab.badge > 99 ? "99+" : tab.badge}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </>
          );
          return tab.external ? (
            <a key={tab.href} href={tab.href} className={className}>
              {inner}
            </a>
          ) : (
            <Link key={tab.href} href={tab.href} aria-current={on ? "page" : undefined} className={className}>
              {inner}
            </Link>
          );
        })}
        <span aria-hidden="true" className={`min-w-4 flex-1 sm:min-w-6 ${line}`} />
      </div>
    </nav>
  );
}
