'use client';

import { useId } from 'react';
import { cn } from '../format';
import { Button, Input } from './primitives';

export type DateRange = { from: string; to: string };

const pad = (value: number) => String(value).padStart(2, '0');
const toDateString = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const daysAgo = (days: number, from = new Date()) => toDateString(new Date(from.getTime() - days * 24 * 3600 * 1000));
const today = () => toDateString(new Date());

type Preset = { label: string; range: () => DateRange };

const presets: Preset[] = [
  { label: 'Last 7 days', range: () => ({ from: daysAgo(7), to: today() }) },
  { label: 'Last 30 days', range: () => ({ from: daysAgo(30), to: today() }) },
  { label: 'Last 90 days', range: () => ({ from: daysAgo(90), to: today() }) },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return { from: toDateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: today() };
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
      return { from: toDateString(start), to: toDateString(end) };
    },
  },
  {
    label: 'Year to date',
    range: () => {
      const now = new Date();
      return { from: `${now.getUTCFullYear()}-01-01`, to: today() };
    },
  },
];

/** A date range: quick presets, or the two dates typed directly. `value`/`onChange` are plain `YYYY-MM-DD` strings. */
export function DateRangePicker({ value, onChange, className }: { value: DateRange; onChange: (range: DateRange) => void; className?: string }) {
  const id = useId();
  const active = presets.find(preset => {
    const range = preset.range();
    return range.from === value.from && range.to === value.to;
  });
  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(preset => (
          <Button key={preset.label} type="button" variant={active?.label === preset.label ? 'primary' : 'secondary'} size="sm" onClick={() => onChange(preset.range())}>
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <label htmlFor={`${id}-from`} className="sr-only">
          From
        </label>
        <Input id={`${id}-from`} type="date" value={value.from} max={value.to} onChange={event => onChange({ ...value, from: event.target.value })} className="w-auto" />
        <span className="pb-2.5 text-sm text-muted">to</span>
        <label htmlFor={`${id}-to`} className="sr-only">
          To
        </label>
        <Input id={`${id}-to`} type="date" value={value.to} min={value.from} max={today()} onChange={event => onChange({ ...value, to: event.target.value })} className="w-auto" />
      </div>
    </div>
  );
}

/** The default range a report opens with: the last 30 days. */
export const defaultDateRange = (): DateRange => ({ from: daysAgo(30), to: today() });
