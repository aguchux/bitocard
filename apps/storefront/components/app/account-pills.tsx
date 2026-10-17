"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { accountSections, activeAccountSection } from "./account-sections";

/**
 * The account screens as a row of pills: the current one filled in pink, the rest outlined. On phones the row scrolls
 * sideways (no scroll bar, bleeding to the screen's edge) and starts with the current pill in view.
 */
export function AccountPills() {
  const active = activeAccountSection(usePathname());
  const list = useRef<HTMLUListElement>(null);
  const current = useRef<HTMLAnchorElement>(null);

  // Centre the current pill without scrolling the page itself.
  useEffect(() => {
    const scroller = list.current;
    const pill = current.current;
    if (!scroller || !pill || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = pill.offsetLeft - (scroller.clientWidth - pill.offsetWidth) / 2;
  }, [active]);

  return (
    <nav aria-label="Account settings" className="-mx-4 sm:mx-0">
      <ul ref={list} className="flex snap-x gap-2 overflow-x-auto scroll-px-4 px-4 py-1 [scrollbar-width:none] sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {accountSections.map(section => {
          const on = section.key === active;
          return (
            <li key={section.key} className="shrink-0 snap-start">
              <Link
                ref={on ? current : undefined}
                href={section.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                  on ? "bg-brand-500 text-white shadow-sm shadow-brand-500/25" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-navy-900 hover:ring-slate-300"
                }`}
              >
                <section.icon className="size-4" aria-hidden="true" />
                {section.label}
                {section.soon ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide uppercase ${on ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>Soon</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
