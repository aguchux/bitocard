import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';

/** Appeals decided against a trader within `strikeWindowDays` that pause their trading. */
export const strikeLimit = 3;
export const strikeWindowDays = 90;
/** No new trading for this long after an appeal decided against them. */
export const coolOffHours = 24;
/** Orders a buyer may cancel or let expire within a day before they cannot open more for a day. */
export const cancellationLimit = 3;

const day = 86_400_000;

/** What stops a trader now: paused, cooling off, or too many cancellations (opening orders as a buyer only). */
export type Restriction = { code: 'trading_suspended' | 'cool_off' | 'too_many_cancellations'; until: Date | null; message: string };

/**
 * Afrippa traders' standing (docs/CRYPTO_SPINOFF_PLAN.md, step 3): worked out from their orders, never stored as a
 * counter that could drift.
 * - **Strikes:** appeals Afrippa's operations decided against them (`decision_fault` naming their side) in the last
 *   90 days, since operations last cleared them. At `strikeLimit` their trading is paused (`trading_suspended`): no
 *   new orders or ads, and their ads leave the market, until operations clear it.
 * - **Cool-off:** for 24 hours after any appeal decided against them, the same (`cool_off`).
 * - **Cancellations:** a buyer who cancelled or let expire `cancellationLimit` orders within a day cannot open another
 *   as the buyer until a day after the first of them (`too_many_cancellations`).
 */
@Injectable()
export class P2pStandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  private async clearedAt(customerId: string, mode: LedgerMode) {
    return (await this.prisma.p2pStanding.findUnique({ where: { customerId_mode: { customerId, mode } } }))?.clearedAt ?? null;
  }

  /** Appeals decided against the trader since the window began (and since they were last cleared), newest first. */
  private async lostAppeals(customerId: string, mode: LedgerMode) {
    const cleared = await this.clearedAt(customerId, mode);
    const windowStart = new Date(Date.now() - strikeWindowDays * day);
    const since = cleared && cleared > windowStart ? cleared : windowStart;
    return this.prisma.p2pOrder.findMany({
      where: { mode, closedAt: { gt: since }, OR: [{ buyerId: customerId, decisionFault: 'buyer' }, { sellerId: customerId, decisionFault: 'seller' }] },
      orderBy: { closedAt: 'desc' },
      select: { id: true, number: true, closedAt: true },
    });
  }

  /** Orders the trader, as the buyer, cancelled or let expire in the last day, oldest first. */
  private async recentCancellations(customerId: string, mode: LedgerMode) {
    return this.prisma.p2pOrder.findMany({
      where: { mode, buyerId: customerId, status: 'cancelled', closedAt: { gt: new Date(Date.now() - day) } },
      orderBy: { closedAt: 'asc' },
      select: { closedAt: true },
    });
  }

  /** What stops the trader now, if anything. `buying`: they would open an order as the buyer. */
  async restriction(customerId: string, mode: LedgerMode, options: { buying?: boolean } = {}): Promise<Restriction | null> {
    const strikes = await this.lostAppeals(customerId, mode);
    if (strikes.length >= strikeLimit) {
      return { code: 'trading_suspended', until: null, message: "Your trading is paused after appeals were decided against you. Contact Afrippa's team." };
    }
    const latest = strikes[0]?.closedAt;
    if (latest && latest.getTime() + coolOffHours * 3_600_000 > Date.now()) {
      const until = new Date(latest.getTime() + coolOffHours * 3_600_000);
      return { code: 'cool_off', until, message: `An appeal was decided against you. You can trade again from ${until.toUTCString()}.` };
    }
    if (options.buying) {
      const cancelled = await this.recentCancellations(customerId, mode);
      if (cancelled.length >= cancellationLimit) {
        const until = new Date(cancelled[0]!.closedAt!.getTime() + day);
        return { code: 'too_many_cancellations', until, message: `You cancelled or let expire ${cancellationLimit} orders in a day. You can open orders again from ${until.toUTCString()}.` };
      }
    }
    return null;
  }

  /** Refuses with the trader's restriction, if any. */
  async require(customerId: string, mode: LedgerMode, options: { buying?: boolean } = {}) {
    const restriction = await this.restriction(customerId, mode, options);
    if (!restriction) return;
    const status = restriction.code === 'trading_suspended' ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT;
    throw new ApiError(status, status === HttpStatus.FORBIDDEN ? 'permission_error' : 'conflict_error', restriction.code, restriction.message);
  }

  /** The trader's standing: their strikes, recent cancellations and what (if anything) stops them now. */
  async standing(customerId: string, mode: LedgerMode) {
    const [strikes, cancelled, restriction, cleared] = await Promise.all([
      this.lostAppeals(customerId, mode),
      this.recentCancellations(customerId, mode),
      this.restriction(customerId, mode, { buying: true }),
      this.prisma.p2pStanding.findUnique({ where: { customerId_mode: { customerId, mode } } }),
    ]);
    return {
      object: 'p2p_standing' as const,
      mode,
      strikes: strikes.length,
      strike_limit: strikeLimit,
      strike_window_days: strikeWindowDays,
      cancellations_today: cancelled.length,
      cancellation_limit: cancellationLimit,
      restriction: restriction && { code: restriction.code, until: restriction.until?.toISOString() ?? null, message: restriction.message },
      lost_appeals: strikes.map(order => ({ order_id: order.id, number: `ORD-${String(order.number).padStart(6, '0')}`, decided_at: order.closedAt!.toISOString() })),
      cleared_at: cleared?.clearedAt?.toISOString() ?? null,
    };
  }

  /** After an appeal decided against a trader: tells them once when it pauses their trading. */
  async afterStrike(customerId: string, mode: LedgerMode) {
    const restriction = await this.restriction(customerId, mode);
    if (restriction?.code !== 'trading_suspended') return;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { storeId: true } });
    if (!customer) return;
    await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.p2p.standing_changed', {
      subject: `p2p_suspended:${customerId}:${mode}:${Date.now()}`,
      title: 'Your trading is paused',
      body: restriction.message,
      link: '/account/standing',
      mode,
    });
    await this.prisma.p2pStanding.upsert({ where: { customerId_mode: { customerId, mode } }, create: { customerId, mode, notifiedAt: new Date() }, update: { notifiedAt: new Date() } });
  }

  /** Operations clear a trader's strikes (and so a pause): strikes before now no longer count. Audited. */
  async clear(adminId: string | null, customerId: string, mode: LedgerMode, reason: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, storeId: true, store: { select: { platform: true } } } });
    if (!customer || customer.store.platform !== 'afrippa') throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such trader.', 'id');
    const before = await this.standing(customerId, mode);
    await this.prisma.p2pStanding.upsert({
      where: { customerId_mode: { customerId, mode } },
      create: { customerId, mode, clearedAt: new Date(), clearedBy: adminId, clearReason: reason.trim() },
      update: { clearedAt: new Date(), clearedBy: adminId, clearReason: reason.trim() },
    });
    await this.audit.record({ actorId: adminId, action: 'trader.strikes_cleared', targetType: 'customer', targetId: customerId, before: { strikes: before.strikes, restriction: before.restriction?.code ?? null }, after: { strikes: 0, reason: reason.trim() }, platform: 'afrippa' });
    if (before.restriction?.code === 'trading_suspended') {
      await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.p2p.standing_changed', { subject: `p2p_cleared:${customerId}:${mode}:${Date.now()}`, title: 'You can trade again', body: "Afrippa's team cleared your strikes.", link: '/account/standing', mode });
    }
    return this.standing(customerId, mode);
  }
}
