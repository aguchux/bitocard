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
