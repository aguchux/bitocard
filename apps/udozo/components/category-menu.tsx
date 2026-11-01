"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LayoutGrid, Menu, X } from "lucide-react";
import { ShopIcon } from "./icon";

export type MenuCategory = { slug: string; name: string; icon: string | null; children?: Array<{ slug: string; name: string; icon: string | null }> };

/**
 * The header's categories: the navy left end of the header's bar (the menu icon, and "Categories" from tablets up, or
 * always where it stands alone: `labelled`), opening a drawer from the left with the market's top categories, each opening its subcategories. Rows are 48 px tall
 * for thumbs; choosing one closes the drawer (the layout, and so the drawer, stays across pages).
 */
export function CategoryMenu({ categories, prefix, allHref, place, labelled = false }: { categories: MenuCategory[]; prefix: string; allHref: string; place: string | null; labelled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const titleId = useId();
  const close = () => dialog.current?.close();
  const row = "flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-navy-900 hover:bg-navy-50";

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        aria-label="Categories"
        className={`-m-0.5 inline-flex shrink-0 items-center justify-center gap-2 rounded-l-2xl bg-navy-900 text-white hover:bg-navy-800 ${labelled ? "flex-1 rounded-r-2xl px-4" : "w-12 sm:w-auto sm:px-4"}`}
      >
        <Menu className="size-5.5" aria-hidden="true" strokeWidth={2.4} />
        <span className={`text-[15px] font-bold ${labelled ? "" : "hidden sm:inline"}`}>Categories</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={event => {
          if (event.target === dialog.current) close();
        }}
        className="drawer m-0 h-dvh max-h-none w-[min(100vw,24rem)] max-w-none bg-white p-0 text-navy-900"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-navy-100 px-4 py-3">
            <span className="grid min-w-0 flex-1">
              <strong id={titleId} className="text-lg font-extrabold">
                Categories
              </strong>
              {place ? <span className="truncate text-xs text-navy-500">Across {place}</span> : null}
            </span>
            <button type="button" onClick={close} aria-label="Close" className="grid size-11 place-items-center rounded-full hover:bg-navy-50">
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>
          <nav aria-label="Categories" className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {categories.length ? (
              <ul className="grid gap-0.5">
                {categories.map(category => {
                  const children = category.children ?? [];
                  const expanded = open === category.slug;
                  const listId = `${titleId}-${category.slug}`;
                  return (
                    <li key={category.slug}>
                      <div className="flex items-center gap-1">
                        <Link href={`${prefix}${category.slug}`} onClick={close} className={row}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                            <ShopIcon name={category.icon} className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{category.name}</span>
                          {children.length ? null : <ChevronRight className="size-4 text-navy-400" aria-hidden="true" />}
                        </Link>
                        {children.length ? (
                          <button
                            type="button"
                            onClick={() => setOpen(expanded ? null : category.slug)}
                            aria-expanded={expanded}
                            aria-controls={listId}
                            aria-label={`${expanded ? "Hide" : "Show"} ${category.name} subcategories`}
                            className="grid size-12 shrink-0 place-items-center rounded-xl text-navy-600 hover:bg-navy-50"
                          >
                            <ChevronDown className={`size-5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      {children.length ? (
                        <ul id={listId} hidden={!expanded} className="mb-1 ml-8 grid gap-0.5 border-l-2 border-navy-100 pl-3">
                          <li>
                            <Link href={`${prefix}${category.slug}`} onClick={close} className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-brand-700 hover:bg-navy-50">
                              All {category.name}
                            </Link>
                          </li>
                          {children.map(child => (
                            <li key={child.slug}>
                              <Link href={`${prefix}${child.slug}`} onClick={close} className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-navy-800 hover:bg-navy-50">
                                {child.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-6 text-sm text-navy-600">Categories could not be loaded just now. Try again shortly.</p>
            )}
          </nav>
          <footer className="border-t border-navy-100 p-2">
            <Link href={allHref} onClick={close} className={row}>
              <LayoutGrid className="size-5 text-navy-600" aria-hidden="true" /> Browse everything
            </Link>
          </footer>
        </div>
      </dialog>
    </>
  );
}
