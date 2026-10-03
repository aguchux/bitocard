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

/** Hosted payment pages (card, bank, mobile money) for wallet top-ups. */
export interface CheckoutProvider {
  readonly name: string;
  supportsCheckout(country: string, currency: string): boolean;
  createCheckout(input: { reference: string; amount: bigint; currency: string; email: string; name: string; returnUrl: string; description: string }): Promise<{ checkoutUrl: string }>;
  /** Null when the provider has no transaction for the reference yet. */
  verifyByReference(reference: string): Promise<ChargeResult | null>;
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
