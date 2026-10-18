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

/** Links to each panel, so a group is one click away. */
export function PanelNav({ items }: { items: Array<{ id: string; label: string; icon: LucideIcon }> }) {
  return (
    <nav aria-label='Market settings' className='flex flex-wrap gap-2'>
      {items.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#${id}`}
          className='inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink shadow-sm hover:border-brand-500 hover:text-brand-600'
        >
          <Icon className='size-4 text-brand-500' aria-hidden='true' />
          {label}
        </a>
      ))}
    </nav>
  );
}
