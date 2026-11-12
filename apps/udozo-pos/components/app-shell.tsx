"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { type NavLink, OwnerNav } from "@/components/owner-nav";
import { UdozoMark } from "@/components/site-chrome";

type Who = { name: string; role: string; shop: string | null } | null;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join("");

/**
 * The POS behind sign-in, laid out as a Windows app: a slim title bar (the mark, the shop, who is signed in, Sign out),
 * the navigation pane on the left (names and icons on wide screens, icons only on tablets, a drawer on phones) and the
 * page as the workspace beside it.
 */
export function AppShell({ links, who, signOut, signOutLabel, children }: { links?: readonly NavLink[]; who: Who; signOut: () => Promise<void>; signOutLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  // The drawer closes on Escape; the page behind it stays still while it is open.
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [open]);
  // Moving to another page (the back button too) closes it.
  const [shownFor, setShownFor] = useState(path);
  if (shownFor !== path) {
    setShownFor(path);
    setOpen(false);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-pos-page">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-pos-line bg-pos-page/85 px-3 backdrop-blur-md sm:px-4">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open the menu" aria-expanded={open} className="flex size-9 items-center justify-center rounded-md text-pos-ink-2 hover:bg-white md:hidden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" className="size-5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/app" className="flex items-center gap-2 rounded-md no-underline" aria-label="Your shop">
          <span className="flex size-7 items-center justify-center rounded-md bg-pos-night">
            <UdozoMark className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-pos-ink">Udozo POS</span>
        </Link>
        {who?.shop ? (
          <span className="hidden truncate text-sm text-pos-muted sm:inline">
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            {who.shop}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {who ? (
            <span className="hidden items-center gap-2 rounded-full py-1 pr-3 pl-1 lg:flex">
              <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-pos-600 text-xs font-bold text-white">
                {initialsOf(who.name)}
              </span>
              <span className="text-sm leading-tight">
                <span className="block font-semibold text-pos-ink">{who.name}</span>
                <span className="block text-xs text-pos-muted">{who.role}</span>
              </span>
            </span>
          ) : null}
          <form action={signOut}>
            <button type="submit" className="h-8 rounded-md border border-pos-line bg-white px-3 text-sm font-semibold text-pos-ink-2 hover:bg-pos-50">
              {signOutLabel}
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 overflow-y-auto border-r border-pos-line/70 px-2 py-4 md:block md:w-[68px] xl:w-60 xl:px-3">
          <div className="xl:hidden">
            <OwnerNav links={links} compact />
          </div>
          <div className="hidden xl:block">
            <OwnerNav links={links} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close the menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-pos-night/40" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-pos-page p-3 shadow-xl">
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-pos-ink">{who?.shop ?? "Udozo POS"}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close the menu" className="flex size-9 items-center justify-center rounded-md hover:bg-white">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" className="size-5">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {who ? (
              <p className="px-3 text-sm text-pos-muted">
                {who.name} · {who.role}
              </p>
            ) : null}
            <OwnerNav links={links} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
