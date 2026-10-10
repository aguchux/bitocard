"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTab, appTabs } from "./tabs";

/**
 * The account app's tabs as a bottom bar: on phones and tablets, and on desktop too when the store (or BitoCard) chose
 * it (`desktopNav`); otherwise desktop has `AppRail`.
 */
export function AppNav({ desktopNav }: { desktopNav: "rail" | "bottom" }) {
  const active = activeTab(usePathname());
  const rail = desktopNav === "rail";
  return (
    <nav aria-label="Account" className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${rail ? "lg:hidden" : ""}`}>
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
        {appTabs.map(tab => {
          const current = active === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${current ? "text-[#ff2382]" : "text-slate-500 hover:text-[#070f4c]"}`}
              >
                <tab.icon className="size-6" aria-hidden="true" strokeWidth={current ? 2.4 : 2} />
                {tab.label}
                {current ? <span aria-hidden="true" className="absolute bottom-1.5 h-0.5 w-8 rounded-full bg-[#ff2382]" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The desktop rail: in the page's flow beside the content and sticky below the header, so it always starts under the
 * header (and the test-store banner above it) instead of being covered by it.
 */
export function AppRail() {
  const active = activeTab(usePathname());
  return (
    <nav aria-label="Account" className="sticky top-[72px] hidden h-[calc(100svh-72px)] w-60 shrink-0 self-start overflow-y-auto border-r border-slate-100 bg-white px-3 py-5 lg:block">
      <ul className="space-y-1">
        {appTabs.map(tab => {
          const current = active === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-2xl px-4 font-semibold ${current ? "bg-pink-50 text-[#ff2382]" : "text-slate-600 hover:bg-slate-50 hover:text-[#070f4c]"}`}
              >
                <tab.icon className="size-5" aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
