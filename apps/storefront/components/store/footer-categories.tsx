"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid, X } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { GroupIcon } from "./category-icon";

const groupHref = (group: StoreNavigationGroup) => `/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`;

/**
 * The footer's one way into the catalogue: a button opening every category as a full-screen grid (a native modal
 * dialog: Escape and the close button shut it, focus returns to the button), so the footer never lists them again.
 */
export function FooterCategories({ groups }: { groups: StoreNavigationGroup[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal?.();
    if (!open && element.open) element.close?.();
  }, [open]);
  if (!groups.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-slate-300 hover:bg-slate-50"
      >
        <LayoutGrid className="size-4" aria-hidden="true" /> All categories
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="footer-categories-title"
        onClose={() => setOpen(false)}
        onClick={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 backdrop:bg-navy-950/40"
      >
        <div className="mx-auto flex h-full max-w-5xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex items-center justify-between gap-4 py-2">
            <h2 id="footer-categories-title" className="font-display text-2xl font-extrabold tracking-tight text-navy-900">
              All categories
            </h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-11 place-items-center rounded-full text-navy-900 hover:bg-slate-100">
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <ul className="mt-4 grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {groups.map(group => (
              <li key={group.key}>
                <Link
                  href={groupHref(group)}
                  onClick={() => setOpen(false)}
                  className="flex h-full min-h-28 flex-col justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-navy-900 transition hover:border-slate-300 hover:shadow-sm"
                >
                  <GroupIcon group={group} className="size-10" />
                  <span>
                    <span className="block font-semibold">{group.label}</span>
                    {group.on_sale ? null : <span className="mt-0.5 block text-xs font-medium text-slate-500">Soon</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
