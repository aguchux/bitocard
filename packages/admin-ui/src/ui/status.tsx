import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Inbox, RotateCw } from 'lucide-react';
import { cn, humanise } from '../format';

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'pink';

const tones: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
  grey: 'bg-slate-100 text-slate-600',
  pink: 'bg-brand-50 text-brand-700',
};
const dots: Record<Tone, string> = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', grey: 'bg-slate-400', pink: 'bg-brand-500' };

/** Every status the admin shows, mapped to one colour, so the same word always looks the same. */
const statusTones: Record<string, Tone> = {
  completed: 'green',
  succeeded: 'green',
  paid: 'green',
  approved: 'green',
  active: 'green',
  operational: 'green',
  enabled: 'green',
  published: 'green',
  connected: 'green',
  processed: 'green',
  processing: 'blue',
  in_progress: 'blue',
  pending: 'amber',
  in_review: 'amber',
  needs_review: 'amber',
  pending_review: 'amber',
  degraded: 'amber',
  incomplete: 'amber',
  unmatched: 'amber',
  received: 'blue',
  draft: 'grey',
  expired: 'grey',
  disabled: 'grey',
  not_connected: 'grey',
  disconnected: 'grey',
  refunded: 'pink',
  failed: 'red',
  declined: 'red',
  suspended: 'red',
  rejected: 'red',
};

export function Badge({ tone = 'grey', children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone], className)}>
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', dots[tone])} /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTones[status] ?? 'grey'}>{label ?? humanise(status)}</Badge>;
}

/** "+12.8% vs previous period", green when up, red when down. */
export function Trend({ change, caption = 'vs. previous period' }: { change: number | null; caption?: string }) {
  if (change === null) return <p className="text-xs text-muted">New this period</p>;
  if (change === 0) return <p className="text-xs text-muted">{`No change ${caption}`}</p>;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-emerald-600' : 'text-red-600')}>
        <Icon className="size-3.5" aria-hidden />
        {`${up ? '+' : ''}${change.toFixed(1)}%`}
      </span>
      <span className="text-muted">{caption}</span>
    </p>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-canvas text-subtle">{icon ?? <Inbox className="size-6" aria-hidden />}</span>
      <p className="font-semibold text-ink">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted">{children}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <p className="max-w-md text-sm text-ink">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
          <RotateCw className="size-4" aria-hidden />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** A coloured notice for results and warnings inside a page. */
export function Notice({ tone = 'blue', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={cn('rounded-xl px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}
