/**
 * Money as `shopMoney` writes it, for the rules kept free of React Native (`src/shared` is not loaded under
 * `node --test`, so they cannot import it).
 */
export function money(minor: number, currency: string) {
  const value = minor / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  }
}
