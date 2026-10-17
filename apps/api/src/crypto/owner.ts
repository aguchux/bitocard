import type { AccountKind } from '../generated/prisma/client.js';
import type { AccountRef } from '../ledger/ledger.service.js';

/**
 * Whose coins an on-chain address, deposit or withdrawal is: a store customer's (`crypto_wallet`) or, for Premium
 * resellers, the reseller's own coin wallet (`reseller_crypto`, the one they trade with BitoCard from). Every row has
 * exactly one (a database check), so the chain scan, crediting, sending and the custody check serve both alike.
 */
export type CoinOwner = { customerId: string; resellerId?: undefined } | { resellerId: string; customerId?: undefined };

export function ownerOf(row: { customerId: string | null; resellerId: string | null }): CoinOwner {
  if (row.resellerId) return { resellerId: row.resellerId };
  if (row.customerId) return { customerId: row.customerId };
  throw new Error('An on-chain row has no owner');
}

/** The owner as a Prisma filter (and the owner columns of a new row). */
export function ownerWhere(owner: CoinOwner): { customerId: string } | { resellerId: string } {
  return owner.resellerId ? { resellerId: owner.resellerId } : { customerId: owner.customerId! };
}

/** The ledger account the owner's spendable coins are in. */
export function coinWalletRef(owner: CoinOwner, asset: string): AccountRef & { kind: AccountKind } {
  return owner.resellerId ? { kind: 'reseller_crypto', resellerId: owner.resellerId, currency: asset } : { kind: 'crypto_wallet', customerId: owner.customerId, currency: asset };
}

/** The ledger account a withdrawal holds the owner's coins in until it is sent or returned. */
export function withdrawingRef(owner: CoinOwner, asset: string): AccountRef & { kind: AccountKind } {
  return owner.resellerId
    ? { kind: 'reseller_crypto_withdrawing', resellerId: owner.resellerId, currency: asset }
    : { kind: 'crypto_withdrawing', customerId: owner.customerId, currency: asset };
}
