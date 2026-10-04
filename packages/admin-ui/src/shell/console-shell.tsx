'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { cn } from '../format';
import type { NavItem, SubNavItem } from './nav';
import { AppLink } from './session';

export type Crumb = { label: string; href?: string };

function Rail({ brand, sections, active, onNavigate }: { brand: string; sections: NavItem<string>[]; active: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col items-stretch gap-1 bg-navy-900 px-2 py-4 text-white">
      <AppLink href="/" className="mb-4 flex flex-col items-center gap-1 px-1 py-1 text-center" onClick={onNavigate}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the light "b" mark for the navy rail, from the app's public folder */}
        <img src="/bitocard-mark-light.png" alt="" className="h-9 w-auto" />
        <span className="text-sm font-extrabold tracking-tight">{brand}</span>
      </AppLink>
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
              'flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-xs font-medium transition-colors',
              selected ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30' : 'text-white/75 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {section.label}
          </AppLink>
        );
      })}
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
  /** Extra menu items above Sign out (for example switching account). */
  children?: ReactNode;
  signingOut?: boolean;
  onSignOut: () => void;
};

/** The signed-in person, with Sign out and any extra items the app adds. */
export function AccountMenu({ name, email, detail, children, signingOut, onSignOut }: AccountMenuProps) {
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
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-navy-700 text-sm font-bold text-white">
          {initial}
        </span>
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
  children: ReactNode;
};

/**
 * The layout of the admin app and SHQ: navy rail, section menu, breadcrumbs and account menu. On phones the rail and
 * section menu move into a drawer.
 */
export function ConsoleShell<K extends string>({ brand, sections, menus, section, current, crumbs, actions, account, notifications, banner, children }: ConsoleShellProps<K>) {
  const [drawer, setDrawer] = useState(false);
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
      <div className="sticky top-0 hidden h-svh w-24 shrink-0 lg:block">
        <Rail brand={brand} sections={sections} active={section} />
      </div>
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 overflow-y-auto border-r border-line bg-white xl:block">
        <SubNav title={sectionTitle} items={subnav} current={current} />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 flex xl:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="w-24 shrink-0">
            <Rail brand={brand} sections={sections} active={section} onNavigate={() => setDrawer(false)} />
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
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="grid size-11 place-items-center rounded-xl text-ink hover:bg-canvas xl:hidden">
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
