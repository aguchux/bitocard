import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';

/** Minor units (bigint) to a provider's decimal amount. All pilot currencies and USD use two decimal places. */
export function toMajor(amount: bigint) {
  const sign = amount < 0n ? '-' : '';
  const abs = amount < 0n ? -amount : amount;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** A provider's decimal amount to minor units. */
export function fromMajor(amount: number | string | null | undefined) {
  return BigInt(new Prisma.Decimal(amount ?? 0).mul(100).toDecimalPlaces(0).toFixed(0));
}

export type ChargeResult = {
  status: 'succeeded' | 'failed' | 'pending';
  /** The provider's ID for the transaction. */
  providerTransactionId: string;
  /** Our reference (tx_ref), or the reserved account reference for bank transfers. */
  reference: string;
  amount: bigint;
  currency: string;
  /** What the provider charged BitoCard for it. */
  fee: bigint;
  failureReason?: string;
};

export type CheckoutInput = {
  reference: string;
  amount: bigint;
  currency: string;
  /** The payer's country (ISO alpha-2). */
  country: string;
  email: string;
  name: string;
  returnUrl: string;
  description: string;
};

export type RefundResult = { status: 'refunded' | 'pending' | 'failed'; providerRefundId: string; failureReason?: string };

/** What a payment record gives a provider to look it up or refund it. */
export type PaymentRef = { reference: string; providerTransactionId: string | null; amount: bigint; currency: string };

/** Hosted payment pages (card, bank, mobile money) for wallet top-ups and customer checkout. */
export interface CheckoutProvider {
  readonly name: string;
  /** Whether it takes payments from this country in this currency (pawaPay asks its API, so this may be async). */
  supportsCheckout(country: string, currency: string): boolean | Promise<boolean>;
  /**
   * Where the gateway cannot take a currency (it refuses with `currency_unsupported`, or `takesCurrency` says so), the
   * payment is charged in this one instead, converted at the rate that never leaves BitoCard short.
   */
  readonly fallbackCurrency?: string;
  /** False once the gateway has refused this currency. */
  takesCurrency?(currency: string): boolean;
  /**
   * Opens a payment page. `providerTransactionId` is the provider's own ID for it when the provider gives one up front
   * (Stripe's session, pawaPay's deposit, Monnify's transaction), stored so checks and notifications find the payment.
   */
  createCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string; providerTransactionId?: string }>;
  /** Null when the provider has no transaction for it yet (the payer has not paid). */
  verify(payment: PaymentRef): Promise<ChargeResult | null>;
  /** Returns a confirmed payment to the payer, in full. Repeating it with the same refund reference is safe. */
  refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult>;
  /** A refund sent earlier: has it reached the payer? */
  refundStatus(payment: PaymentRef & { refundReference: string; providerRefundId: string }): Promise<RefundResult>;
}

/**
 * A UUIDv4 made from one of our references (pawaPay wants UUIDs for its deposit, payout and refund IDs), so a repeat
 * or a check always names the same transaction.
 */
export function uuidFor(kind: string, reference: string) {
  const hex = createHash('sha256').update(`bitocard-${kind}:${reference}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type ReservedAccountDetails = { bankName: string; accountNumber: string; accountName: string };

/** Dedicated bank account numbers; transfers into them top up the wallet. */
export interface ReservedAccountProvider {
  readonly name: string;
  supportsReservedAccounts(country: string, currency: string): boolean;
  createReservedAccount(input: { reference: string; email: string; name: string; currency: string; bvn?: string }): Promise<ReservedAccountDetails[]>;
}

export type TransferResult = { status: 'paid' | 'failed' | 'pending'; providerTransferId: string; fee: bigint; failureReason?: string; reference?: string };

/** Bank payouts. */
export interface TransferProvider {
  readonly name: string;
  supportsTransfers(country: string, currency: string): boolean;
  listBanks(country: string): Promise<Array<{ code: string; name: string }>>;
  /** The account holder's name as the bank has it. */
  resolveAccount(input: { country: string; bankCode: string; accountNumber: string }): Promise<{ accountName: string }>;
  transfer(input: { reference: string; bankCode: string; accountNumber: string; amount: bigint; currency: string; narration: string }): Promise<TransferResult>;
  transferStatus(providerTransferId: string): Promise<TransferResult>;
}
