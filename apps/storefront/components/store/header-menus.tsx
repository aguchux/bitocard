"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Coins, LayoutGrid, Menu, MonitorSmartphone, Phone, ShieldCheck, Sparkles, Store, X, type LucideIcon } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { CategoryIcon, GroupIcon } from "./category-icon";

const catalogueHref = (group: StoreNavigationGroup) => (group.categories.length === 1 ? `/catalogs/${group.categories[0].category}` : `/catalogs/${group.key}`);

/** Straight to what people ask for most, beside the Products menu (and at the top of the phone menu). */
export const quickLinks: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/catalogs/virtual_numbers", label: "Virtual numbers", icon: Phone },
  { href: "/catalogs/rdp", label: "RDP", icon: MonitorSmartphone },
  { href: "/catalogs/vpn", label: "VPN", icon: ShieldCheck },
  { href: "/account/crypto", label: "Crypto", icon: Coins },
  { href: "/spin", label: "Spin & win", icon: Sparkles },
];

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

/** One group's categories and top brands: the right-hand side of the Products menu. */
function GroupPanel({ group, close }: { group: StoreNavigationGroup; close: () => void }) {
  return (
    <div className="min-w-0 flex-1 p-4">
      <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group.label}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {group.categories.map(category => (
          <li key={category.category}>
            <Link href={`/catalogs/${category.category}`} onClick={close} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50">
              <span className="flex min-w-0 items-center gap-2.5">
                <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-9" />
                <span className="truncate">{category.label}</span>
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
          <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {group.brands.slice(0, 9).map(brand => (
              <li key={brand.slug}>
                <Link href={`/catalogs/${group.key}?brand=${encodeURIComponent(brand.slug)}`} onClick={close} className="block truncate rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  {brand.name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Link href={catalogueHref(group)} onClick={close} className="mt-3 block rounded-lg bg-pink-50 px-3 py-2 text-center text-sm font-semibold text-brand-600">
        All {group.label.toLowerCase()}
      </Link>
    </div>
  );
}

/**
 * The Products menu: every group down the left (pointing at or focusing one shows its categories and brands on the
 * right; choosing it opens its catalogue), and All products at the bottom.
 */
function CatalogMenu({ groups }: { groups: StoreNavigationGroup[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(groups[0]?.key ?? "");
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const group = groups.find(item => item.key === active) ?? groups[0];
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[15px] font-medium whitespace-nowrap text-navy-900 hover:bg-slate-50"
      >
        <LayoutGrid className="size-4" aria-hidden="true" />
        Products
        <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && group ? (
        <div className="absolute left-0 z-40 mt-2 flex w-[min(46rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
          <div className="flex w-56 shrink-0 flex-col border-r border-slate-100 bg-slate-50/70 p-2">
            <ul className="flex-1 space-y-0.5">
              {groups.map(item => (
                <li key={item.key}>
                  <Link
                    href={catalogueHref(item)}
                    onClick={close}
                    onMouseEnter={() => setActive(item.key)}
                    onFocus={() => setActive(item.key)}
                    aria-current={item.key === group.key ? "true" : undefined}
                    className={`flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-sm font-semibold ${item.key === group.key ? "bg-white text-navy-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-navy-900"}`}
                  >
                    <GroupIcon group={item} className="size-8" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.on_sale ? <ChevronRight className="size-4 text-slate-400" aria-hidden="true" /> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Soon</span>}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/catalogs" onClick={close} className="mt-2 flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold text-brand-600 hover:bg-white">
              All products
            </Link>
          </div>
          <GroupPanel group={group} close={close} />
        </div>
      ) : null}
    </div>
  );
}

/** `links`: the quick links this store shows (`quickLinksFor`); every one when not given. */
export function DesktopNav({ groups, links }: { groups: StoreNavigationGroup[]; links?: string[] }) {
  const shown = links ? quickLinks.filter(link => links.includes(link.href)) : quickLinks;
  return (
    <nav aria-label="Categories" className="hidden items-center gap-0.5 xl:flex">
      {groups.length ? <CatalogMenu groups={groups} /> : null}
      {shown.map(link => (
        <Link key={link.href} href={link.href} className="flex min-h-11 items-center rounded-lg px-2.5 text-[15px] font-medium whitespace-nowrap text-navy-900 hover:bg-slate-50">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Phones and tablets: the menu in a drawer, rendered into <body>: the sticky header's backdrop blur makes the header
 * the containing block of fixed elements inside it, which clipped the drawer to the header's height.
 */
export function MobileMenu({ groups, signedIn = false, reseller = true, links }: { groups: StoreNavigationGroup[]; signedIn?: boolean; reseller?: boolean; links?: string[] }) {
  const shown = links ? quickLinks.filter(link => links.includes(link.href)) : quickLinks;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const opener = trigger.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus();
    };
  }, [open]);
  return (
    <div className="xl:hidden">
      <button ref={trigger} type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-xl text-navy-900 hover:bg-slate-50">
        <Menu className="size-6" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
              <button type="button" tabIndex={-1} aria-hidden="true" className="flex-1 bg-navy-900/50" onClick={() => setOpen(false)} />
              {/* The categories scroll; sign in and the reseller link stay at the bottom, in reach of a thumb. */}
              <div className="flex h-dvh w-[min(22rem,88vw)] flex-col bg-white shadow-2xl">
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 pr-3 pl-5">
                  <p className="font-display text-lg font-bold text-navy-900">Shop</p>
                  <button ref={closeButton} type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-xl text-navy-900 hover:bg-slate-50">
                    <X className="size-6" aria-hidden="true" />
                  </button>
                </div>
                <nav aria-label="Categories" className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
                  {shown.length ? (
                  <ul className="grid grid-cols-3 gap-2 border-b border-slate-100 pb-4">
                    {shown.map(link => (
                      <li key={link.href}>
                        <Link href={link.href} onClick={() => setOpen(false)} className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-1 text-center text-xs font-semibold text-navy-900 hover:bg-slate-100">
                          <link.icon className="size-5 text-brand-500" aria-hidden="true" />
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  ) : null}
                  {groups.length ? <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Products</p> : null}
                  {groups.map(group => (
                    <div key={group.key}>
                      <Link href={catalogueHref(group)} onClick={() => setOpen(false)} className="font-display flex min-h-12 items-center gap-2.5 text-lg font-bold text-navy-900">
                        <GroupIcon group={group} className="size-10" />
                        <span className="flex-1">{group.label}</span>
                        {/* A group of one category is that category: no list repeating its name. */}
                        {group.categories.length === 1 && !group.on_sale ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-sans text-[11px] font-semibold text-slate-500">Soon</span> : null}
                      </Link>
                      {group.categories.length > 1 ? (
                        <ul className="mt-0.5">
                          {group.categories.map(category => (
                            <li key={category.category}>
                              <Link href={`/catalogs/${category.category}`} onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-between gap-3 pl-12 text-slate-600">
                                <span className="flex min-w-0 items-center gap-2">
                                  <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-8" ink="text-slate-500" tile="bg-slate-100" />
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
                <div className="grid shrink-0 gap-2.5 border-t border-slate-100 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Link
                    href={signedIn ? "/account" : "/signin"}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-4 font-semibold text-navy-900"
                  >
                    {signedIn ? "Account" : "Sign in"}
                  </Link>
                  {reseller ? (
                    <Link href="/resellers" onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 font-semibold text-white">
                      <Store className="size-5" aria-hidden="true" />
                      Start Reselling
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
