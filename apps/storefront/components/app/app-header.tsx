"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Menu, Search, Store, X } from "lucide-react";
import { signOut } from "@/lib/account-actions";
import { appTabs } from "./tabs";

/** The search form: a plain GET to the catalogue, so it works before any script loads. */
function SearchForm({ autoFocus = false, className = "" }: { autoFocus?: boolean; className?: string }) {
  return (
    <form action="/account/catalog" method="get" role="search" className={`flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 transition focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-[#070f4c]/10 ${className}`}>
      <Search className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
      <label className="sr-only" htmlFor={autoFocus ? "app-search-sheet" : "app-search"}>
        Search products
      </label>
      <input id={autoFocus ? "app-search-sheet" : "app-search"} name="q" type="search" autoComplete="off" autoFocus={autoFocus} placeholder="Search products…" className="w-full min-w-0 bg-transparent text-base text-[#070f4c] outline-none placeholder:text-slate-400" />
    </form>
  );
}

/**
 * The account app's header: the store's brand, the search (a field between the brand and the menu from tablets up, a
 * search button opening a sheet on phones), and the menu drawer with the tabs, the full store and signing out.
 */
export function AppHeader({ brand, storeName }: { brand: React.ReactNode; storeName: string }) {
  const [menu, setMenu] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return setMenu(false);
      // Keep Tab inside the drawer while it is open (it is modal).
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const opener = menuButton.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus();
    };
  }, [menu]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:h-[72px] sm:gap-6 sm:px-6 lg:px-8">
        <Link href="/account" aria-label={`${storeName} account home`} className="mr-auto inline-flex min-h-11 min-w-0 items-center no-underline md:mr-0">
          {brand}
        </Link>
        <SearchForm className="hidden flex-1 md:flex" />
        <button type="button" aria-label="Search" onClick={() => sheet.current?.showModal()} className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50 md:hidden">
          <Search className="size-6" aria-hidden="true" />
        </button>
        <button ref={menuButton} type="button" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)} className="-mr-2 grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50">
          <Menu className="size-7" aria-hidden="true" />
        </button>
      </div>

      {/* Phones: the search opens as a sheet at the top of the screen. */}
      <dialog
        ref={sheet}
        aria-label="Search"
        onClick={event => event.target === sheet.current && sheet.current?.close()}
        className="m-0 mt-[env(safe-area-inset-top)] w-full max-w-none bg-transparent p-3 backdrop:bg-[#070f4c]/40"
      >
        <div className="flex items-center gap-2 rounded-3xl bg-white p-2 shadow-2xl">
          <SearchForm autoFocus className="flex-1 border-0 focus-within:ring-0" />
          <button type="button" aria-label="Close search" onClick={() => sheet.current?.close()} className="grid size-11 shrink-0 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50">
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
      </dialog>

      {menu
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Menu">
              <button type="button" tabIndex={-1} aria-hidden="true" className="flex-1 bg-[#070f4c]/40" onClick={() => setMenu(false)} />
              <div ref={panel} className="flex h-dvh w-[min(20rem,86vw)] flex-col bg-white shadow-2xl">
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 pr-3 pl-5">
                  <p className="text-lg font-bold text-[#070f4c]">Menu</p>
                  <button ref={closeButton} type="button" aria-label="Close menu" onClick={() => setMenu(false)} className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50">
                    <X className="size-6" aria-hidden="true" />
                  </button>
                </div>
                <nav aria-label="Menu" className="flex-1 overflow-y-auto px-3 py-3">
                  {appTabs.map(tab => (
                    <Link key={tab.href} href={tab.href} onClick={() => setMenu(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold text-[#070f4c] hover:bg-slate-50">
                      <tab.icon className="size-5 text-slate-500" aria-hidden="true" />
                      {tab.label}
                    </Link>
                  ))}
                  <Link href="/" onClick={() => setMenu(false)} className="mt-2 flex min-h-12 items-center gap-3 rounded-xl border-t border-slate-100 px-3 pt-2 font-semibold text-[#070f4c] hover:bg-slate-50">
                    <Store className="size-5 text-slate-500" aria-hidden="true" />
                    Shop the full store
                  </Link>
                </nav>
                <form action={signOut} className="border-t border-slate-100 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 font-semibold text-[#070f4c] hover:border-slate-300">
                    <LogOut className="size-5" aria-hidden="true" /> Sign out
                  </button>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}
