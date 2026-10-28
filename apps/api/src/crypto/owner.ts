import type { AccountKind } from '../generated/prisma/client.js';
import type { AccountRef } from '../ledger/ledger.service.js';

/**
 * Whose coins an on-chain address, deposit or withdrawal is: a customer's (Afrippa's traders; resellers' own coins were
 * retired, docs/CRYPTO_SPINOFF_PLAN.md step 3 item 8).
 */
export type CoinOwner = { customerId: string };

export function ownerOf(row: { customerId: string }): CoinOwner {
  return { customerId: row.customerId };
}

/** The owner as a Prisma filter (and the owner column of a new row). */
export function ownerWhere(owner: CoinOwner): { customerId: string } {
  return { customerId: owner.customerId };
}

/** The ledger account the owner's spendable coins are in. */
export function coinWalletRef(owner: CoinOwner, asset: string): AccountRef & { kind: AccountKind } {
  return { kind: 'crypto_wallet', customerId: owner.customerId, currency: asset };
}

/** The ledger account a withdrawal holds the owner's coins in until it is sent or returned. */
export function withdrawingRef(owner: CoinOwner, asset: string): AccountRef & { kind: AccountKind } {
  return { kind: 'crypto_withdrawing', customerId: owner.customerId, currency: asset };
}
