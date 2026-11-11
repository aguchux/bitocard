import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type BillingInterval, freePlan, graceDays, priceIn, remindDays } from './plans.js';
import { periodEnd } from './pos.service.js';
import { type AccountRow, PosService, withShops } from './pos.service.js';

const day = 24 * 60 * 60 * 1000;
const leaseMs = 5 * 60_000;
const batch = 100;

const money = (amount: bigint, currency: string) => {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(Number(amount) / 100);
  } catch {
    return `${currency} ${(Number(amount) / 100).toFixed(2)}`;
  }
};
const date = (at: Date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(at);

/**
 * Udozo POS's plan renewals, run by the `pos` job (hourly): a reminder 3 days before each paid month ends (or the trial),
 * then the renewal from the owner's Udozo wallet at the plan the account moves to (a waiting change takes over now).
 * A renewal the wallet cannot pay keeps the plan for 7 days (the owner told at once and the day before), retried each run,
 * then the account drops to Free's limits; nothing is deleted. Each account is claimed for a few minutes, and each
 * period's charge has its own ledger reference, so running twice never charges twice.
 */
@Injectable()
export class PosBillingService {
  private readonly logger = new Logger(PosBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosService,
  ) {}

  async run(now = new Date()) {
    return { reminded: await this.remind(now), ...(await this.renew(now)) };
  }

  private async remind(now: Date) {
    const due = await this.prisma.posAccount.findMany({
      where: { planCode: { not: freePlan }, pastDueSince: null, periodEnd: { gt: now, lte: new Date(now.getTime() + remindDays * day) } },
      include: { plan: true },
      take: batch,
    });
    let sent = 0;
    for (const row of due) {
      if (!row.periodEnd || (row.remindedFor && row.remindedFor.getTime() === row.periodEnd.getTime())) continue;
      const claimed = await this.prisma.posAccount.updateMany({ where: { id: row.id, OR: [{ remindedFor: null }, { remindedFor: { not: row.periodEnd } }] }, data: { remindedFor: row.periodEnd } });
      if (!claimed.count) continue;
      sent += 1;
      const next = row.nextPlanCode ?? row.planCode;
      if (next === freePlan) {
        this.pos.tell(row, `ending:${row.periodEnd.toISOString()}`, 'Your Udozo POS plan ends soon', `${row.plan.name} ends on ${date(row.periodEnd)} and your shop moves to Free. Choose a plan again any time.`);
        continue;
      }
      const plan = next === row.planCode ? row.plan : await this.prisma.posPlan.findUnique({ where: { code: next } });
      const price = plan ? priceIn(plan, row.currency) : null;
      this.pos.tell(
        row,
        `renewal:${row.periodEnd.toISOString()}`,
        row.trialEndsAt ? 'Your Udozo POS free trial ends soon' : 'Your Udozo POS plan renews soon',
        `${plan?.name ?? 'Your plan'} renews on ${date(row.periodEnd)}${price ? ` for ${money(price, row.currency)}` : ''}, paid from your Udozo wallet. Keep enough in it so your shop stays on ${plan?.name ?? 'it'}.`,
      );
    }
    return sent;
  }

  private async renew(now: Date) {
    const due = await this.prisma.posAccount.findMany({
      where: { planCode: { not: freePlan }, periodEnd: { lte: now }, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - leaseMs) } }] },
      orderBy: { periodEnd: 'asc' },
      take: batch,
      select: { id: true, claimedAt: true },
    });
    const result = { renewed: 0, failed: 0, dropped: 0, ended: 0 };
    for (const { id, claimedAt } of due) {
      const claimed = await this.prisma.posAccount.updateMany({ where: { id, claimedAt }, data: { claimedAt: now } });
      if (!claimed.count) continue;
      try {
        const outcome = await this.renewOne(id, now);
        if (outcome) result[outcome] += 1;
      } catch (error) {
        this.logger.warn({ err: error, account: id }, 'Could not renew a Udozo POS plan');
      } finally {
        await this.prisma.posAccount.updateMany({ where: { id, claimedAt: now }, data: { claimedAt: null } });
      }
    }
    return result;
  }

  private async renewOne(id: string, now: Date): Promise<'renewed' | 'failed' | 'dropped' | 'ended' | null> {
    const row = (await this.prisma.posAccount.findUnique({ where: { id }, include: withShops })) as AccountRow | null;
    if (!row || row.planCode === freePlan || !row.periodEnd || row.periodEnd > now) return null;
    const code = row.nextPlanCode ?? row.planCode;
    if (code === freePlan) {
      await this.toFree(row, null);
      this.pos.tell(row, `ended:${row.periodEnd.toISOString()}`, 'Your shop is on Udozo POS Free', 'Your paid plan has ended. Your till keeps working with Free’s limits, and you can choose a plan again any time.');
      return 'ended';
    }
    const plan = code === row.planCode ? row.plan : await this.prisma.posPlan.findUnique({ where: { code } });
    // Yearly while the plan is priced yearly there, else monthly.
    const asked = (row.nextInterval ?? row.billingInterval) as BillingInterval;
    const interval: BillingInterval = plan && asked === 'year' && priceIn(plan, row.currency, 'year') === null ? 'month' : asked;
    const price = plan ? priceIn(plan, row.currency, interval) : null;
    // A period on from the paid-up date, or from now when it is days behind (a renewal that waited), so no time is lost.
    const start = row.pastDueSince ? now : row.periodEnd;
    const end = periodEnd(start, interval);
    if (plan && price !== null) {
      try {
        await this.pos.charge(row, {
          kind: 'renewal',
          plan,
          interval,
          price,
          credit: 0n,
          amount: price,
          start,
          end,
          data: { planCode: plan.code, billingInterval: interval, periodStart: start, periodEnd: end, nextPlanCode: null, nextInterval: null, pastDueSince: null, trialEndsAt: null, claimedAt: now },
        });
        this.pos.tell(row, `renewed:${start.toISOString()}`, 'Your Udozo POS plan is renewed', `${plan.name} is paid until ${date(end)}: ${money(price, row.currency)} from your Udozo wallet.`);
        return 'renewed';
      } catch (error) {
        if (!(error instanceof ApiError) || (error.code !== 'wallet_balance_low' && error.code !== 'pos_account_changed')) throw error;
        if (error.code === 'pos_account_changed') return null;
      }
    }
    // It could not be paid (or the plan is no longer priced there): 7 days' grace, then Free.
    if (!row.pastDueSince) {
      await this.prisma.posAccount.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { pastDueSince: now } });
      this.pos.tell(row, `failed:${row.periodEnd.toISOString()}`, 'We could not renew your Udozo POS plan', `Your Udozo wallet did not have ${price ? money(price, row.currency) : 'enough'} for ${plan?.name ?? 'your plan'}. Add funds on udozo.com within ${graceDays} days to keep it; we will try again.`);
      return 'failed';
    }
    const dropsAt = new Date(row.pastDueSince.getTime() + graceDays * day);
    if (now >= dropsAt) {
      await this.toFree(row, row.planCode);
      this.pos.tell(row, `dropped:${row.pastDueSince.toISOString()}`, 'Your shop moved to Udozo POS Free', `${plan?.name ?? 'Your plan'} could not be paid, so your shop now has Free’s limits. Nothing is deleted: pay for a plan again and everything comes back.`);
      return 'dropped';
    }
    if (dropsAt.getTime() - now.getTime() <= day && (!row.remindedFor || row.remindedFor.getTime() !== dropsAt.getTime())) {
      await this.prisma.posAccount.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { remindedFor: dropsAt } });
      this.pos.tell(row, `last:${dropsAt.toISOString()}`, 'Last day to keep your Udozo POS plan', `Add ${price ? money(price, row.currency) : 'funds'} to your Udozo wallet today, or your shop moves to Free tomorrow.`);
    }
    return 'failed';
  }

  private async toFree(row: AccountRow, lapsed: string | null) {
    await this.prisma.posAccount.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { planCode: freePlan, billingInterval: 'month', periodStart: null, periodEnd: null, trialEndsAt: null, nextPlanCode: null, nextInterval: null, pastDueSince: null, ...(lapsed ? { lapsedPlanCode: lapsed } : {}) },
    });
  }
}
