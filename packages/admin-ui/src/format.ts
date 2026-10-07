/** Joins class names, skipping empty ones. */
export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const digitsCache = new Map<string, number>();

/** Decimal places a currency uses (2 for NGN, GHS, KES, USD; 0 for currencies without minor units). */
export function currencyDigits(currency: string) {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitsCache.set(currency, digits);
  }
  return digits;
}

const compactUnits: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * Money from integer minor units, for example 1234567 NGN → "NGN 12,345.67" (code first, unambiguous across markets).
 * `compact` gives "NGN 2.5M". Its suffixes are fixed here because Intl's compact notation differs between ICU versions
 * (newer en-GB data says "2.5m"), which would differ between browsers and between the server and the browser.
 */
export function formatMoney(minor: number, currency: string, options: { compact?: boolean } = {}) {
  const digits = currencyDigits(currency);
  const major = minor / 10 ** digits;
  if (options.compact) {
    const [size, suffix] = compactUnits.find(([unit]) => Math.abs(major) >= unit) ?? [1, ''];
    const amount = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(major / size);
    return `${currency} ${amount}${suffix}`;
  }
  const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: digits, maximumFractionDigits: digits });
  return formatter.format(major).replace(/ /g, ' ');
}

export const formatNumber = (value: number) => new Intl.NumberFormat('en-GB').format(value);

/** Basis points as a percentage: 750 → "7.5%". */
export const formatBps = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;

const dateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');
export const formatShortDate = (iso: string) => shortDate.format(new Date(iso));

/** "3 minutes ago", "in 2 hours". */
export function formatRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return 'just now';
}

/** Change from the previous period, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** snake_case → "Sentence case". */
export const humanise = (value: string) => {
  const text = value.replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const categoryNames: Record<string, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data',
  bills: 'Bills',
  pay_tv: 'Pay-TV',
  esim: 'eSIM',
  software: 'Software',
  virtual_numbers: 'Virtual numbers',
  virtual_cards: 'Virtual cards',
  mobile_money: 'Mobile money',
};
export const categoryName = (category: string) => categoryNames[category] ?? humanise(category);

/** The message to show for a failed request (the API's own message when there is one). */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.') {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * A product's supplier offers, one entry per supplier: suppliers such as Zendit list one offer per face value, so a
 * product can have dozens from the same supplier. `zendit · 24 offers`, with the agreed discount when they all share it.
 */
export function summariseOffers(offers: ReadonlyArray<{ supplier: string; discount_bps: number }>) {
  const bySupplier = new Map<string, number[]>();
  for (const offer of offers) bySupplier.set(offer.supplier, [...(bySupplier.get(offer.supplier) ?? []), offer.discount_bps]);
  return [...bySupplier].map(([supplier, discounts]) => {
    const shared = discounts.every(bps => bps === discounts[0]) ? discounts[0] : 0;
    return [supplier, discounts.length > 1 ? ` · ${discounts.length} offers` : '', shared ? ` (${formatBps(shared)})` : ''].join('');
  });
}
