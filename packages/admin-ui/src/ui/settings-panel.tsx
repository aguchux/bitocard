'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from './primitives';

/** One group of settings (Settings > Markets): its own panel with a tinted heading, so each group is easy to find. */
export function SettingsPanel({ id, icon: Icon, title, description, children }: { id: string; icon: LucideIcon; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} className='scroll-mt-6 overflow-hidden'>
      <header className='flex items-start gap-3 border-b border-line bg-brand-50/60 px-4 py-3.5 sm:px-6'>
        <span className='mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm' aria-hidden='true'>
          <Icon className='size-[18px]' />
        </span>
        <div className='min-w-0'>
          <h2 className='text-base font-bold text-ink'>{title}</h2>
          {description ? <p className='mt-0.5 text-sm text-muted'>{description}</p> : null}
        </div>
      </header>
      {/* Sections pad themselves sideways and at the bottom. */}
      <div className='pt-4'>{children}</div>
    </Card>
  );
}

/**
 * Links to each panel, so a group is one click away: on phones one underlined row sliding sideways, as BitoCard's
 * tabs (none is current: they jump down the page), from `sm` up the pills, wrapping.
 */
export function PanelNav({ items }: { items: Array<{ id: string; label: string; icon: LucideIcon }> }) {
  return (
    <nav
      aria-label='Market settings'
      className='flex overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] sm:flex-wrap sm:gap-2 sm:overflow-visible [&::-webkit-scrollbar]:hidden'
    >
      {items.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#${id}`}
          className='inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-line px-3.5 text-sm font-semibold whitespace-nowrap text-muted hover:text-ink sm:min-h-0 sm:rounded-full sm:border sm:bg-white sm:px-3 sm:py-1.5 sm:font-medium sm:text-ink sm:shadow-sm sm:hover:border-brand-500 sm:hover:text-brand-600'
        >
          <Icon className='size-4 text-brand-500' aria-hidden='true' />
          {label}
        </a>
      ))}
      <span aria-hidden='true' className='min-w-4 flex-1 border-b-2 border-line sm:hidden' />
    </nav>
  );
}
