/**
 * Money as the API sends it: integer minor units with a currency. Shown with the currency's own symbol where the
 * phone knows it (₦, GH₵, KSh), never as a floating-point sum. Free of React Native, so it runs under `node --test`.
 */

/** Currencies with no minor unit (the API counts them in whole units). */
const wholeCurrencies = new Set(['XOF', 'XAF', 'RWF', 'UGX', 'KRW', 'JPY']);

export const digitsOf = (currency: string) => (wholeCurrencies.has(currency.toUpperCase()) ? 0 : 2);

const symbols: Record<string, string> = { NGN: '₦', GHS: 'GH₵', KES: 'KSh ', USD: '$', GBP: '£', EUR: '€' };

/** `formatMoney(4825000, 'NGN')` is `₦48,250.00`; `{ cents: false }` drops a zero minor part (`₦48,250`). */
export function formatMoney(minor: number, currency: string, options: { cents?: boolean } = {}) {
  const code = currency.toUpperCase();
  const digits = digitsOf(code);
  const negative = minor < 0;
  const whole = Math.trunc(Math.abs(minor) / 10 ** digits);
  const part = Math.abs(minor) % 10 ** digits;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showPart = digits > 0 && (options.cents !== false || part !== 0);
  const amount = showPart ? `${grouped}.${part.toString().padStart(digits, '0')}` : grouped;
  const symbol = symbols[code];
  return `${negative ? '−' : ''}${symbol ? `${symbol}${amount}` : `${amount} ${code}`}`;
}

/** What the customer typed (`5,000`, `12.50`) as minor units of the currency; null when it is not an amount. */
export function toMinor(text: string, currency: string) {
  const cleaned = text.replace(/[,\s]/g, '');
  const digits = digitsOf(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(String.raw`^\d+(\.\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) return null;
  const [whole, part = ''] = cleaned.split('.');
  const minor = Number(whole) * 10 ** digits + Number(part.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * Whether a money step's Idempotency-Key is kept for the next tap: kept when the outcome is unclear (no answer, the
 * API failing), so trying again can never pay twice; dropped once the API answered and refused.
 */
export function keepKey(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return typeof status !== 'number' || status === 0 || status >= 500;
}
