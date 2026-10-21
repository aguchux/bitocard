import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Plan, StoreSubscription } from '../generated/prisma/client.js';
import { InvoicesService } from './invoices.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney, planEndedEmail, planRenewalFailedEmail } from '../notifications/templates.js';
import { freePlanCode, PlansService, presentPlanDetail } from '../plans/plans.service.js';

/** Days a store's paid plan stays on after a failed renewal before it goes back to Startup. */
export const storeRenewalGraceDays = 7;
/** Resellers whose plans moved to their stores are told this long before the first renewal. */
export const transitionNoticeDays = 14;
const day = 24 * 60 * 60 * 1000;
/** How long a plan change holds its store (longer than charging the wallet takes). */
const planChangeClaimMs = 2 * 60 * 1000;
const busy = Symbol('busy');

function addMonth(date: Date) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** Plans in order, lowest first: the list's order, then price. "Higher" means later in it. */
export const planRank = (plan: Pick<Plan, 'sortOrder' | 'priceCents'>) => plan.sortOrder * 1_000_000_000 + plan.priceCents;

const missingStore = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');

/**
 * Plans per store. A store is on Startup (no row) or subscribes to a paid plan, billed on its own from the reseller's
 * live wallet in their currency: upgrades at once, charging the new price less credit for the unused days of the
 * current one; downgrades at the end of the paid month; a failed renewal keeps the plan 7 days, then Startup. The
 * account's plan (`resellers.plan_code`, read by account-wide features) is the highest plan among its stores.
 */
@Injectable()
export class StoreSubscriptionsService {
  private readonly logger = new Logger('StoreSubscriptions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly plans: PlansService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  private freePlan() {
    return this.prisma.plan.findUniqueOrThrow({ where: { code: freePlanCode } });
  }

  private async storeOf(resellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId }, include: { subscription: { include: { plan: true } } } });
    if (!store) throw missingStore();
    return store;
  }

  /**
   * The account's plan: the highest among its stores' subscriptions, else Startup. Resellers still billed on the account
   * (a paid plan from before plans were per store, with no store) and BitoCard's own accounts keep theirs.
   */
  async syncAccountPlan(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (reseller.house || reseller.planRenewsAt) return;
    const subscriptions = await this.prisma.storeSubscription.findMany({ where: { resellerId }, include: { plan: true } });
    const best = subscriptions.map(item => item.plan).sort((a, b) => planRank(b) - planRank(a))[0];
    const planCode = best?.code ?? freePlanCode;
    if (planCode !== reseller.planCode) await this.prisma.reseller.update({ where: { id: resellerId }, data: { planCode } });
  }

  /** One store's plan as its reseller sees it: the plan with its price in their currency, and its billing. */
  async view(resellerId: string, storeId: string) {
    const store = await this.storeOf(resellerId, storeId);
    return this.present(resellerId, store.id, store.name, store.subscription);
  }

  private async present(resellerId: string, storeId: string, storeName: string, subscription: (StoreSubscription & { plan: Plan }) | null) {
    const plan = subscription?.plan ?? (await this.freePlan());
    const { currency } = await this.wallets.currencyOf(resellerId);
    const next = subscription?.nextPlanCode ? await this.prisma.plan.findUnique({ where: { code: subscription.nextPlanCode } }) : null;
    return {
      object: 'store_subscription' as const,
      store: { id: storeId, name: storeName },
      plan: presentPlanDetail(plan, await this.plans.localPrice(plan, currency), this.plans.limitsOf(plan)),
      /** When the store's plan is next charged; null when it is not billed (Startup, or set by BitoCard). */
      renews_at: subscription?.renewsAt?.toISOString() ?? null,
      /** The plan ends at `renews_at` and the store goes back to Startup. */
      cancel_at_period_end: subscription?.cancelAtPeriodEnd ?? false,
      /** A cheaper plan taking over at `renews_at`. */
      next_plan: next ? { code: next.code, name: next.name } : null,
      past_due_since: subscription?.pastDueSince?.toISOString() ?? null,
    };
  }

  /** Every store's plan, and the account's (the highest among them). */
  async list(resellerId: string) {
    const [reseller, stores] = await Promise.all([
      this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true } }),
      this.prisma.store.findMany({ where: { resellerId }, orderBy: { createdAt: 'asc' }, include: { subscription: { include: { plan: true } } } }),
    ]);
    return {
      object: 'list' as const,
      account_plan: { code: reseller.plan.code, name: reseller.plan.name },
      data: await Promise.all(stores.map(store => this.present(resellerId, store.id, store.name, store.subscription))),
    };
  }

  /** What a plan costs this reseller a month, in their currency (thrown when it cannot be priced today). */
  private async priceFor(resellerId: string, plan: Plan) {
    const { currency } = await this.wallets.currencyOf(resellerId);
    const price = await this.plans.localPrice(plan, currency);
    if (!price) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'conversion_unavailable', `${plan.name} cannot be priced in ${currency} right now. Try again later.`);
    return price;
  }

  /** Takes an amount from the live wallet (topped-up funds first, then earnings) as BitoCard revenue. */
  private async charge(resellerId: string, amount: bigint, reference: string, description: string, line: { storeId: string; currency: string }) {
    if (amount <= 0n) return;
    const hold = await this.wallets.hold({ resellerId, mode: 'live', amount, reference, description });
    await this.wallets.captureHold(hold.id, description);
    // The store's invoice for the month records it (paid).
    await this.invoices.recordPaid({ resellerId, storeId: line.storeId, currency: line.currency, kind: 'subscription', description, amount, reference });
  }

  /**
   * Changes a store's plan. To Startup: a billed plan runs to the end of the paid month, one set by BitoCard ends now.
   * To the same plan: takes back a cancellation or a waiting downgrade. Up (or from Startup): charged now, less credit
   * for the unused part of what was paid this month, starting a new month. Down to another paid plan: at the end of the
   * paid month.
   */
  async change(resellerId: string, storeId: string, planCode: string, actorId: string | null) {
    await this.storeOf(resellerId, storeId);
    const result = await this.claimed(storeId, () => this.changeClaimed(resellerId, storeId, planCode, actorId));
    if (result === busy) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_change_in_progress', 'This store’s plan is being changed already. Refresh in a moment.');
    return result;
  }

  /**
   * Runs `work` holding the store's plan claim (2 minutes, longer than a charge), so a change, a second change (a double
   * click with fresh idempotency keys) and a renewal never charge at once or use the same unused days as credit.
   * `busy` when another holds it.
   */
  private async claimed<T>(storeId: string, work: () => Promise<T>): Promise<T | typeof busy> {
    const claimedAt = new Date();
    const claim = await this.prisma.store.updateMany({
      where: { id: storeId, OR: [{ planChangingAt: null }, { planChangingAt: { lt: new Date(claimedAt.getTime() - planChangeClaimMs) } }] },
      data: { planChangingAt: claimedAt },
    });
    if (claim.count === 0) return busy;
    try {
      return await work();
    } finally {
      await this.prisma.store.updateMany({ where: { id: storeId, planChangingAt: claimedAt }, data: { planChangingAt: null } });
    }
  }

  private async changeClaimed(resellerId: string, storeId: string, planCode: string, actorId: string | null) {
    // Read under the claim, so the credit is worked out from the plan as it is now.
    const store = await this.storeOf(resellerId, storeId);
    const current = store.subscription;
    const now = new Date();
    if (planCode === freePlanCode) {
      if (!current) return this.view(resellerId, storeId);
      if (current.renewsAt) await this.prisma.storeSubscription.update({ where: { storeId }, data: { cancelAtPeriodEnd: true, nextPlanCode: null } });
      else await this.prisma.storeSubscription.delete({ where: { storeId } });
      await this.syncAccountPlan(resellerId);
      await this.audit.record({ actorId, action: 'store.plan_changed', targetType: 'store', targetId: storeId, before: { plan: current.planCode }, after: { plan: freePlanCode, at_period_end: Boolean(current.renewsAt) } });
      return this.view(resellerId, storeId);
    }
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
    if (current?.planCode === planCode) {
      if (current.cancelAtPeriodEnd || current.nextPlanCode) await this.prisma.storeSubscription.update({ where: { storeId }, data: { cancelAtPeriodEnd: false, nextPlanCode: null } });
      return this.view(resellerId, storeId);
    }
    if (!plan.available) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_unavailable', `${plan.name} is no longer offered. Choose another plan.`, 'plan');

    // Down to a cheaper paid plan: at the end of the paid month.
    if (current?.renewsAt && planRank(plan) < planRank(current.plan)) {
      await this.prisma.storeSubscription.update({ where: { storeId }, data: { nextPlanCode: planCode, cancelAtPeriodEnd: false } });
      await this.audit.record({ actorId, action: 'store.plan_changed', targetType: 'store', targetId: storeId, before: { plan: current.planCode }, after: { plan: planCode, at_period_end: true } });
      return this.view(resellerId, storeId);
    }

    // Up, or from Startup or a plan BitoCard set: charged now, less credit for the unused days already paid for.
    const price = await this.priceFor(resellerId, plan);
    let credit = 0n;
    if (current?.renewsAt && current.periodStartedAt && current.paidMinor > 0n && current.paidCurrency === price.currency) {
      const period = current.renewsAt.getTime() - current.periodStartedAt.getTime();
      const left = Math.max(0, current.renewsAt.getTime() - now.getTime());
      if (period > 0) credit = (current.paidMinor * BigInt(Math.floor((left / period) * 1_000_000))) / 1_000_000n;
    }
    const due = price.amount > credit ? price.amount - credit : 0n;
    const how = credit > 0n ? ` less ${formatMoney(credit, price.currency)} unused from ${current!.plan.name}` : '';
    await this.charge(resellerId, due, `plan:store:${storeId}:${planCode}:${now.toISOString()}`, `${plan.name} plan for ${store.name}: ${formatMoney(due, price.currency)} (${formatMoney(price.amount, price.currency)} a month${how})`, { storeId, currency: price.currency });
    const data = { planCode, renewsAt: addMonth(now), periodStartedAt: now, paidMinor: price.amount, paidCurrency: price.currency, cancelAtPeriodEnd: false, nextPlanCode: null, pastDueSince: null, migrated: false };
    await this.prisma.storeSubscription.upsert({ where: { storeId }, create: { storeId, resellerId, ...data }, update: data });
    await this.syncAccountPlan(resellerId);
    await this.audit.record({ actorId, action: 'store.plan_changed', targetType: 'store', targetId: storeId, before: { plan: current?.planCode ?? freePlanCode }, after: { plan: planCode, charged: Number(due), credit: Number(credit), currency: price.currency } });
    return this.view(resellerId, storeId);
  }

  /**
   * Admin: puts a store on a plan without billing it (`renews_at` null), or back on Startup. Audited by the caller's
   * controller as for other admin changes.
   */
  async assign(actorId: string | null, storeId: string, planCode: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, include: { subscription: true } });
    if (!store) throw missingStore();
    if (planCode === freePlanCode) {
      if (store.subscription) await this.prisma.storeSubscription.delete({ where: { storeId } });
    } else {
      if (!(await this.prisma.plan.findUnique({ where: { code: planCode } }))) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
      const data = { planCode, renewsAt: null, periodStartedAt: null, paidMinor: 0n, paidCurrency: null, cancelAtPeriodEnd: false, nextPlanCode: null, pastDueSince: null, migrated: false };
      await this.prisma.storeSubscription.upsert({ where: { storeId }, create: { storeId, resellerId: store.resellerId, ...data }, update: data });
    }
    await this.syncAccountPlan(store.resellerId);
    await this.audit.record({ actorId, action: 'store.plan_assigned', targetType: 'store', targetId: storeId, before: { plan: store.subscription?.planCode ?? freePlanCode }, after: { plan: planCode, billed: false } });
    return this.view(store.resellerId, storeId);
  }

  /** Renews, changes or ends store plans that are due, and tells resellers about their first per-store renewal. Daily. */
  async renewDue(now = new Date()) {
    const outcome = { renewed: 0, ended: 0, past_due: 0, notices: await this.transitionNotices(now) };
    const due = await this.prisma.storeSubscription.findMany({ where: { renewsAt: { lte: now } }, include: { plan: true, store: true }, take: 200 });
    for (const listed of due) {
      // Under the store's claim, read again: a change made meanwhile wins, and the next run renews what is still due.
      const step = await this.claimed(listed.storeId, async () => {
        const subscription = await this.prisma.storeSubscription.findFirst({ where: { storeId: listed.storeId, renewsAt: { lte: now } }, include: { plan: true, store: true } });
        if (subscription) await this.renewOne(subscription, now, outcome);
      });
      if (step === busy) continue;
    }
    return outcome;
  }

  private async renewOne(subscription: StoreSubscription & { plan: Plan; store: { name: string } }, now: Date, outcome: { renewed: number; ended: number; past_due: number }) {
    {
      const { storeId, resellerId } = subscription;
      if (subscription.cancelAtPeriodEnd) {
        await this.end(subscription, 'cancelled');
        outcome.ended += 1;
        return;
      }
      const plan = subscription.nextPlanCode ? ((await this.prisma.plan.findUnique({ where: { code: subscription.nextPlanCode } })) ?? subscription.plan) : subscription.plan;
      try {
        const price = await this.priceFor(resellerId, plan);
        await this.charge(resellerId, price.amount, `plan:store:${storeId}:${plan.code}:${subscription.renewsAt!.toISOString()}`, `${plan.name} plan for ${subscription.store.name}: ${formatMoney(price.amount, price.currency)}`, { storeId, currency: price.currency });
        await this.prisma.storeSubscription.update({
          where: { storeId },
          data: { planCode: plan.code, renewsAt: addMonth(subscription.renewsAt!), periodStartedAt: subscription.renewsAt, paidMinor: price.amount, paidCurrency: price.currency, nextPlanCode: null, pastDueSince: null, migrated: false },
        });
        await this.syncAccountPlan(resellerId);
        outcome.renewed += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (subscription.pastDueSince && now.getTime() - subscription.pastDueSince.getTime() >= storeRenewalGraceDays * day) {
          await this.end(subscription, 'unpaid');
          outcome.ended += 1;
          return;
        }
        if (!subscription.pastDueSince) {
          await this.prisma.storeSubscription.update({ where: { storeId }, data: { pastDueSince: now } });
          const local = await this.priceFor(resellerId, plan).catch(() => null);
          const price = local ? formatMoney(local.amount, local.currency) : `US$${(plan.priceCents / 100).toFixed(2)}`;
          const name = `${plan.name} (${subscription.store.name})`;
          await this.notify(resellerId, to => planRenewalFailedEmail(to, name, price, storeRenewalGraceDays));
          await this.inbox.reseller(resellerId, 'plan.renewal_failed', {
            subject: `${storeId}:${now.toISOString().slice(0, 10)}`,
            title: `${name}: renewal failed`,
            body: `Your wallet could not pay ${price} for ${name}. Top up within ${storeRenewalGraceDays} days to keep it.`,
            link: '/settings/plan',
            mode: 'live',
          });
        }
        outcome.past_due += 1;
      }
    }
  }

  /** The store goes back to Startup: cancelled at the end of its month, or unpaid after the grace period. */
  private async end(subscription: StoreSubscription & { plan: Plan; store: { name: string } }, why: 'cancelled' | 'unpaid') {
    await this.prisma.storeSubscription.deleteMany({ where: { storeId: subscription.storeId, renewsAt: subscription.renewsAt } });
    await this.syncAccountPlan(subscription.resellerId);
    const name = `${subscription.plan.name} (${subscription.store.name})`;
    if (why === 'unpaid') await this.notify(subscription.resellerId, to => planEndedEmail(to, name));
    await this.inbox.reseller(subscription.resellerId, 'plan.ended', {
      subject: `${subscription.storeId}:${Date.now()}`,
      title: `${name} ended`,
      body: why === 'unpaid' ? `${name} was not paid and has ended; the store is on the Startup plan now.` : `${name} has ended as you chose; the store is on the Startup plan now.`,
      link: '/settings/plan',
      mode: 'live',
    });
  }

  /**
   * Plans moved from the account to its stores: each reseller is told once, at least 14 days before the first renewal,
   * which stores will renew and which will go back to Startup, and that they can choose otherwise.
   */
  private async transitionNotices(now: Date) {
    const due = await this.prisma.storeSubscription.findMany({
      where: { migrated: true, transitionNoticeAt: null, renewsAt: { lte: new Date(now.getTime() + transitionNoticeDays * day) } },
      include: { store: true, plan: true },
      take: 500,
    });
    const byReseller = new Map<string, typeof due>();
    for (const item of due) byReseller.set(item.resellerId, [...(byReseller.get(item.resellerId) ?? []), item]);
    for (const [resellerId, items] of byReseller) {
      const renewing = items.filter(item => !item.cancelAtPeriodEnd).map(item => item.store.name);
      const ending = items.filter(item => item.cancelAtPeriodEnd).map(item => item.store.name);
      const date = items[0].renewsAt!.toISOString().slice(0, 10);
      await this.inbox.reseller(resellerId, 'plan.stores_renewing', {
        subject: `transition:${resellerId}`,
        title: 'Your plan is now chosen per store',
        body: `From ${date} each store pays for its own plan.${renewing.length ? ` Renewing: ${renewing.join(', ')}.` : ''}${ending.length ? ` Going back to Startup: ${ending.join(', ')}.` : ''} Change this for any store in Settings > Plan before then.`,
        link: '/settings/plan',
        mode: 'live',
      });
      await this.prisma.storeSubscription.updateMany({ where: { storeId: { in: items.map(item => item.storeId) } }, data: { transitionNoticeAt: now } });
    }
    return byReseller.size;
  }

  private async notify(resellerId: string, build: (to: string) => Parameters<EmailService['send']>[0]) {
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, include: { user: true } });
    if (owner) await this.email.send(build(owner.user.email)).catch(error => this.logger.warn({ err: error, resellerId }, 'Could not send the email'));
  }
}
