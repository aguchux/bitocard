"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { subMenuFor, type SubMenuContext } from "./sub-menus";

/**
 * Desktop only: a tab's own places (Catalog's groups, Orders' filters, the wallets, Crypto's Wallets, Market…, Account's
 * Profile, Security…) as a second rail beside the app's rail, sticky below the header like it. The tab's name heads it
 * and leads back to the tab. Phones and tablets keep the pills, chips or tabs on the page instead.
 */
export function SubRail({ context }: { context: SubMenuContext }) {
  const found = subMenuFor(usePathname(), useSearchParams(), context);
  if (!found) return null;
  const { menu, active } = found;
  return (
    <nav
      aria-label={`${menu.label} menu`}
      className="sticky top-[72px] hidden h-[calc(100svh-72px)] w-56 shrink-0 self-start overflow-y-auto border-r border-slate-100 bg-slate-50/60 px-3 py-5 lg:block xl:w-60"
    >
      <Link href={menu.href} className="mb-2 flex min-h-9 items-center rounded-lg px-3 text-xs font-bold tracking-[0.14em] text-slate-500 uppercase hover:text-navy-900">
        {menu.label}
      </Link>
      <ul className="space-y-1">
        {menu.items.map(item => {
          const current = item.href === active;
          const className = `group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
            current ? "bg-white text-navy-900 shadow-sm ring-1 ring-slate-200/80" : "text-slate-600 hover:bg-white hover:text-navy-900"
          }`;
          const inner = (
            <>
              {current ? <span aria-hidden="true" className="absolute top-2.5 bottom-2.5 left-0 w-1 rounded-full bg-brand-500" /> : null}
              <item.icon className={`size-[18px] shrink-0 ${current ? "text-brand-500" : "text-slate-400 group-hover:text-slate-600"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.soon ? <span className="shrink-0 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide text-slate-500 uppercase">Soon</span> : null}
              {item.badge ? (
                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">
                  {item.badge > 99 ? "99+" : item.badge}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </>
          );
          return (
            <li key={item.href}>
              {/* Browse leaves the app through the sign-in handoff (a route, not a page): a plain link. */}
              {item.external ? (
                <a href={item.href} className={className}>
                  {inner}
                </a>
              ) : (
                <Link href={item.href} aria-current={current ? "page" : undefined} className={className}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
