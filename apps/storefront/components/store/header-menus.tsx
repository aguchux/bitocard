"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Menu, Store, X } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { CategoryIcon, GroupIcon } from "./category-icon";

const catalogueHref = (group: StoreNavigationGroup) => (group.categories.length === 1 ? `/catalogs/${group.categories[0].category}` : `/catalogs/${group.key}`);

/** Closes on Escape or a click outside. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onClick = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);
  return ref;
}

/** One menu group: its categories and top brands in a panel. */
function NavGroup({ group }: { group: StoreNavigationGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-[15px] font-medium whitespace-nowrap text-[#070f4c] hover:bg-slate-50"
      >
        {group.label}
        <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 z-40 mt-2 w-80 rounded-2xl border border-slate-100 bg-white p-4 shadow-xl">
          <ul className="space-y-1">
            {group.categories.map(category => (
              <li key={category.category}>
                <Link href={`/catalogs/${category.category}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-[#070f4c] hover:bg-slate-50">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-5" />
                    {category.label}
                  </span>
                  {category.on_sale ? (
                    <span className="text-xs font-normal text-slate-500">{category.products}</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Soon</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {group.brands.length ? (
            <>
              <p className="mt-3 border-t border-slate-100 px-2 pt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Popular</p>
              <ul className="mt-1 grid grid-cols-2 gap-1">
                {group.brands.slice(0, 8).map(brand => (
                  <li key={brand.slug}>
                    <Link href={`/catalogs/${group.key}?brand=${encodeURIComponent(brand.slug)}`} onClick={() => setOpen(false)} className="block truncate rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                      {brand.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Link href={catalogueHref(group)} onClick={() => setOpen(false)} className="mt-3 block rounded-lg bg-pink-50 px-3 py-2 text-center text-sm font-semibold text-[#e0116d]">
            All {group.label.toLowerCase()}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function DesktopNav({ groups }: { groups: StoreNavigationGroup[] }) {
  return (
    <nav aria-label="Categories" className="hidden items-center gap-0.5 xl:flex">
      {groups.map(group => (
        <NavGroup key={group.key} group={group} />
      ))}
    </nav>
  );
}

/**
 * Phones and tablets: the menu in a drawer, rendered into <body>: the sticky header's backdrop blur makes the header
 * the containing block of fixed elements inside it, which clipped the drawer to the header's height.
 */
export function MobileMenu({ groups }: { groups: StoreNavigationGroup[] }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="xl:hidden">
      <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50">
        <Menu className="size-6" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
              <button type="button" aria-label="Close menu" className="flex-1 bg-[#070f4c]/50" onClick={() => setOpen(false)} />
              <div className="flex w-[min(22rem,88vw)] flex-col overflow-y-auto bg-white p-5 shadow-2xl">
                <div className="flex justify-end">
                  <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50">
                    <X className="size-6" aria-hidden="true" />
                  </button>
                </div>
                <nav aria-label="Categories" className="mt-2 space-y-4">
                  {groups.map(group => (
                    <div key={group.key}>
                      <Link href={catalogueHref(group)} onClick={() => setOpen(false)} className="font-display flex items-center gap-2.5 text-lg font-bold text-[#070f4c]">
                        <GroupIcon group={group} className="size-6" ink="text-[#e0116d]" />
                        {group.label}
                      </Link>
                      {group.categories.length > 1 || !group.on_sale ? (
                        <ul className="mt-1">
                          {group.categories.map(category => (
                            <li key={category.category}>
                              <Link href={`/catalogs/${category.category}`} onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-between gap-3 pl-8 text-slate-600">
                                <span className="flex min-w-0 items-center gap-2">
                                  <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-4" ink="text-slate-400" />
                                  {category.label}
                                </span>
                                {category.on_sale ? null : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Soon</span>}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </nav>
                <Link href="/signin" onClick={() => setOpen(false)} className="mt-6 flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-4 font-semibold text-[#070f4c]">
                  Sign in
                </Link>
                <Link href="/resellers" onClick={() => setOpen(false)} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ff2382] px-4 font-semibold text-white">
                  <Store className="size-5" aria-hidden="true" />
                  Open a reseller store
                </Link>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
