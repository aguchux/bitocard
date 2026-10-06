"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Menu, X } from "lucide-react";
import type { NavGroup } from "@/lib/nav";

function Groups({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      {groups.map(group => {
        const current = group.links.some(link => link.href === pathname);
        const links = (
          <ul className="space-y-0.5">
            {group.links.map(link => {
              const active = link.href === pathname;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2.5 py-1.5 ${active ? "bg-pink-50 font-semibold text-[#e0116d]" : "text-slate-600 hover:bg-slate-50 hover:text-[#070f4c]"}`}
                  >
                    {link.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        );
        if (!group.collapsible) {
          return (
            <div key={group.title}>
              <p className="mb-1.5 px-2.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">{group.title}</p>
              {links}
            </div>
          );
        }
        return (
          <details key={group.title} open={current || group.title !== "Webhook events"} className="group">
            <summary className="mb-1.5 flex cursor-pointer list-none items-center gap-1 px-2.5 text-xs font-semibold tracking-wide text-slate-400 uppercase [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition group-open:rotate-90" aria-hidden />
              {group.title}
            </summary>
            {links}
          </details>
        );
      })}
    </nav>
  );
}

/** Desktop: a fixed column. Phones and tablets: a drawer from the header's menu button. */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 px-3 py-6 lg:block">
      <Groups groups={groups} />
    </aside>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  // Close when a link changes the page.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }
  return (
    <div className="lg:hidden">
      <button type="button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-lg text-[#070f4c] hover:bg-slate-100">
        <Menu className="size-5" aria-hidden />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="flex h-dvh w-[min(20rem,86vw)] flex-col bg-white shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <span className="font-semibold text-[#070f4c]">Documentation</span>
              <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-lg hover:bg-slate-100">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <Groups groups={groups} onNavigate={() => setOpen(false)} />
            </div>
          </div>
          <button type="button" tabIndex={-1} aria-hidden className="flex-1 bg-[#070f4c]/40" onClick={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
