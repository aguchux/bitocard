import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';

/**
 * Crypto amounts: decimal strings in requests and responses ("12.5", "0.00010000"), whole base units (bigint) in the
 * ledger and the database. Never through JavaScript numbers, which lose precision.
 */

const invalid = (param: string, decimals: number) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Enter a positive amount with at most ${decimals} decimal places.`, param);

/** "12.5" with 6 decimals is 12500000n. Refuses more places than the asset keeps, signs and exponents. */
export function toUnits(value: string, decimals: number, param = 'amount'): bigint {
  const text = value.trim();
  const match = /^(\d{1,20})(?:\.(\d+))?$/.exec(text);
  if (!match) throw invalid(param, decimals);
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) throw invalid(param, decimals);
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** 12500000n with 6 decimals is "12.500000": always every decimal place, so amounts line up. */
export function fromUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? `.${digits.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * The fiat for `amount` base units at `price` (fiat minor units per whole unit), rounded in the ad owner's favour:
 * up when they sell (the buyer pays the part of a minor unit), down when they buy. So a buy ad's locked fiat always
 * covers its fills.
 */
export function fiatFor(amount: bigint, price: bigint, decimals: number, roundUp: boolean): bigint {
  const scale = 10n ** BigInt(decimals);
  return roundUp ? divCeil(amount * price, scale) : (amount * price) / scale;
}

/** The most base units `fiat` buys at `price` (rounded down). */
export function unitsFor(fiat: bigint, price: bigint, decimals: number): bigint {
  return (fiat * 10n ** BigInt(decimals)) / price;
}

/** BitoCard's fee on a trade: basis points of the amount, rounded up to a base unit. */
export function feeFor(amount: bigint, bps: number): bigint {
  return bps > 0 ? divCeil(amount * BigInt(bps), 10_000n) : 0n;
}
