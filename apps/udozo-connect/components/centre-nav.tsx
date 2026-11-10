"use client";

import { usePathname } from "next/navigation";
import { type CentreRole, centreNav, currentNav } from "@/lib/centres";

/** The centre's menu: a row of tabs across the top on phones, a list beside the page from tablets up. */
export function CentreNav({ id, role }: { id: string; role?: CentreRole }) {
  const path = usePathname() ?? "";
  const current = currentNav(id, path, role);
  return (
    <nav aria-label="Centre" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 border-b border-slate-200 md:grid md:gap-1 md:border-0">
        {centreNav(id, role).map(item => {
          const on = item.href === current;
          return (
            <li key={item.href} className="shrink-0">
              <a
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold md:rounded-xl md:border-b-0 md:px-3 ${on ? "border-brand-500 text-navy-900 md:bg-navy-100" : "border-transparent text-slate-600 hover:text-navy-900 md:hover:bg-slate-50"}`}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
