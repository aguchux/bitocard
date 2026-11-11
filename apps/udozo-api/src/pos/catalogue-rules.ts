import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';

/**
 * Udozo POS's catalogue rules (docs/UDOZO_POS_PLAN.md, milestone 2), pure so listings and the POS share them: what a
 * barcode may be, which listings count towards a plan's product limit, and whether one sells at the till.
 */

/** Listings ticked Sell at POS that count towards the plan's product limit: every one not sold, removed or deleted. */
export const posCountedStatuses = ['draft', 'pending_review', 'active', 'rejected', 'expired'];

const invalidBarcode = (message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'barcode_invalid', message, 'barcode');

/** Whether a GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) has the right check digit. */
export function gtinValid(digits: string) {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = 0; index < body.length; index++) sum += Number(body[body.length - 1 - index]) * (index % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/**
 * A barcode as the till will compare it: trimmed, 3 to 48 printable characters without spaces (what scanners type), and
 * an EAN or UPC with its check digit right, so a mistyped one is caught. Empty is none.
 */
export function cleanBarcode(raw: string | null): string | null {
  if (raw === null) return null;
  const code = raw.trim();
  if (!code) return null;
  if (!/^[\x21-\x7E]{3,48}$/.test(code)) throw invalidBarcode('A barcode is 3 to 48 letters, digits or symbols, without spaces.');
  if (/^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length) && !gtinValid(code)) throw invalidBarcode('This barcode’s last digit does not match the rest: check it was typed right.');
  return code;
}

export type PosSellable = { status: string; priceKind: string; priceMinor: bigint | null; saleMethod: string };

/** Why a listing ticked Sell at POS cannot be sold at the till now, or null when it can (stock apart). */
export function tillBlock(listing: PosSellable, withinPlan: boolean): 'plan_limit' | 'not_live' | 'no_price' | null {
  if (listing.status !== 'active') return 'not_live';
  if (listing.priceKind === 'on_request' || listing.priceMinor === null) return 'no_price';
  if (!withinPlan) return 'plan_limit';
  return null;
}
