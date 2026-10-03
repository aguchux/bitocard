'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../format';
import { EmptyState, ErrorState } from './status';
import { Skeleton } from './primitives';

const iconTones = {
  pink: 'bg-brand-50 text-brand-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
} as const;

/** A headline number with its icon and trend, as on the dashboard. */
export function StatCard({ label, value, icon, tone = 'pink', footer, loading }: { label: string; value: ReactNode; icon: ReactNode; tone?: keyof typeof iconTones; footer?: ReactNode; loading?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-card">
      <span aria-hidden className={cn('grid size-12 shrink-0 place-items-center rounded-2xl [&>svg]:size-6', iconTones[tone])}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted">{label}</p>
        {loading ? <Skeleton className="mt-2 h-8 w-32" /> : <div className="mt-1 truncate text-2xl font-extrabold tracking-tight text-ink">{value}</div>}
        {footer && !loading ? <div className="mt-1">{footer}</div> : null}
      </div>
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hidden in the stacked mobile layout (secondary details). */
  hideOnMobile?: boolean;
  className?: string;
};

/**
 * A table on wide screens and stacked cards on phones. Rows can link somewhere (whole row clickable via `onRowClick`).
 * Handles loading, error and empty states so every list behaves the same.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty = 'Nothing here yet.',
  onRowClick,
  caption,
}: {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: string;
  onRowClick?: (row: T) => void;
  caption?: string;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows) {
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!rows?.length) return <EmptyState title={empty} />;
  type RowProps = { onClick?: () => void; onKeyDown?: (event: React.KeyboardEvent) => void; tabIndex?: number; role?: 'link'; className?: string };
  const clickable = onRowClick
    ? (row: T): RowProps => ({
        onClick: () => onRowClick(row),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRowClick(row);
          }
        },
        tabIndex: 0,
        role: 'link' as const,
        className: 'cursor-pointer hover:bg-canvas focus-visible:bg-canvas',
      })
    : (): RowProps => ({});

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="bg-canvas text-xs font-semibold text-muted">
              {columns.map(column => (
                <th key={column.key} scope="col" className={cn('px-4 py-3 first:pl-6 last:pr-6', column.align === 'right' && 'text-right', column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(row => {
              const props = clickable(row);
              return (
                <tr key={rowKey(row)} {...props} className={cn('transition-colors', props.className)}>
                  {columns.map(column => (
                    <td key={column.key} className={cn('px-4 py-3.5 align-middle first:pl-6 last:pr-6', column.align === 'right' && 'text-right', column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map(row => {
          const props = clickable(row);
          return (
            <li key={rowKey(row)} {...props} className={cn('space-y-1.5 px-5 py-4', props.className)}>
              {columns
                .filter(column => !column.hideOnMobile)
                .map((column, index) => (
                  <div key={column.key} className={cn('flex items-center justify-between gap-3 text-sm', index === 0 && 'font-semibold')}>
                    {index > 0 ? <span className="text-xs text-muted">{column.header}</span> : null}
                    <span className={cn('min-w-0', index > 0 && 'text-right')}>{column.cell(row)}</span>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Cursor pagination: "Load more" while the API says there is more. */
export function LoadMore({ hasMore, loading, onClick }: { hasMore?: boolean; loading?: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-line p-4">
      <button type="button" onClick={onClick} disabled={loading} className="min-h-10 rounded-xl px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-60">
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

/** Underlined tabs (or segmented pills) with buttons; the page keeps the selected value. */
export function Tabs<V extends string>({ value, onChange, items, variant = 'underline', label }: { value: V; onChange: (value: V) => void; items: Array<{ value: V; label: string; count?: number }>; variant?: 'underline' | 'pills'; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 overflow-x-auto', variant === 'underline' ? 'border-b border-line' : 'rounded-xl border border-line bg-white p-1')}>
      {items.map(item => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center gap-2 px-4 text-sm font-semibold transition-colors',
              variant === 'underline'
                ? cn('-mb-px border-b-2', selected ? 'border-brand-500 text-brand-600' : 'border-transparent text-muted hover:text-ink')
                : cn('rounded-lg', selected ? 'bg-brand-500 text-white' : 'text-muted hover:bg-canvas'),
            )}
          >
            {item.label}
            {item.count !== undefined ? <span className={cn('rounded-full px-1.5 text-xs', selected && variant === 'pills' ? 'bg-white/25' : 'bg-canvas')}>{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A modal built on the native <dialog>: focus moves inside, Escape closes, the page behind is inert.
 * The parent controls `open`.
 */
export function Dialog({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClose={onClose}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-0 text-ink shadow-xl"
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-bold">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
