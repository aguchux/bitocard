import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { type AccountRef, LedgerService } from './ledger.service.js';
import { minor } from './mode.js';
import { InboxService } from '../notifications/inbox.service.js';

/** The startup allowance: US$500, granted once. */
export const startupAllowanceMinor = 50_000n;
const currency = 'USD';

const grantReference = (resellerId: string) => `allowance:grant:${resellerId}`;
const revokeReference = (resellerId: string) => `allowance:revoke:${resellerId}`;

/** The reseller's startup allowance, or null if it was never granted. */
export async function allowanceStatus(prisma: PrismaService, resellerId: string) {
  const [grant, revoke, account] = await Promise.all([
    prisma.journalEntry.findUnique({ where: { reference: grantReference(resellerId) } }),
    prisma.journalEntry.findUnique({ where: { reference: revokeReference(resellerId) } }),
    prisma.ledgerAccount.findFirst({ where: { resellerId, mode: 'live', currency, kind: 'reseller_allowance' } }),
  ]);
  if (!grant) return null;
  const remaining = account?.balanceMinor ?? 0n;
  return {
    currency,
    granted: minor(startupAllowanceMinor),
    remaining: minor(remaining),
    /** `active` while some remains; `used` once spent; `revoked` when an admin took back what remained. */
    status: revoke ? ('revoked' as const) : remaining > 0n ? ('active' as const) : ('used' as const),
    granted_at: grant.createdAt.toISOString(),
    revoked_at: revoke?.createdAt.toISOString() ?? null,
  };
}

/**
 * The $500 startup allowance (market-entry promotion). A one-time, restricted balance in its own ledger account
 * (`reseller_allowance`, USD) against BitoCard's promotions expense: never counted as cash, never withdrawn, transferred
 * or spent directly. It is meant to pay only the wholesale cost of customer-paid orders (through BitoCard's payment
 * channels, with hosted checkout) and does not refill.
 *
 * Granted once, to a verified reseller with the `startup_allowance` switch on (reseller, country or global), when their
 * identity check is approved or later by an admin. Admins can revoke what remains at any time. Live money only.
 */
@Injectable()
export class AllowanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  private accounts(resellerId: string): { allowance: AccountRef; promotions: AccountRef } {
    return { allowance: { kind: 'reseller_allowance', currency, resellerId }, promotions: { kind: 'promotions', currency } };
  }

  /** What the reseller has: null if never granted. */
  status(resellerId: string) {
    return allowanceStatus(this.prisma, resellerId);
  }

  /**
   * Grants the allowance if the reseller qualifies: verified, the switch on, never granted before. Returns whether it
   * was granted now. Safe to call repeatedly (the ledger reference makes it once only).
   */
  async grantIfEligible(resellerId: string, actorId: string | null = null) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (!reseller.verifiedAt || !(await this.settings.isOn('startup_allowance', resellerId))) return false;
    return this.post(resellerId, actorId);
  }

  /** Admin: grants it now (the reseller must be verified and the switch on). */
  async grant(actorId: string | null, resellerId: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId } });
    if (!reseller) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');
    if (!reseller.verifiedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', 'The reseller must pass the identity check first.');
    if (!(await this.settings.isOn('startup_allowance', resellerId))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'allowance_switched_off', 'Switch the startup allowance on for this reseller (or their country) first.');
    }
    if (!(await this.post(resellerId, actorId))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'allowance_already_granted', 'This reseller has already had the startup allowance. It is granted once only.');
    }
    return this.status(resellerId);
  }

  private async post(resellerId: string, actorId: string | null) {
    const { allowance, promotions } = this.accounts(resellerId);
    try {
      await this.ledger.post({
        mode: 'live',
        type: 'allowance_granted',
        reference: grantReference(resellerId),
        resellerId,
        description: 'Startup allowance granted',
        metadata: { actor_id: actorId },
        lines: [
          { account: promotions, debit: startupAllowanceMinor },
          { account: allowance, credit: startupAllowanceMinor },
        ],
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    await this.audit.record({ actorId, action: 'allowance.granted', targetType: 'reseller', targetId: resellerId, before: null, after: await this.status(resellerId) });
    await this.inbox.reseller(resellerId, 'startup_allowance.granted', {
      subject: resellerId,
      title: 'Startup allowance granted',
      body: 'You have a US$500 startup allowance towards the wholesale cost of customer-paid orders. It cannot be withdrawn and does not refill.',
      link: '/wallet',
      mode: 'live',
    });
    return true;
  }

  /** Admin: takes back what remains (it is never paid out). The allowance cannot be granted again afterwards. */
  async revoke(actorId: string | null, resellerId: string, reason: string) {
    const before = await this.status(resellerId);
    if (!before) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'allowance_not_granted', 'This reseller has no startup allowance.');
    if (before.status === 'revoked') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'allowance_already_revoked', 'The startup allowance was already revoked.');
    const { allowance, promotions } = this.accounts(resellerId);
    const remaining = BigInt(before.remaining);
    const prepared = await this.ledger.prepare({
      mode: 'live',
      type: 'allowance_revoked',
      reference: revokeReference(resellerId),
      resellerId,
      description: `Startup allowance revoked: ${reason}`,
      metadata: { actor_id: actorId, reason },
      // A zero entry still records the revocation, so a fully used allowance can be marked revoked too.
      lines: remaining > 0n ? [{ account: allowance, debit: remaining }, { account: promotions, credit: remaining }] : [],
    });
    await this.prisma.$transaction(tx => this.ledger.write(tx, prepared));
    const after = await this.status(resellerId);
    await this.audit.record({ actorId, action: 'allowance.revoked', targetType: 'reseller', targetId: resellerId, before, after: { ...after, reason } });
    await this.inbox.reseller(resellerId, 'startup_allowance.revoked', {
      subject: resellerId,
      title: 'Startup allowance revoked',
      body: `BitoCard revoked what remained of your startup allowance. Reason: ${reason}`,
      link: '/wallet',
      mode: 'live',
    });
    return after;
  }
}
