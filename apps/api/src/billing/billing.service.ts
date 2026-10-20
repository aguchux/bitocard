import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Plan, Reseller } from '../generated/prisma/client.js';
import { WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { formatMoney, planEndedEmail, planRenewalFailedEmail } from '../notifications/templates.js';
import { PlansService, presentPlanDetail } from '../plans/plans.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { freePlanCode } from '../plans/features.js';

/** Days a Premium plan stays on after a failed renewal before it drops to Standard. */
export const renewalGraceDays = 7;
const day = 24 * 60 * 60 * 1000;

function addMonth(date: Date) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Premium billing: monthly, from the live wallet, in the reseller's own currency: the price BitoCard fixed for that
 * currency, else the US dollar price at BitoCard's rate on the day. A country wallet short of it is topped up from the
 * dollar wallet's funds as for any hold. Cancelling keeps Premium to the end of the paid month. A failed renewal gives a
 * grace period.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly plans: PlansService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
  ) {}

  async subscription(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true } });
    const { currency } = await this.wallets.currencyOf(resellerId);
    return {
      object: 'subscription' as const,
      /** With `local_price`: what the plan costs a month in your currency. */
      plan: presentPlanDetail(reseller.plan, await this.plans.localPrice(reseller.plan, currency)),
      /** Null when the plan is not billed (Standard, or set by BitoCard). */
      renews_at: reseller.planRenewsAt?.toISOString() ?? null,
      cancel_at_period_end: reseller.planCancelAtPeriodEnd,
      past_due_since: reseller.planPastDueSince?.toISOString() ?? null,
    };
  }

  async change(resellerId: string, planCode: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (planCode === freePlanCode) {
      if (reseller.planCode === freePlanCode) return this.subscription(resellerId);
      // A billed plan runs to the end of the paid month; one set by BitoCard ends now.
      await this.prisma.reseller.update({
        where: { id: resellerId },
        data: reseller.planRenewsAt ? { planCancelAtPeriodEnd: true } : { planCode: freePlanCode, planPastDueSince: null },
      });
      return this.subscription(resellerId);
    }
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
    if (reseller.planCode !== planCode && !plan.available) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_unavailable', `${plan.name} is no longer offered. Choose another plan.`, 'plan');
    }
    if (reseller.planCode === planCode) {
      if (reseller.planCancelAtPeriodEnd) await this.prisma.reseller.update({ where: { id: resellerId }, data: { planCancelAtPeriodEnd: false } });
      return this.subscription(resellerId);
    }
    const now = new Date();
    await this.charge(reseller, plan, `plan:${resellerId}:${planCode}:${now.toISOString()}`);
    await this.prisma.reseller.update({
      where: { id: resellerId },
      data: { planCode, planRenewsAt: addMonth(now), planCancelAtPeriodEnd: false, planPastDueSince: null },
    });
    return this.subscription(resellerId);
  }

  /** What the plan costs this reseller a month, in their currency (thrown when it cannot be priced today). */
  private async priceFor(reseller: Reseller, plan: Plan) {
    const { currency } = await this.wallets.currencyOf(reseller.id);
    const price = await this.plans.localPrice(plan, currency);
    if (!price) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'conversion_unavailable', `${plan.name} cannot be priced in ${currency} right now. Try again later.`);
    return price;
  }

  /** Takes the plan price from the live wallet (topped-up funds first, then earnings) as BitoCard revenue. */
  private async charge(reseller: Reseller, plan: Plan, reference: string) {
    if (plan.priceCents === 0) return;
    const price = await this.priceFor(reseller, plan);
    const hold = await this.wallets.hold({ resellerId: reseller.id, mode: 'live', amount: price.amount, reference, description: `${plan.name} plan` });
    const how = price.fixed ? 'monthly price' : `US$${(plan.priceCents / 100).toFixed(2)} at today's rate`;
    await this.wallets.captureHold(hold.id, `${plan.name} plan: ${formatMoney(price.amount, price.currency)} (${how})`);
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
        await this.charge(reseller, reseller.plan, `plan:${reseller.id}:${reseller.planCode}:${reseller.planRenewsAt!.toISOString()}`);
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
          const local = await this.priceFor(reseller, reseller.plan).catch(() => null);
          const price = local ? formatMoney(local.amount, local.currency) : `US$${(reseller.plan.priceCents / 100).toFixed(2)}`;
          await this.notify(reseller.id, to => planRenewalFailedEmail(to, reseller.plan.name, price, renewalGraceDays));
          await this.inbox.reseller(reseller.id, 'plan.renewal_failed', {
            subject: `${reseller.id}:${now.toISOString().slice(0, 10)}`,
            title: `${reseller.plan.name} renewal failed`,
            body: `Your wallet could not pay ${price} for ${reseller.plan.name}. Top up within ${renewalGraceDays} days to keep it.`,
            link: '/settings/plan',
            mode: 'live',
          });
        }
        outcome.past_due += 1;
      }
    }
    return outcome;
  }

  private async end(resellerId: string, planName: string) {
    await this.prisma.reseller.update({
      where: { id: resellerId },
      data: { planCode: freePlanCode, planRenewsAt: null, planCancelAtPeriodEnd: false, planPastDueSince: null },
    });
    await this.notify(resellerId, to => planEndedEmail(to, planName));
    await this.inbox.reseller(resellerId, 'plan.ended', {
      subject: `${resellerId}:${Date.now()}`,
      title: `${planName} ended`,
      body: `Your ${planName} plan was not paid and has ended; you are on the Standard plan now.`,
      link: '/settings/plan',
      mode: 'live',
    });
  }

  private async notify(resellerId: string, build: (to: string) => Parameters<EmailService['send']>[0]) {
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, include: { user: true } });
    if (owner) await this.email.send(build(owner.user.email)).catch(error => this.logger.warn({ err: error, resellerId }, 'Could not send the email'));
  }
}
