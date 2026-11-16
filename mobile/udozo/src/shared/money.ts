/**
 * Money as people read and type it, in every BitoCard app: the currency's own sign ("₦10,419.34", "GH₵50", "KSh 200",
 * "$10"), thousands separated by commas, and the currency's decimal places. Pure functions, no dependencies (the Udozo
 * app copies this file; see `mobile/udozo/scripts/sync-shared.mjs`).
 */

/** The sign each currency is written with. Letters-only signs ("KSh", "CFA") take a space before the amount. */
export const currencySymbols: Readonly<Record<string, string>> = {
  NGN: '₦',
  GHS: 'GH₵',
  KES: 'KSh',
  UGX: 'USh',
  TZS: 'TSh',
  RWF: 'FRw',
  ZMW: 'K',
  MZN: 'MT',
  SLE: 'Le',
  SLL: 'Le',
  CDF: 'FC',
  XOF: 'CFA',
  XAF: 'FCFA',
  ZAR: 'R',
  EGP: 'E£',
  MAD: 'DH',
  ETB: 'Br',
  BWP: 'P',
  MWK: 'MK',
  USD: '$',
  GBP: '£',
  EUR: '€',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
  CNY: 'CN¥',
  INR: '₹',
  AED: 'AED',
  BTC: '₿',
};

/** The currency's sign: its own where known, else the browser's narrow symbol, else the code itself. */
export function currencySymbol(currency: string) {
  const code = currency.toUpperCase();
  const known = currencySymbols[code];
  if (known) return known;
  try {
    const part = new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(item => item.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** Whether the sign is letters only, so the amount is written after a space ("KSh 200", "CFA 5,000"). */
const spaced = (symbol: string) => /^[A-Za-z]+$/.test(symbol) || /[A-Za-z]$/.test(symbol);

const digitsCache = new Map<string, number>();

/** Decimal places a currency uses (2 for NGN, GHS, KES, USD; 0 for UGX, RWF, XOF, XAF and others without minor units). */
export function currencyDigits(currency: string) {
  const code = currency.toUpperCase();
  let digits = digitsCache.get(code);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitsCache.set(code, digits);
  }
  return digits;
}

/** "10,419.34" from 10419.34: commas between thousands, at most `digits` decimals (`fixed`: exactly `digits`). */
export function groupDigits(major: number, digits: number, fixed = true) {
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: fixed ? digits : 0, maximumFractionDigits: digits }).format(major);
}

/** The sign written before an amount already formatted ("₦" + "1,000" → "₦1,000"; "KSh" → "KSh 1,000"). */
export function withSymbol(amount: string, currency: string) {
  const symbol = currencySymbol(currency);
  const negative = amount.startsWith('-') || amount.startsWith('−');
  const body = negative ? amount.slice(1) : amount;
  return `${negative ? '-' : ''}${symbol}${spaced(symbol) ? ' ' : ''}${body}`;
}

/**
 * Money from integer minor units with its sign: 1041934 NGN → "₦10,419.34". `trim` drops ".00" from whole amounts
 * ("₦5,000"), as prices are shown in the store.
 */
export function formatCurrency(minor: number, currency: string, options: { trim?: boolean } = {}) {
  const digits = currencyDigits(currency);
  const major = minor / 10 ** digits;
  const whole = minor % 10 ** digits === 0;
  return withSymbol(groupDigits(major, digits, !(options.trim && whole)), currency);
}

/**
 * What a money field shows while it is typed: only digits and one decimal point, at most `digits` decimals, commas
 * between thousands ("1234567.891" → "1,234,567.89"; "abc" → ""). A trailing point is kept so "12." can become "12.5".
 */
export function formatMoneyInput(text: string, digits: number) {
  const cleaned = text.replace(/[^\d.]/g, '');
  const point = cleaned.indexOf('.');
  let whole = point === -1 ? cleaned : cleaned.slice(0, point);
  const fraction = point === -1 ? null : cleaned.slice(point + 1).replace(/\./g, '').slice(0, digits);
  whole = whole.replace(/^0+(?=\d)/, '').slice(0, 13);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fraction === null || digits === 0) return grouped;
  return `${grouped || '0'}.${fraction}`;
}

/** Integer minor units from what was typed ("1,234.5" NGN → 123450), or null when it is not an amount. */
export function parseMoney(text: string, currency: string) {
  const digits = currencyDigits(currency);
  const match = /^(\d{1,13})(?:\.(\d*))?$/.exec(String(text).replace(/[,\s]/g, '').trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  return Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
}

/** What a money field shows for an amount in minor units ("₦" is beside it): 500000 NGN → "5,000.00". */
export function moneyInputValue(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  return groupDigits(minor / 10 ** digits, digits, minor % 10 ** digits !== 0);
}
