import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { cashChange } from './money.js';

/**
 * Udozo POS's sale rules (docs/UDOZO_POS_PLAN.md, milestone 3), pure so the API and the tests agree: how a sale may be
 * paid and how its number is written. Every method is recorded only: cash at the counter, a bank transfer to the shop's
 * own account, a card on the shop's own terminal, or other. No money moves through Udozo.
 */

export const posPaymentMethods = ['cash', 'transfer', 'card', 'other'] as const;
export type PosPaymentMethod = (typeof posPaymentMethods)[number];

/** What one sale may hold. */
export const maxSaleLines = 100;
export const maxLineQuantity = 10_000;
export const maxSalePayments = 5;

/** Stock changes the owner makes from the POS, beside sales and refunds. */
export const stockAdjustments = ['restock', 'count', 'damage'] as const;
export type StockAdjustment = (typeof stockAdjustments)[number];

export type PaymentInput = { method: PosPaymentMethod; amount: bigint; tendered?: bigint | null; reference?: string | null };
export type CheckedPayment = { method: PosPaymentMethod; amount: bigint; tendered: bigint | null; change: bigint; reference: string | null };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/**
 * Checks how a sale is paid: one to five payments, each more than nothing, adding up to exactly the total (a split sale
 * is paid in parts). Cash may be handed over above its part; the rest is change. Only cash has change.
 */
export function checkPayments(payments: readonly PaymentInput[], total: bigint): { payments: CheckedPayment[]; change: bigint } {
  if (total === 0n && payments.length === 0) return { payments: [], change: 0n };
  if (!payments.length || payments.length > maxSalePayments) throw invalid('parameter_invalid', `Record how it was paid, in up to ${maxSalePayments} parts.`, 'payments');
  let sum = 0n;
  let change = 0n;
  const checked = payments.map((payment, index) => {
    const param = `payments[${index}]`;
    if (!(posPaymentMethods as readonly string[]).includes(payment.method)) throw invalid('parameter_invalid', 'Choose cash, transfer, card or other.', `${param}.method`);
    if (payment.amount <= 0n) throw invalid('parameter_invalid', 'Each part paid must be more than nothing.', `${param}.amount`);
    sum += payment.amount;
    let tendered: bigint | null = null;
    let given = 0n;
    if (payment.tendered !== undefined && payment.tendered !== null) {
      if (payment.method !== 'cash') throw invalid('parameter_invalid', 'Only cash is handed over with change.', `${param}.tendered`);
      const back = cashChange(payment.amount, payment.tendered);
      if (back === null) throw invalid('cash_short', 'The cash handed over does not cover its part.', `${param}.tendered`);
      tendered = payment.tendered;
      given = back;
      change += back;
    }
    const reference = payment.reference?.trim() ? payment.reference.trim().slice(0, 80) : null;
    return { method: payment.method, amount: payment.amount, tendered, change: given, reference };
  });
  if (sum !== total) throw invalid('payments_mismatch', sum < total ? 'The payments do not cover the total yet.' : 'The payments add up to more than the total.', 'payments');
  return { payments: checked, change };
}

/** A shop's sale number: POS-000123. */
export function saleNumber(n: number) {
  return `POS-${String(n).padStart(6, '0')}`;
}

/**
 * A listing's stock after an adjustment: a restock adds, damage takes away, a count sets it. Never below what online
 * buyers hold, nor above the most a listing holds.
 */
export function adjustedStock(current: number, kind: StockAdjustment, quantity: number, held: number, max: number) {
  const next = kind === 'restock' ? current + quantity : kind === 'damage' ? current - quantity : quantity;
  if (next < held) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'stock_below_held', held === 0 ? 'Stock cannot go below nothing.' : `Online buyers hold ${held}: stock cannot go below that.`, 'quantity');
  if (next > max) throw invalid('parameter_invalid', `A listing holds at most ${max.toLocaleString('en-GB')}.`, 'quantity');
  return next;
}
