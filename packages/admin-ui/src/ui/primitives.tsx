'use client';

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
  secondary: 'border border-brand-500 bg-white text-brand-600 hover:bg-brand-50',
  ghost: 'text-muted hover:bg-canvas hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, as: Tag = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cn('min-w-0 rounded-2xl border border-line bg-white shadow-card', className)}>{children}</Tag>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const fieldBase = 'w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas';

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'min-h-11', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-24 py-2.5', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'min-h-11 cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
});

/** A labelled filter: label above a select, as in the catalogue template. */
export function FilterSelect({ label, value, onChange, options, id }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; id: string }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1 rounded-lg border border-line bg-white px-3 py-2 sm:flex-none">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <select id={id} value={value} onChange={event => onChange(event.target.value)} className="cursor-pointer bg-transparent text-sm font-semibold text-ink focus:outline-none">
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-500' : 'bg-line')}
    >
      <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

export function KeyValue({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map(item => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-subtle">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-line/70', className)} />;
}
