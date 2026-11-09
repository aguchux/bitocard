'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, LogOut, Menu, X } from 'lucide-react';
import { Avatar } from '@bitocard/ui/avatar';
import { cn } from '../format';
import type { NavItem, SubNavItem } from './nav';
import { AppLink } from './session';

export type Crumb = { label: string; href?: string };

/** How far one press of the rail's arrows moves it: about three sections. */
const railStep = 200;

/**
 * The navy rail: the logo stays put and the sections scroll under it, smoothly and without a scroll bar, so every one
 * can be reached on short screens. Soft fades with arrows show there is more above or below (the arrows are for mice;
 * wheels, trackpads and fingers scroll it directly, and keyboard focus brings a section into view). The current
 * section is brought into view when the rail appears.
 */
function Rail({ brand, logo, sections, active, onNavigate }: { brand: string; logo: string; sections: NavItem<string>[]; active: string; onNavigate?: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ up: false, down: false });
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => setMore({ up: el.scrollTop > 2, down: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
    // At once, not smoothly: the rail opens showing the current section.
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      resized?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active]);
  const scroll = (direction: 1 | -1) => list.current?.scrollBy({ top: direction * railStep, behavior: 'smooth' });
  const arrow = 'absolute inset-x-0 z-10 flex h-10 justify-center from-navy-900 via-navy-900/80 to-transparent text-white/80 transition-opacity duration-200 hover:text-white';
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-navy-900 text-white">
      <AppLink href="/" className="flex shrink-0 flex-col items-center gap-1 px-3 pt-4 pb-3 text-center" onClick={onNavigate}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the product's light mark for the navy rail, from the app's public folder */}
        <img src={logo} alt="" className="h-9 w-auto" />
        <span className="text-sm font-extrabold tracking-tight">{brand}</span>
      </AppLink>
      <div className="relative min-h-0 flex-1">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll the menu up"
          onClick={() => scroll(-1)}
          className={cn(arrow, 'top-0 items-start bg-gradient-to-b pt-1', more.up ? 'opacity-100' : 'pointer-events-none opacity-0')}
        >
          <ChevronUp className="size-5" aria-hidden />
        </button>
        <div
          ref={list}
          data-rail-list
          className="flex h-full flex-col items-stretch gap-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-4 [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
        >
          {sections.map(section => {
            const selected = section.key === active;
            const Icon = section.icon;
            return (
              <AppLink
                key={section.key}
                href={section.href}
                onClick={onNavigate}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-xs font-medium transition-colors',
                  selected ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30' : 'text-white/75 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {section.label}
              </AppLink>
            );
          })}
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll the menu down"
          onClick={() => scroll(1)}
          className={cn(arrow, 'bottom-0 items-end bg-gradient-to-t pb-1', more.down ? 'opacity-100' : 'pointer-events-none opacity-0')}
        >
          <ChevronDown className="size-5" aria-hidden />
        </button>
      </div>
    </nav>
  );
}

/**
 * Udozo's one-column sidebar, light where BitoCard's rail is navy: the logo and name side by side at the top, every
 * section as a row with its icon on a tile, and the current section open in place with its pages on a guide line (any
 * other opens with its chevron, without leaving the page). The list scrolls under the logo; the current page is brought
 * into view when it appears.
 */
function Sidebar<K extends string>({
  brand,
  tagline,
  logo,
  sections,
  menus,
  active,
  current,
  onNavigate,
}: {
  brand: string;
  tagline?: string;
  logo: string;
  sections: NavItem<K>[];
  menus: Record<K, { title: string; items: SubNavItem[] }>;
  active: K;
  current: string;
  onNavigate?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Sections opened or closed by hand; otherwise only the current one is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }, [active]);
  const isOpen = (key: string) => toggled[key] ?? key === active;
  const toggle = (key: string) => setToggled(previous => ({ ...previous, [key]: !isOpen(key) }));
  return (
    <nav aria-label="Main" data-shell="sidebar" className="flex h-full flex-col border-r border-line bg-gradient-to-b from-brand-50 via-white to-white">
      <AppLink href="/" onClick={onNavigate} className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- the product's mark for a light background, from the app's public folder */}
        <img src={logo} alt="" className="size-10 shrink-0" />
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-base font-extrabold tracking-tight text-ink">{brand}</span>
          {tagline ? <span className="truncate text-xs font-medium text-muted">{tagline}</span> : null}
        </span>
      </AppLink>
      <div ref={list} data-rail-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 [scrollbar-width:thin]">
        <ul className="grid gap-0.5">
          {sections.map(section => {
            const selected = section.key === active;
            const expanded = isOpen(section.key);
            const items = menus[section.key]?.items ?? [];
            const Icon = section.icon;
            const listId = `sidebar-${section.key}`;
            return (
              <li key={section.key}>
                <div className={cn('flex items-center gap-1 rounded-xl transition-colors', selected ? 'bg-white shadow-sm ring-1 ring-line' : 'hover:bg-white/80')}>
                  <AppLink
                    href={section.href}
                    onClick={onNavigate}
                    aria-current={selected && section.href === current ? 'page' : undefined}
                    data-active={selected ? '' : undefined}
                    className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-sm font-semibold', selected ? 'text-ink' : 'text-ink/75 hover:text-ink')}
                  >
                    <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-lg', selected ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30' : 'bg-white text-navy-600 ring-1 ring-line')}>
                      <Icon className="size-4" />
                    </span>
                    <span className="truncate">{section.label}</span>
                  </AppLink>
                  {items.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => toggle(section.key)}
                      aria-expanded={expanded}
                      aria-controls={listId}
                      aria-label={`${expanded ? 'Hide' : 'Show'} ${section.label} pages`}
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
                    >
                      <ChevronDown className={cn('size-4 transition-transform motion-reduce:transition-none', expanded ? 'rotate-180' : '')} aria-hidden />
                    </button>
                  ) : null}
                </div>
                {expanded && items.length > 1 ? (
                  <ul id={listId} className="mt-1 mb-2 ml-6 grid gap-0.5 border-l-2 border-brand-100 pl-2">
                    {items.map(item => {
                      const here = item.href === current;
                      return (
                        <li key={item.href}>
                          <AppLink
                            href={item.href}
                            onClick={onNavigate}
                            aria-current={here ? 'page' : undefined}
                            className={cn(
                              '-ml-[10px] flex min-h-9 items-center gap-2 border-l-2 py-1 pr-2 pl-3 text-[13px] transition-colors',
                              here ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-muted hover:border-brand-300 hover:text-ink',
                            )}
                          >
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.count ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">{item.count}</span> : null}
                          </AppLink>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

function SubNav({ title, items, current, onNavigate }: { title: string; items: SubNavItem[]; current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label={title} className="flex flex-col gap-1 px-3 py-6">
      <p className="px-3 pb-3 text-xl font-extrabold tracking-tight text-ink">{title}</p>
      {items.map(item => {
        const selected = item.href === current;
        const Icon = item.icon;
        return (
          <AppLink
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              selected ? 'bg-brand-50 text-brand-600' : 'text-muted hover:bg-canvas hover:text-ink',
            )}
          >
            {Icon ? <Icon className="size-[18px]" aria-hidden /> : null}
            <span className="flex-1">{item.label}</span>
            {item.count ? <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">{item.count}</span> : null}
          </AppLink>
        );
      })}
    </nav>
  );
}

export type AccountMenuProps = {
  name: string;
  email: string;
  /** A line under the email, for example the admin's roles or the reseller account. */
  detail?: string;
  /** Their profile photo (Udozo), shown in place of their initial. */
  avatarUrl?: string | null;
  /** Extra menu items above Sign out (for example switching account). */
  children?: ReactNode;
  signingOut?: boolean;
  onSignOut: () => void;
};

/** The signed-in person, with Sign out and any extra items the app adds. */
export function AccountMenu({ name, email, detail, avatarUrl, children, signingOut, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" className="flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-canvas">
        {avatarUrl ? (
          <Avatar name={name} url={avatarUrl} className="size-9 text-sm" />
        ) : (
          <span aria-hidden className="grid size-9 place-items-center rounded-full bg-navy-700 text-sm font-bold text-white">
            {initial}
          </span>
        )}
        <span className="hidden max-w-40 truncate text-sm font-semibold text-ink sm:block">{name}</span>
        <ChevronDown className="size-4 text-muted" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
            {detail ? <p className="mt-1 text-xs text-subtle">{detail}</p> : null}
          </div>
          {children ? (
            <div className="border-t border-line py-1" onClick={() => setOpen(false)}>
              {children}
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={onSignOut}
            className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink hover:bg-canvas"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type ConsoleShellProps<K extends string> = {
  /** The name under the logo in the rail. */
  brand: string;
  /** The light mark on the navy rail, from the app's public folder (BitoCard's by default; Afrippa's admin its own). */
  logo?: string;
  sections: NavItem<K>[];
  menus: Record<K, { title: string; items: SubNavItem[] }>;
  section: K;
  /** The section menu href matching this page. */
  current: string;
  crumbs: Crumb[];
  actions?: ReactNode;
  /** The account menu (top right). */
  account: ReactNode;
  /** The notifications bell, beside the account menu. */
  notifications?: ReactNode;
  /** Shown above every page, for example a sandbox notice. */
  banner?: ReactNode;
  /**
   * The left column's design: `rail` (BitoCard's navy icon rail beside the section's menu, the default) or `sidebar`
   * (Udozo's one light column, its sections opening in place; `logo` is then the mark for a light background).
   */
  variant?: 'rail' | 'sidebar';
  /** Under the name in the sidebar (for example "Admin" or "Seller HQ"). */
  tagline?: string;
  children: ReactNode;
};

/**
 * The layout of the admin app and SHQ: navy rail, section menu, breadcrumbs and account menu. On phones the rail and
 * section menu move into a drawer.
 */
export function ConsoleShell<K extends string>({ brand, logo = '/bitocard-mark-light.png', sections, menus, section, current, crumbs, actions, account, notifications, banner, variant = 'rail', tagline, children }: ConsoleShellProps<K>) {
  const [drawer, setDrawer] = useState(false);
  const sidebar = variant === 'sidebar';
  const { title: sectionTitle, items: subnav } = menus[section];
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawer]);

  return (
    <div className="flex min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {sidebar ? (
        <div className="sticky top-0 hidden h-svh w-72 shrink-0 lg:block">
          <Sidebar brand={brand} tagline={tagline} logo={logo} sections={sections} menus={menus} active={section} current={current} />
        </div>
      ) : (
        <>
          <div className="sticky top-0 hidden h-svh w-24 shrink-0 lg:block">
            <Rail brand={brand} logo={logo} sections={sections} active={section} />
          </div>
          <aside className="sticky top-0 hidden h-svh w-60 shrink-0 overflow-y-auto border-r border-line bg-white xl:block">
            <SubNav title={sectionTitle} items={subnav} current={current} />
          </aside>
        </>
      )}

      {drawer && sidebar ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="relative h-dvh w-80 max-w-[85vw] shrink-0 bg-white">
            <Sidebar brand={brand} tagline={tagline} logo={logo} sections={sections} menus={menus} active={section} current={current} onNavigate={() => setDrawer(false)} />
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute top-4 right-3 grid size-10 place-items-center rounded-xl text-muted hover:bg-canvas">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <button type="button" aria-label="Close menu" className="flex-1 bg-navy-950/45" onClick={() => setDrawer(false)} />
        </div>
      ) : drawer ? (
        <div className="fixed inset-0 z-40 flex xl:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="h-dvh w-24 shrink-0">
            <Rail brand={brand} logo={logo} sections={sections} active={section} onNavigate={() => setDrawer(false)} />
          </div>
          <div className="w-64 max-w-[calc(100vw-6rem)] overflow-y-auto bg-white">
            <div className="flex justify-end p-2">
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="grid size-11 place-items-center rounded-xl text-muted hover:bg-canvas">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <SubNav title={sectionTitle} items={subnav} current={current} onNavigate={() => setDrawer(false)} />
          </div>
          <button type="button" aria-label="Close menu" className="flex-1 bg-navy-950/45" onClick={() => setDrawer(false)} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className={cn('grid size-11 place-items-center rounded-xl text-ink hover:bg-canvas', sidebar ? 'lg:hidden' : 'xl:hidden')}>
            <Menu className="size-5" aria-hidden />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 truncate text-sm">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className={cn('min-w-0 items-center gap-1.5', index === crumbs.length - 1 ? 'flex' : 'hidden sm:flex')}>
                  {index > 0 ? <ChevronRight className="hidden size-3.5 shrink-0 text-subtle sm:block" aria-hidden /> : null}
                  {crumb.href && index < crumbs.length - 1 ? (
                    <AppLink href={crumb.href} className="truncate text-muted hover:text-ink">
                      {crumb.label}
                    </AppLink>
                  ) : (
                    <span className={cn('truncate', index === crumbs.length - 1 ? 'font-semibold text-ink' : 'text-muted')} aria-current={index === crumbs.length - 1 ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          {actions}
          {notifications}
          {account}
        </header>
        {banner}
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
