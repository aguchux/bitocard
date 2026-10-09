import type { ReactNode } from 'react';
import { BadgePercent, TrendingUp } from 'lucide-react';
import { cn } from '../format';

/** "1.5" (per cent) as basis points, or null when it is not a percentage with at most two decimals. */
export function percentToBps(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** Basis points as a percentage to type into a field: 150 is "1.5". */
export const bpsToPercent = (bps: number | null | undefined) => (bps === null || bps === undefined ? '' : String(bps / 100));

/** "12.50" in a currency's main unit as minor units, or null when it is not an amount. */
export function amountToMinor(value: string) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null;
}

/** The two ways a product sells, in plain words, for whoever is setting prices. */
export function PricingSchemes({ audience }: { audience: 'admin' | 'reseller' }) {
  const discount =
    audience === 'admin'
      ? 'Products with a face value: airtime, data, bills, pay-TV and most gift cards. Customers never pay more than face value. The supplier sells to BitoCard below face value; you choose how much of that discount resellers get. BitoCard keeps the rest.'
      : 'Products with a face value: airtime, data, bills, pay-TV and most gift cards. Customers never pay more than face value. BitoCard sells to you below face value; that discount is your profit. You can give part of it to your customers.';
  const markup =
    audience === 'admin'
      ? 'Products without a face value, such as phone numbers, software or mobile money, and anything the supplier sells at or above face value. BitoCard adds a markup to the supplier’s cost, or sets a fixed price.'
      : 'Products without a face value, such as phone numbers and software. You add a markup to BitoCard’s price, or set a fixed price per product.';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Scheme icon={<BadgePercent className="size-5" aria-hidden />} title="Discount products" tone="green">
        {discount}
      </Scheme>
      <Scheme icon={<TrendingUp className="size-5" aria-hidden />} title="Markup products" tone="blue">
        {markup}
      </Scheme>
    </div>
  );
}

function Scheme({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: 'green' | 'blue'; children: ReactNode }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-4', tone === 'green' ? 'border-emerald-100 bg-emerald-50/60' : 'border-blue-100 bg-blue-50/60')}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-white', tone === 'green' ? 'text-emerald-600' : 'text-blue-600')}>{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}

export type BreakdownRow = { label: string; value: ReactNode; hint?: string; tone?: 'profit' | 'muted' | 'warning' };

/** One sale, line by line: what it costs, what the customer pays, and what is made. */
export function PriceBreakdown({ rows, caption }: { rows: BreakdownRow[]; caption: string }) {
  return (
    <dl aria-label={caption} className="divide-y divide-line rounded-2xl border border-line bg-white">
      {rows.map(row => (
        <div key={row.label} className={cn('flex items-baseline justify-between gap-4 px-4 py-2.5', row.tone === 'profit' && 'bg-emerald-50/70')}>
          <dt className="min-w-0 text-sm text-muted">
            {row.label}
            {row.hint ? <span className="block text-xs text-subtle">{row.hint}</span> : null}
          </dt>
          <dd
            className={cn(
              'shrink-0 text-right text-sm font-semibold tabular-nums',
              row.tone === 'profit' ? 'text-base text-emerald-700' : row.tone === 'warning' ? 'text-amber-700' : row.tone === 'muted' ? 'text-muted' : 'text-ink',
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
