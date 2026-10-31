import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import { P2pStandingService } from '../crypto/p2p-standing.service.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, P2pMerchant, P2pMerchantRule } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { afrippaOperatorId } from './ids.js';
import { everywhere } from './two-step.service.js';

export const merchantStatuses = ['applied', 'active', 'rejected', 'suspended', 'revoked'] as const;
export type MerchantStatus = (typeof merchantStatuses)[number];
export type MerchantRuleInput = { min_orders: number; min_completion_bps: number; window_days: number; min_account_days: number };

const day = 86_400_000;
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such merchant application.', 'id');
const percent = (bps: number) => `${bps % 100 === 0 ? bps / 100 : (bps / 100).toFixed(1)}%`;

/** One thing a trader needs to be a merchant: what it is, what is needed, where they stand and whether it is met. */
export type Requirement = { key: 'orders' | 'completion' | 'account_age' | 'strikes' | 'identity'; label: string; needed: string; value: string; met: boolean };

function presentRule(row: P2pMerchantRule) {
  return {
    object: 'p2p_merchant_rule' as const,
    market: row.market,
    min_orders: row.minOrders,
    min_completion_bps: row.minCompletionBps,
    window_days: row.windowDays,
    min_account_days: row.minAccountDays,
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Afrippa's merchants (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 6): traders who meet the thresholds for their market
 * (released orders, completion over a window, account age, no current strikes; live, an identity check) apply, and
 * Afrippa's operations approve or reject. An active merchant has a badge on their ads and card, a filter of their own
 * in the book and the market's merchant limits. A strike suspends the status at once, and so does falling below the
 * thresholds at the daily check (`check`); operations can revoke it. Suspended, rejected or revoked traders apply again.
 */
@Injectable()
export class P2pMerchantsService {
  private readonly logger = new Logger('P2pMerchants');

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
    private readonly standing: P2pStandingService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {
    standing.onStrike((customerId, mode) => this.suspend(customerId, mode, 'strike'));
  }

  // -- Rules ---------------------------------------------------------------------------------------------------

  async rules() {
    const rows = await this.prisma.p2pMerchantRule.findMany({ orderBy: { market: 'asc' } });
    return { object: 'list' as const, data: rows.sort((a, b) => (a.market === everywhere ? -1 : b.market === everywhere ? 1 : 0)).map(presentRule) };
  }

  /** Sets the thresholds for all of Afrippa (`WW`) or one market. Audited in Afrippa's trail. */
  async setRule(adminId: string | null, marketCode: string, input: MerchantRuleInput) {
    const market = marketCode.toUpperCase();
    if (market !== everywhere && !(await this.prisma.country.findUnique({ where: { code: market }, select: { code: true } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose a market, or WW for all of Afrippa.', 'market');
    }
    const data = { minOrders: input.min_orders, minCompletionBps: input.min_completion_bps, windowDays: input.window_days, minAccountDays: input.min_account_days, updatedById: adminId };
    const before = await this.prisma.p2pMerchantRule.findUnique({ where: { market } });
    const row = await this.prisma.p2pMerchantRule.upsert({ where: { market }, create: { market, ...data }, update: data });
    await this.audit.record({ actorId: adminId, action: 'p2p_merchant_rule.set', targetType: 'p2p_merchant_rule', targetId: market, before: before && presentRule(before), after: presentRule(row), platform: 'afrippa' });
    return presentRule(row);
  }

  /** Removes a market's own thresholds (it follows all of Afrippa's again); all of Afrippa's stay. */
  async removeRule(adminId: string | null, marketCode: string) {
    const market = marketCode.toUpperCase();
    if (market === everywhere) throw conflict('rule_required', "All of Afrippa's thresholds can be changed but not removed.", 'market');
    const before = await this.prisma.p2pMerchantRule.findUnique({ where: { market } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No thresholds for that market.', 'market');
    await this.prisma.p2pMerchantRule.delete({ where: { market } });
    await this.audit.record({ actorId: adminId, action: 'p2p_merchant_rule.removed', targetType: 'p2p_merchant_rule', targetId: market, before: presentRule(before), platform: 'afrippa' });
    return { object: 'p2p_merchant_rule' as const, market, deleted: true };
  }

  private async ruleFor(country: string | null) {
    return (country ? await this.prisma.p2pMerchantRule.findUnique({ where: { market: country } }) : null) ?? (await this.prisma.p2pMerchantRule.findUniqueOrThrow({ where: { market: everywhere } }));
  }

  // -- Eligibility ---------------------------------------------------------------------------------------------

  /** Where a trader stands against their market's thresholds, requirement by requirement. */
  async requirements(customer: { id: string; country: string | null; createdAt: Date }, mode: LedgerMode): Promise<Requirement[]> {
    const rule = await this.ruleFor(customer.country);
    const since = new Date(Date.now() - rule.windowDays * day);
    const party = { OR: [{ buyerId: customer.id }, { sellerId: customer.id }] };
    const [released, recent, failed, standing, verified] = await Promise.all([
      this.prisma.p2pOrder.count({ where: { mode, status: 'released', ...party } }),
      this.prisma.p2pOrder.count({ where: { mode, status: 'released', closedAt: { gt: since }, ...party } }),
      // Failed, as for the trust figures: cancelled or let expire as the buyer, or an appeal lost.
      this.prisma.p2pOrder.count({ where: { mode, closedAt: { gt: since }, OR: [{ buyerId: customer.id, OR: [{ status: 'cancelled' }, { decisionFault: 'buyer' }] }, { sellerId: customer.id, decisionFault: 'seller' }] } }),
      this.standing.standing(customer.id, mode),
      mode === 'live' ? this.identity.customerVerifiedName(afrippaOperatorId, 'live', customer.id) : Promise.resolve('sandbox'),
    ]);
    const completionBps = recent + failed ? Math.floor((recent / (recent + failed)) * 10000) : 0;
    const accountDays = Math.floor((Date.now() - customer.createdAt.getTime()) / day);
    const blocked = standing.strikes > 0 || standing.restriction?.code === 'trading_suspended' || standing.restriction?.code === 'cool_off';
    const list: Requirement[] = [
      { key: 'orders', label: 'Completed orders', needed: `${rule.minOrders}`, value: `${released}`, met: released >= rule.minOrders },
      {
        key: 'completion',
        label: `Completion rate over ${rule.windowDays} days`,
        needed: percent(rule.minCompletionBps),
        value: recent + failed ? percent(completionBps) : 'No orders yet',
        met: recent + failed > 0 && completionBps >= rule.minCompletionBps,
      },
      { key: 'account_age', label: 'Account age', needed: `${rule.minAccountDays} days`, value: `${accountDays} days`, met: accountDays >= rule.minAccountDays },
      { key: 'strikes', label: 'No current strikes', needed: '0', value: `${standing.strikes}`, met: !blocked },
    ];
    if (mode === 'live') list.push({ key: 'identity', label: 'Identity checked', needed: 'Checked', value: verified ? 'Checked' : 'Not checked', met: Boolean(verified) });
    return list;
  }

  private mode(customer: CustomerWithStore): LedgerMode {
    return this.stores.mode(customer.store);
  }

  /** The trader's own status and where they stand. */
  async mine(customer: CustomerWithStore) {
    const mode = this.mode(customer);
    const [row, requirements] = await Promise.all([this.prisma.p2pMerchant.findUnique({ where: { customerId_mode: { customerId: customer.id, mode } } }), this.requirements(customer, mode)]);
    return {
      object: 'p2p_merchant_status' as const,
      mode,
      status: (row?.status ?? 'none') as MerchantStatus | 'none',
      applied_at: row?.appliedAt.toISOString() ?? null,
      decided_at: row?.decidedAt?.toISOString() ?? null,
      /** Operations' reason for a rejection or a revocation (never an approval's internal note). */
      reason: row && (row.status === 'rejected' || row.status === 'revoked') ? row.note : null,
      suspended_reason: row?.status === 'suspended' ? row.suspendedReason : null,
      eligible: requirements.every(item => item.met),
      requirements,
    };
  }

  /** Applies: every requirement met, not already a merchant or waiting. Afrippa's operations are told. */
  async apply(customer: CustomerWithStore) {
    const mode = this.mode(customer);
    const existing = await this.prisma.p2pMerchant.findUnique({ where: { customerId_mode: { customerId: customer.id, mode } } });
    if (existing?.status === 'active') throw conflict('merchant_active', 'You are already a merchant.');
    if (existing?.status === 'applied') throw conflict('merchant_applied', 'Your application is with Afrippa’s team.');
    const requirements = await this.requirements(customer, mode);
    const missing = requirements.filter(item => !item.met);
    if (missing.length) throw conflict('merchant_not_eligible', `Not yet: ${missing.map(item => item.label.toLowerCase()).join(', ')}.`);
    const data = { status: 'applied', appliedAt: new Date(), decidedAt: null, decidedById: null, note: null, suspendedReason: null };
    await this.prisma.p2pMerchant.upsert({ where: { customerId_mode: { customerId: customer.id, mode } }, create: { customerId: customer.id, mode, ...data }, update: data });
    await this.inbox.afrippaAdmins('admin.p2p.merchant_applied', {
      subject: `merchant:${customer.id}:${mode}:${Date.now()}`,
      title: 'A trader applied to be a merchant',
      body: 'Review their figures and approve or reject the application.',
      link: '/traders/merchants',
      mode,
    });
    return this.mine(customer);
  }

  // -- Afrippa's operations ------------------------------------------------------------------------------------

  async adminList(query: { status?: MerchantStatus; mode?: LedgerMode }) {
    const rows = await this.prisma.p2pMerchant.findMany({
      where: { ...(query.status ? { status: query.status } : {}), ...(query.mode ? { mode: query.mode } : {}) },
      orderBy: [{ appliedAt: 'asc' }],
      take: 200,
      include: { customer: { select: { id: true, email: true, name: true, country: true, createdAt: true, p2pProfile: { select: { nickname: true } } } } },
    });
    return { object: 'list' as const, data: await Promise.all(rows.map(async row => this.presentAdmin(row, row.customer))) };
  }

  private async presentAdmin(row: P2pMerchant, customer: { id: string; email: string; name: string; country: string | null; createdAt: Date; p2pProfile: { nickname: string } | null }) {
    return {
      object: 'p2p_merchant' as const,
      id: row.id,
      mode: row.mode,
      status: row.status as MerchantStatus,
      customer: { id: customer.id, email: customer.email, name: customer.name, country: customer.country, nickname: customer.p2pProfile?.nickname ?? null },
      applied_at: row.appliedAt.toISOString(),
      decided_at: row.decidedAt?.toISOString() ?? null,
      note: row.note,
      suspended_reason: row.suspendedReason,
      requirements: await this.requirements(customer, row.mode),
    };
  }

  private async load(id: string) {
    const row = await this.prisma.p2pMerchant.findUnique({ where: { id }, include: { customer: { select: { id: true, email: true, name: true, country: true, createdAt: true, storeId: true, p2pProfile: { select: { nickname: true } } } } } });
    if (!row) throw notFound();
    return row;
  }

  /** Approves or rejects an application (only one waiting: claimed on its status, so twice is refused). Audited. */
  async decide(adminId: string | null, id: string, outcome: 'approve' | 'reject', note: string) {
    const status = outcome === 'approve' ? 'active' : 'rejected';
    const claimed = await this.prisma.p2pMerchant.updateMany({ where: { id, status: 'applied' }, data: { status, decidedAt: new Date(), decidedById: adminId, note: note.trim(), suspendedReason: null } });
    const row = await this.load(id);
    if (claimed.count === 0) throw conflict('merchant_not_applied', 'Only a waiting application can be decided.');
    await this.audit.record({ actorId: adminId, action: `p2p_merchant.${outcome === 'approve' ? 'approved' : 'rejected'}`, targetType: 'customer', targetId: row.customerId, after: { mode: row.mode, note: note.trim() }, platform: 'afrippa' });
    await this.tell(row.customerId, row.customer.storeId, row.mode, outcome === 'approve' ? 'You are now an Afrippa merchant' : 'Your merchant application was not approved', outcome === 'approve' ? 'Your ads show the merchant badge, and the market’s merchant limits apply to you.' : note.trim());
    return this.presentAdmin(row, row.customer);
  }

  /** Revokes an active or suspended merchant, with a reason the trader sees. Audited. */
  async revoke(adminId: string | null, id: string, reason: string) {
    const claimed = await this.prisma.p2pMerchant.updateMany({ where: { id, status: { in: ['active', 'suspended'] } }, data: { status: 'revoked', decidedAt: new Date(), decidedById: adminId, note: reason.trim() } });
    const row = await this.load(id);
    if (claimed.count === 0) throw conflict('merchant_not_active', 'Only an active or suspended merchant can be revoked.');
    await this.audit.record({ actorId: adminId, action: 'p2p_merchant.revoked', targetType: 'customer', targetId: row.customerId, after: { mode: row.mode, reason: reason.trim() }, platform: 'afrippa' });
    await this.tell(row.customerId, row.customer.storeId, row.mode, 'Your merchant status was revoked', reason.trim());
    return this.presentAdmin(row, row.customer);
  }

  /** Suspends an active merchant (a strike, or below the thresholds); they apply again once they qualify. */
  async suspend(customerId: string, mode: LedgerMode, reason: 'strike' | 'thresholds') {
    const claimed = await this.prisma.p2pMerchant.updateMany({ where: { customerId, mode, status: 'active' }, data: { status: 'suspended', suspendedReason: reason } });
    if (claimed.count === 0) return false;
    await this.audit.record({ actorId: null, action: 'p2p_merchant.suspended', targetType: 'customer', targetId: customerId, after: { mode, reason }, platform: 'afrippa' });
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { storeId: true } });
    if (customer) {
      await this.tell(
        customerId,
        customer.storeId,
        mode,
        'Your merchant status is suspended',
        reason === 'strike' ? 'A strike suspends merchant status. Apply again once you meet every requirement.' : 'You no longer meet every merchant requirement. Apply again once you do.',
      );
    }
    return true;
  }

  /** The daily check: active merchants who no longer meet their market's thresholds are suspended. */
  async check() {
    const active = await this.prisma.p2pMerchant.findMany({ where: { status: 'active' }, include: { customer: { select: { id: true, country: true, createdAt: true } } }, take: 1000 });
    let suspended = 0;
    for (const row of active) {
      try {
        const requirements = await this.requirements(row.customer, row.mode);
        if (!requirements.every(item => item.met) && (await this.suspend(row.customerId, row.mode, 'thresholds'))) suspended += 1;
      } catch (error) {
        this.logger.error({ err: error, merchant: row.id }, 'Could not check a merchant');
      }
    }
    return { checked: active.length, suspended };
  }

  private tell(customerId: string, storeId: string, mode: LedgerMode, title: string, body: string) {
    return this.inbox.customer({ customerId, storeId }, 'customer.p2p.merchant_changed', { subject: `merchant:${customerId}:${mode}:${Date.now()}`, title, body, link: '/trust', mode });
  }
}
