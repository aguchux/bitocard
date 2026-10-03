import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Reseller } from '../generated/prisma/client.js';
import { FxService } from '../fx/fx.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { formatMoney, planEndedEmail, planRenewalFailedEmail } from '../notifications/templates.js';
import { presentPlan } from '../plans/plans.service.js';

/** Days a Premium plan stays on after a failed renewal before it drops to Standard. */
export const renewalGraceDays = 7;
const day = 24 * 60 * 60 * 1000;

function addMonth(date: Date) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Premium billing: monthly, from the live wallet, priced in US dollars and charged in the reseller's currency at
 * BitoCard's rate. Cancelling keeps Premium to the end of the paid month. A failed renewal gives a grace period.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly fx: FxService,
    private readonly email: EmailService,
  ) {}

  async subscription(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true } });
    return {
      object: 'subscription' as const,
      plan: presentPlan(reseller.plan),
      /** Null when the plan is not billed (Standard, or set by BitoCard). */
      renews_at: reseller.planRenewsAt?.toISOString() ?? null,
      cancel_at_period_end: reseller.planCancelAtPeriodEnd,
      past_due_since: reseller.planPastDueSince?.toISOString() ?? null,
    };
  }

  async change(resellerId: string, planCode: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (planCode === 'standard') {
      if (reseller.planCode === 'standard') return this.subscription(resellerId);
      // A billed plan runs to the end of the paid month; one set by BitoCard ends now.
      await this.prisma.reseller.update({
        where: { id: resellerId },
        data: reseller.planRenewsAt ? { planCancelAtPeriodEnd: true } : { planCode: 'standard', planPastDueSince: null },
      });
      return this.subscription(resellerId);
    }
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
    if (reseller.planCode === planCode) {
      if (reseller.planCancelAtPeriodEnd) await this.prisma.reseller.update({ where: { id: resellerId }, data: { planCancelAtPeriodEnd: false } });
      return this.subscription(resellerId);
    }
    const now = new Date();
    await this.charge(reseller, plan.priceCents, plan.name, `plan:${resellerId}:${planCode}:${now.toISOString()}`);
    await this.prisma.reseller.update({
      where: { id: resellerId },
      data: { planCode, planRenewsAt: addMonth(now), planCancelAtPeriodEnd: false, planPastDueSince: null },
    });
    return this.subscription(resellerId);
  }

  /** Takes the plan price from the live wallet (topped-up funds first, then earnings) as BitoCard revenue. */
  private async charge(reseller: Reseller, priceCents: number, planName: string, reference: string) {
    if (priceCents === 0) return;
    const { currency } = await this.wallets.currencyOf(reseller.id);
    const { amount, rate } = await this.fx.chargeForUsdCents(priceCents, currency);
    const hold = await this.wallets.hold({ resellerId: reseller.id, mode: 'live', amount, reference, description: `${planName} plan` });
    await this.wallets.captureHold(hold.id, `${planName} plan: ${formatMoney(amount, currency)} (US$${(priceCents / 100).toFixed(2)} at ${rate.pay.toDecimalPlaces(4).toString()})`);
  }

  /** Renews or ends Premium plans that are due. Run daily. */
  async renewDue(now = new Date()) {
    const due = await this.prisma.reseller.findMany({ where: { planRenewsAt: { lte: now } }, include: { plan: true }, take: 200 });
    const outcome = { renewed: 0, ended: 0, past_due: 0 };
    for (const reseller of due) {
      if (reseller.planCancelAtPeriodEnd) {
        await this.end(reseller.id, reseller.plan.name);
        outcome.ended += 1;
        continue;
      }
      try {
        await this.charge(reseller, reseller.plan.priceCents, reseller.plan.name, `plan:${reseller.id}:${reseller.planCode}:${reseller.planRenewsAt!.toISOString()}`);
        await this.prisma.reseller.update({
          where: { id: reseller.id },
          data: { planRenewsAt: addMonth(reseller.planRenewsAt!), planPastDueSince: null },
        });
        outcome.renewed += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (reseller.planPastDueSince && now.getTime() - reseller.planPastDueSince.getTime() >= renewalGraceDays * day) {
          await this.end(reseller.id, reseller.plan.name);
          outcome.ended += 1;
          continue;
        }
        if (!reseller.planPastDueSince) {
          await this.prisma.reseller.update({ where: { id: reseller.id }, data: { planPastDueSince: now } });
          const price = `US$${(reseller.plan.priceCents / 100).toFixed(2)}`;
          await this.notify(reseller.id, to => planRenewalFailedEmail(to, reseller.plan.name, price, renewalGraceDays));
        }
        outcome.past_due += 1;
      }
    }
    return outcome;
  }

  private async end(resellerId: string, planName: string) {
    await this.prisma.reseller.update({
      where: { id: resellerId },
      data: { planCode: 'standard', planRenewsAt: null, planCancelAtPeriodEnd: false, planPastDueSince: null },
    });
    await this.notify(resellerId, to => planEndedEmail(to, planName));
  }

  private async notify(resellerId: string, build: (to: string) => Parameters<EmailService['send']>[0]) {
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, include: { user: true } });
    if (owner) await this.email.send(build(owner.user.email)).catch(error => this.logger.warn({ err: error, resellerId }, 'Could not send the email'));
  }
}
