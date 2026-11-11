import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { houseStoreId } from '../checkout/house-ids.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type LedgerMode, type PosAccount, type PosCharge, type PosPlan, type PosShop, type PosTill } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AccountNotices } from '../notifications/account-notices.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { addMonth, addYear, unusedCredit } from './money.js';
import { changeLevel, pausedShops, startSplit } from './stock-levels.js';
import { isPosShopKind, presentShopKind } from './shop-kinds.js';
import { type BillingInterval, chargeNumber, freePlan, graceDays, isPosPlanCode, limitsOf, offered, type PosLimitKey, presentPlan, priceIn, shopCodeFor } from './plans.js';

/** The end of a period paid from `start`: a month or a year on. */
export const periodEnd = (start: Date, interval: BillingInterval) => (interval === 'year' ? addYear(start) : addMonth(start));

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such shop or till on your Udozo POS account.');
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const noYearly = (plan: string) => conflict('interval_unavailable', `${plan} is not offered yearly in your country: choose monthly.`, 'interval');
const changed = () => conflict('pos_account_changed', 'Your Udozo POS account changed while you were doing this. Look again, then try again.');
const walletLow = (amount: bigint, currency: string) =>
  new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Your Udozo wallet needs ${currency} ${(Number(amount) / 100).toFixed(2)} for this. Add funds on udozo.com, then try again.`);

export type ShopInput = {
  name?: string;
  address?: string | null;
  phone?: string | null;
  tin?: string | null;
  vat_bps?: number;
  receipt_footer?: string | null;
  kind?: string;
  /** Shown on invoices. */
  email?: string | null;
  /** The shop's own bank account for later payments, on invoices (shown, never used by Udozo): all three, or none. */
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  /** Printed receipts carry the WhatsApp QR code. */
  receipt_qr?: boolean;
  /** The owner's: this shop first (the main shop, which a plan of one shop keeps selling). */
  main?: boolean;
  /** The owner's: online orders take from this shop once the online level is used up. */
  fulfils_online?: boolean;
};
export type TillInput = { name?: string; printer_width?: 58 | 80; auto_print?: boolean };

type AccountRow = PosAccount & { plan: PosPlan; shops: Array<PosShop & { tills: PosTill[] }> };
const withShops = {
  plan: true,
  // Closed shops are kept for their history, out of every list and limit.
  shops: { where: { closedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { tills: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } },
} satisfies Prisma.PosAccountInclude;

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const days = (n: number) => n * 24 * 60 * 60 * 1000;
const clean = (value: string | null | undefined, max: number) => {
  if (value === undefined) return undefined;
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || null;
};

/**
 * Udozo POS (docs/UDOZO_POS_PLAN.md, milestone 1): a udozo.com customer signs up as a shop owner (one POS account, in
 * their own country and currency), with a shop, a first till and a plan. Paid plans are paid monthly from their Udozo
 * wallet into `pos_revenue`, one ledger entry per charge (`pos:<account>:<kind>:<period start>`, so it is never taken
 * twice); a dearer plan is charged at once less the unused part of the one before, a cheaper one takes over at the
 * period's end. Behind the `pos` switch (global or country) for new sign-ups; accounts already open keep working.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly stores: StoreSellers,
    private readonly inbox: InboxService,
    private readonly notices: AccountNotices,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Plans ----

  async plans() {
    return this.prisma.posPlan.findMany({ orderBy: [{ position: 'asc' }, { code: 'asc' }] });
  }

  private async plan(code: string) {
    const plan = isPosPlanCode(code) ? await this.prisma.posPlan.findUnique({ where: { code } }) : null;
    if (!plan) throw invalid('parameter_invalid', 'Choose Free, Premium or Multi-shop.', 'plan');
    return plan;
  }

  /** The public list for pos.udozo.com: the plans shown, priced in a market's currency when one is named. */
  async publicPlans(country?: string) {
    const market = country ? await this.prisma.country.findUnique({ where: { code: country } }) : null;
    const currency = market?.currency ?? null;
    const plans = (await this.plans()).filter(plan => plan.code === freePlan || plan.shown);
    return {
      object: 'list' as const,
      country: market?.code ?? null,
      currency,
      open: market ? await this.settings.isOnForCountry('pos', market.code) : false,
      data: plans.map(plan => presentPlan(plan, currency)),
    };
  }

  // ---- The owner ----

  private async market(customer: CustomerWithStore) {
    if (customer.storeId !== houseStoreId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_unavailable', 'Udozo POS is for udozo.com accounts.');
    if (!customer.country) throw conflict('country_required', 'Choose your country on your Udozo account first.', 'country');
    const market = await this.prisma.country.findUnique({ where: { code: customer.country } });
    if (!market) throw conflict('country_required', 'Choose your country on your Udozo account first.', 'country');
    return market;
  }

  private mode(customer: CustomerWithStore): LedgerMode {
    return this.stores.mode(customer.store);
  }

  private async walletBalance(customerId: string, mode: LedgerMode, currency: string) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId, mode, currency }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  private async row(customerId: string): Promise<AccountRow | null> {
    return this.prisma.posAccount.findUnique({ where: { customerId }, include: withShops });
  }

  private async own(customer: CustomerWithStore) {
    const row = await this.row(customer.id);
    if (!row) throw noAccount();
    return row;
  }

  /** Where the owner stands: whether POS is open in their country, their wallet, and their account if they have one. */
  async me(customer: CustomerWithStore) {
    const market = await this.market(customer);
    const mode = this.mode(customer);
    const row = await this.row(customer.id);
    const plans = (await this.plans()).filter(plan => plan.code === freePlan || plan.shown);
    return {
      object: 'pos_owner' as const,
      open: await this.settings.isOnForCountry('pos', market.code),
      /** The till may take payment from a buyer's Udozo wallet (`pos_wallet_payments`). */
      wallet_payments: await this.settings.isOnForCountry('pos_wallet_payments', market.code),
      /** Owners on a paid plan may ask for Udozo collection accounts for their tills (`pos_collections`). */
      collections: await this.settings.isOnForCountry('pos_collections', market.code),
      country: market.code,
      currency: market.currency,
      wallet: { balance: Number(await this.walletBalance(customer.id, mode, market.currency)), currency: market.currency },
      plans: plans.map(plan => presentPlan(plan, market.currency)),
      account: row ? this.present(row) : null,
    };
  }

  /** Signing up: the shop, its first till and the plan, paid now unless it starts with a free trial (or is Free). */
  async signup(customer: CustomerWithStore, input: { plan: string; shop: ShopInput; expected_amount?: number; interval?: BillingInterval }) {
    const market = await this.market(customer);
    if (!(await this.settings.isOnForCountry('pos', market.code))) throw conflict('pos_unavailable', `Udozo POS is not open in your country yet.`);
    if (await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true } })) throw conflict('pos_account_exists', 'You already have a Udozo POS account. Sign in to it instead.');
    const plan = await this.plan(input.plan);
    if (!offered(plan, market.currency)) throw conflict('plan_unavailable', `${plan.name} is not offered in your country yet.`, 'plan');
    const shop = this.shopFields(input.shop, true);
    const mode = this.mode(customer);
    const now = new Date();
    const paid = plan.code !== freePlan;
    const interval: BillingInterval = paid ? (input.interval ?? 'month') : 'month';
    if (interval === 'year' && priceIn(plan, market.currency, 'year') === null) throw noYearly(plan.name);
    const price = priceIn(plan, market.currency, interval) ?? 0n;
    const trial = paid && plan.trialDays > 0;
    const end = !paid ? null : trial ? new Date(now.getTime() + days(plan.trialDays)) : periodEnd(now, interval);
    const due = paid && !trial ? price : 0n;
    if (input.expected_amount !== undefined && BigInt(input.expected_amount) !== due) throw conflict('price_changed', 'The price has changed: check it, then sign up again.', 'expected_amount');
    const accountId = randomUUID();
    const entry = due > 0n ? await this.chargeEntry({ accountId, customerId: customer.id, mode, currency: market.currency, amount: due, kind: 'signup', start: now, planName: plan.name }) : null;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.posAccount.create({
          data: {
            id: accountId,
            customerId: customer.id,
            mode,
            country: market.code,
            currency: market.currency,
            planCode: plan.code,
            billingInterval: interval,
            periodStart: paid ? now : null,
            periodEnd: end,
            trialEndsAt: trial ? end : null,
            trialUsedAt: trial ? now : null,
          },
        });
        await this.createShop(tx, accountId, shop, 0);
        if (entry) {
          await tx.posCharge.create({ data: { accountId, planCode: plan.code, kind: 'signup', interval, periodStart: now, periodEnd: end!, priceMinor: price, amountMinor: due, currency: market.currency, mode, reference: entry.reference } });
          await this.ledger.write(tx, entry);
        }
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw walletLow(due, market.currency);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('pos_account_exists', 'You already have a Udozo POS account. Sign in to it instead.');
      throw error;
    }
    return this.present((await this.row(customer.id))!);
  }

  /**
   * Changing plan or how it is paid. The same plan and interval again takes back a waiting change. During a trial the
   * plan and interval are swapped and the trial runs on (Free ends it). A dearer plan (by a month's worth), or moving
   * from monthly to yearly, is charged now, less the unused part of what was paid, for a new period; a cheaper one (Free
   * included, which is cancelling) or yearly to monthly takes over when the paid period ends.
   */
  async changePlan(customer: CustomerWithStore, code: string, expectedAmount?: number, asked?: BillingInterval) {
    const row = await this.own(customer);
    const target = await this.plan(code);
    const now = new Date();
    const current = row.billingInterval as BillingInterval;
    const interval: BillingInterval = target.code === freePlan ? 'month' : (asked ?? current);
    if (target.code !== row.planCode && target.code !== freePlan && !offered(target, row.currency)) throw conflict('plan_unavailable', `${target.name} is not offered in your country yet.`, 'plan');
    if (interval === 'year' && priceIn(target, row.currency, 'year') === null) throw noYearly(target.name);
    if (target.code === row.planCode && interval === current) {
      await this.update(row, { nextPlanCode: null, nextInterval: null });
      return this.present((await this.row(customer.id))!);
    }
    const trialling = row.trialEndsAt !== null && row.trialEndsAt > now;
    if (trialling) {
      await this.update(
        row,
        target.code === freePlan
          ? { planCode: freePlan, billingInterval: 'month', periodStart: null, periodEnd: null, trialEndsAt: null, nextPlanCode: null, nextInterval: null }
          : { planCode: target.code, billingInterval: interval, nextPlanCode: null, nextInterval: null },
      );
      return this.present((await this.row(customer.id))!);
    }
    const paidUp = row.planCode !== freePlan && row.periodEnd !== null && row.periodEnd > now && row.pastDueSince === null;
    if (target.code === freePlan) {
      // Cancelling: a paid period runs out first; with nothing paid up it is Free at once.
      await this.update(
        row,
        paidUp ? { nextPlanCode: freePlan, nextInterval: null } : { planCode: freePlan, billingInterval: 'month', periodStart: null, periodEnd: null, pastDueSince: null, nextPlanCode: null, nextInterval: null, trialEndsAt: null },
      );
      return this.present((await this.row(customer.id))!);
    }
    const currentPrice = paidUp ? await this.paidPrice(row) : 0n;
    const targetPrice = priceIn(target, row.currency, interval) ?? 0n;
    // A dearer plan (by its monthly price, so monthly and yearly compare fairly) or monthly to yearly is charged now.
    const dearer = (priceIn(target, row.currency, 'month') ?? 0n) > (priceIn(row.plan, row.currency, 'month') ?? 0n);
    const immediate = dearer || (interval === 'year' && current === 'month');
    if (paidUp && !immediate) {
      await this.update(row, { nextPlanCode: target.code === row.planCode ? null : target.code, nextInterval: interval === current ? null : interval });
      return this.present((await this.row(customer.id))!);
    }
    const credit = paidUp && row.periodStart && row.periodEnd ? unusedCredit(currentPrice, row.periodStart, row.periodEnd, now) : 0n;
    const due = targetPrice > credit ? targetPrice - credit : 0n;
    if (expectedAmount !== undefined && BigInt(expectedAmount) !== due) throw conflict('price_changed', 'The amount has changed: check it, then try again.', 'expected_amount');
    const end = periodEnd(now, interval);
    await this.charge(row, {
      kind: 'upgrade',
      plan: target,
      interval,
      price: targetPrice,
      credit,
      amount: due,
      start: now,
      end,
      data: { planCode: target.code, billingInterval: interval, periodStart: now, periodEnd: end, nextPlanCode: null, nextInterval: null, pastDueSince: null, lapsedPlanCode: null, trialEndsAt: null },
    });
    return this.present((await this.row(customer.id))!);
  }

  /** What was paid for the current period (its latest charge), else the plan's price now. */
  private async paidPrice(row: AccountRow) {
    const last = row.periodEnd ? await this.prisma.posCharge.findFirst({ where: { accountId: row.id, periodEnd: row.periodEnd }, orderBy: { createdAt: 'desc' } }) : null;
    return last ? last.priceMinor : (priceIn(row.plan, row.currency, row.billingInterval as BillingInterval) ?? 0n);
  }

  async charges(customer: CustomerWithStore) {
    const row = await this.own(customer);
    const charges = await this.prisma.posCharge.findMany({ where: { accountId: row.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const names = new Map((await this.plans()).map(plan => [plan.code, plan.name]));
    return { object: 'list' as const, data: charges.map(charge => this.presentCharge(charge, names.get(charge.planCode) ?? charge.planCode)) };
  }

  // ---- Shops and tills ----

  async addShop(customer: CustomerWithStore, input: ShopInput) {
    const row = await this.own(customer);
    this.requireRoom(row, 'shops', row.shops.length);
    await this.prisma.$transaction(async tx => {
      // A second shop starts the split: everything at the till so far is the first shop's.
      if (row.shops.length === 1) await startSplit(tx, row.customerId, row.shops[0]!.id);
      await this.createShop(tx, row.id, this.shopFields(input, true), row.shops.length);
    });
    return this.present((await this.row(customer.id))!);
  }

  async updateShop(customer: CustomerWithStore, shopId: string, input: Partial<ShopInput>) {
    const row = await this.own(customer);
    if (!row.shops.some(shop => shop.id === shopId)) throw missing();
    await this.prisma.$transaction(async tx => {
      await tx.posShop.update({ where: { id: shopId }, data: this.shopFields(input, false) });
      if (input.main === true) {
        // First in the list: every other shop moves one along.
        const others = row.shops.filter(shop => shop.id !== shopId);
        await tx.posShop.update({ where: { id: shopId }, data: { position: 0 } });
        for (const [index, shop] of others.entries()) await tx.posShop.update({ where: { id: shop.id }, data: { position: index + 1 } });
      }
      if (input.fulfils_online === true) {
        await tx.posShop.updateMany({ where: { accountId: row.id, fulfilsOnline: true, id: { not: shopId } }, data: { fulfilsOnline: false } });
        await tx.posShop.update({ where: { id: shopId }, data: { fulfilsOnline: true } });
      }
    });
    return this.present((await this.row(customer.id))!);
  }

  /**
   * Closes a shop (docs/UDOZO_POS_PLAN.md, milestone 9): its stock moves to another shop (`move_to_shop_id`) or online
   * (null), recorded as a transfer; it is kept for its history (sales, shifts, reports) but out of every list and limit;
   * its tills' devices are unlinked and everyone signed in at them signed out. Never the last shop (`last_shop`), nor with
   * a shift open at its tills (`shift_open`) or stock on its way to or from it (`transfers_in_transit`). With one shop
   * left the split ends: its stock is the listing's again.
   */
  async closeShop(customer: CustomerWithStore, shopId: string, input: { move_to_shop_id?: string | null }) {
    const row = await this.own(customer);
    const shop = row.shops.find(item => item.id === shopId);
    if (!shop) throw missing();
    if (row.shops.length <= 1) throw conflict('last_shop', 'Your only shop cannot close. Change plan or stop using Udozo POS instead.');
    const target = input.move_to_shop_id ?? null;
    if (target === shopId) throw invalid('parameter_invalid', 'Move its stock to another shop, or online.', 'move_to_shop_id');
    if (target && !row.shops.some(item => item.id === target)) throw missing();
    const tillIds = shop.tills.map(till => till.id);
    if (await this.prisma.posShift.count({ where: { tillId: { in: tillIds }, status: 'open' } })) throw conflict('shift_open', `Close the shifts open at ${shop.name}'s tills first.`);
    if (await this.prisma.posStockTransfer.count({ where: { accountId: row.id, status: 'in_transit', OR: [{ fromShopId: shopId }, { toShopId: shopId }] } })) throw conflict('transfers_in_transit', `Receive or cancel the stock on its way to or from ${shop.name} first.`);
    const now = new Date();
    const by = customer.name.slice(0, 120);
    const remaining = row.shops.filter(item => item.id !== shopId);
    await this.prisma.$transaction(async tx => {
      const levels = await tx.posStockLevel.findMany({ where: { shopId, quantity: { gt: 0 } }, include: { listing: { select: { title: true, stock: true } } } });
      const ids = levels.map(level => level.listingId).sort();
      if (ids.length) await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
      if (target) for (const level of levels) await changeLevel(tx, level.listingId, target, level.quantity, now);
      await tx.posStockLevel.deleteMany({ where: { shopId } });
      if (levels.length) {
        const lines = levels.map(level => ({ listing_id: level.listingId, title: level.listing.title ?? 'Untitled listing', quantity: level.quantity }));
        const made = await tx.posStockTransfer.create({ data: { accountId: row.id, fromShopId: shopId, toShopId: target, lines, note: `${shop.name} closed`, byName: by, status: 'received', receivedAt: now, receivedBy: by } });
        for (const level of levels) {
          const base = { accountId: row.id, listingId: level.listingId, transferId: made.id, stockAfter: level.listing.stock, note: `${shop.name} closed`, byCustomerId: customer.id, byName: customer.name };
          await tx.posStockMovement.createMany({ data: [{ ...base, shopId, reason: 'transfer_out', delta: -level.quantity }, { ...base, shopId: target, reason: 'transfer_in', delta: level.quantity }] });
        }
      }
      await tx.posShop.update({ where: { id: shopId }, data: { closedAt: now, closedBy: by, fulfilsOnline: false } });
      if (shop.fulfilsOnline) await tx.posShop.update({ where: { id: remaining[0]!.id }, data: { fulfilsOnline: true } });
      // One shop left: no split, its stock is the listing's.
      if (remaining.length === 1) await tx.posStockLevel.deleteMany({ where: { shop: { accountId: row.id } } });
      await tx.posDevice.updateMany({ where: { tillId: { in: tillIds }, revokedAt: null }, data: { revokedAt: now } });
      await tx.posStaffSession.updateMany({ where: { endedAt: null, OR: [{ tillId: { in: tillIds } }, { device: { tillId: { in: tillIds } } }] }, data: { endedAt: now, endedReason: 'shop_closed' } });
      await tx.posShopPrice.deleteMany({ where: { shopId } });
    });
    return this.present((await this.row(customer.id))!);
  }

  async addTill(customer: CustomerWithStore, shopId: string, input: TillInput) {
    const row = await this.own(customer);
    const shop = row.shops.find(item => item.id === shopId);
    if (!shop) throw missing();
    this.requireRoom(row, 'tills', row.shops.reduce((sum, item) => sum + item.tills.length, 0));
    const name = clean(input.name, 60) ?? `Till ${shop.tills.length + 1}`;
    await this.prisma.posTill.create({ data: { shopId, name, printerWidth: input.printer_width ?? 80, autoPrint: input.auto_print ?? false, position: shop.tills.length } });
    return this.present((await this.row(customer.id))!);
  }

  async updateTill(customer: CustomerWithStore, tillId: string, input: TillInput) {
    const row = await this.own(customer);
    if (!row.shops.some(shop => shop.tills.some(till => till.id === tillId))) throw missing();
    const name = clean(input.name, 60);
    await this.prisma.posTill.update({ where: { id: tillId }, data: { ...(name ? { name } : {}), ...(input.printer_width ? { printerWidth: input.printer_width } : {}), ...(input.auto_print !== undefined ? { autoPrint: input.auto_print } : {}) } });
    return this.present((await this.row(customer.id))!);
  }

  async removeTill(customer: CustomerWithStore, tillId: string) {
    const row = await this.own(customer);
    const shop = row.shops.find(item => item.tills.some(till => till.id === tillId));
    if (!shop) throw missing();
    if (shop.tills.length <= 1) throw conflict('last_till', 'A shop keeps at least one till.');
    await this.prisma.posTill.delete({ where: { id: tillId } });
    return this.present((await this.row(customer.id))!);
  }

  /** Refuses the next addition past the plan's limit; lowering a limit never removes anything already there. */
  private requireRoom(row: AccountRow, key: PosLimitKey, used: number) {
    const limit = limitsOf(row.plan)[key];
    if (limit !== null && used >= limit) {
      const what = { products: 'products at the till', shops: 'shops', tills: 'tills', staff: 'members of staff' }[key];
      throw conflict('pos_limit_reached', `${row.plan.name} allows ${limit} ${limit === 1 ? what.replace(/s\b/, '') : what}. Choose a bigger plan for more.`, key);
    }
  }

  private shopFields(input: Partial<ShopInput>, creating: boolean) {
    const name = clean(input.name, 80);
    if (creating && !name) throw invalid('parameter_missing', "Give your shop's name.", 'shop.name');
    if (input.vat_bps !== undefined && (!Number.isInteger(input.vat_bps) || input.vat_bps < 0 || input.vat_bps > 5000)) throw invalid('parameter_invalid', 'VAT is from 0% to 50%.', 'vat_bps');
    if (input.kind !== undefined && !isPosShopKind(input.kind)) throw invalid('parameter_invalid', 'Choose what kind of shop it is from the list.', 'kind');
    return {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(name ? { name } : {}),
      ...(input.address !== undefined ? { address: clean(input.address, 300) } : {}),
      ...(input.phone !== undefined ? { phone: clean(input.phone, 30) } : {}),
      ...(input.tin !== undefined ? { tin: clean(input.tin, 40) } : {}),
      ...(input.vat_bps !== undefined ? { vatBps: input.vat_bps } : {}),
      ...(input.receipt_footer !== undefined ? { receiptFooter: clean(input.receipt_footer, 300) } : {}),
      ...(input.email !== undefined ? { email: this.shopEmail(input.email) } : {}),
      ...(input.bank_name !== undefined ? { bankName: clean(input.bank_name, 80) } : {}),
      ...(input.bank_account_name !== undefined ? { bankAccountName: clean(input.bank_account_name, 120) } : {}),
      ...(input.bank_account_number !== undefined ? { bankAccountNumber: this.accountNumber(input.bank_account_number) } : {}),
      ...(input.receipt_qr !== undefined ? { receiptQr: input.receipt_qr } : {}),
    };
  }

  private shopEmail(value: string | null) {
    const email = clean(value, 254)?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw invalid('parameter_invalid', "Enter the shop's email address, or leave it empty.", 'email');
    return email;
  }

  private accountNumber(value: string | null) {
    const number = clean(value, 30)?.replace(/\s+/g, '') ?? null;
    if (number && !/^[0-9A-Z-]{5,30}$/i.test(number)) throw invalid('parameter_invalid', "Enter the shop's account number: digits only.", 'bank_account_number');
    return number;
  }

  private async createShop(tx: Prisma.TransactionClient, accountId: string, fields: ReturnType<PosService['shopFields']>, position: number) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const shopCode = shopCodeFor(fields.name ?? 'Shop');
      if (await tx.posShop.findUnique({ where: { shopCode }, select: { id: true } })) continue;
      // The first shop fulfils online orders until the owner chooses another.
      const shop = await tx.posShop.create({ data: { accountId, name: fields.name ?? 'My shop', ...fields, shopCode, position, fulfilsOnline: position === 0 } });
      await tx.posTill.create({ data: { shopId: shop.id, name: 'Till 1' } });
      return shop;
    }
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'shop_code_unavailable', 'We could not make a shop code just now. Try again.');
  }

  // ---- Charging ----

  private chargeEntry(input: { accountId: string; customerId: string; mode: LedgerMode; currency: string; amount: bigint; kind: string; start: Date; planName: string }) {
    return this.ledger.prepare({
      mode: input.mode,
      type: 'pos_plan',
      reference: `pos:${input.accountId}:${input.kind}:${input.start.toISOString()}`,
      description: `Udozo POS ${input.planName}`,
      lines: [
        { account: { kind: 'customer_wallet', currency: input.currency, customerId: input.customerId }, debit: input.amount },
        { account: { kind: 'pos_revenue', currency: input.currency }, credit: input.amount },
      ],
    });
  }

  /**
   * Takes a charge and changes the account in one transaction, claimed on the account's `updated_at` so two changes never
   * both win; a wallet that cannot pay leaves everything as it was (`wallet_balance_low`).
   */
  async charge(row: AccountRow, input: { kind: 'signup' | 'renewal' | 'upgrade'; plan: PosPlan; interval: BillingInterval; price: bigint; credit: bigint; amount: bigint; start: Date; end: Date; data: Prisma.PosAccountUncheckedUpdateManyInput }) {
    const entry = input.amount > 0n ? await this.chargeEntry({ accountId: row.id, customerId: row.customerId, mode: row.mode, currency: row.currency, amount: input.amount, kind: input.kind, start: input.start, planName: input.plan.name }) : null;
    const reference = entry?.reference ?? `pos:${row.id}:${input.kind}:${input.start.toISOString()}`;
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.posAccount.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: input.data });
        if (!claimed.count) throw changed();
        await tx.posCharge.create({ data: { accountId: row.id, planCode: input.plan.code, kind: input.kind, interval: input.interval, periodStart: input.start, periodEnd: input.end, priceMinor: input.price, creditMinor: input.credit, amountMinor: input.amount, currency: row.currency, mode: row.mode, reference } });
        if (entry) await this.ledger.write(tx, entry);
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw walletLow(input.amount, row.currency);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw changed();
      throw error;
    }
  }

  private async update(row: AccountRow, data: Prisma.PosAccountUncheckedUpdateManyInput) {
    const updated = await this.prisma.posAccount.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data });
    if (!updated.count) throw changed();
  }

  /** Tells the owner, in their udozo.com inbox (pushed) and by email linking to pos.udozo.com. Never fails the change. */
  tell(row: { customerId: string; id: string }, subject: string, title: string, body: string) {
    void this.inbox.customer({ customerId: row.customerId, storeId: houseStoreId }, 'customer.pos.plan', { subject: `pos:${row.id}:${subject}`, title, body }).catch(() => undefined);
    this.notices.customerAt(row.customerId, { title, body, path: '/app/billing', action: 'Open Udozo POS' }, this.config.POS_URL);
  }

  // ---- What the owner sees ----

  status(row: Pick<PosAccount, 'planCode' | 'trialEndsAt' | 'pastDueSince' | 'nextPlanCode'>, now = new Date()) {
    if (row.planCode === freePlan) return 'free' as const;
    if (row.pastDueSince) return 'past_due' as const;
    if (row.trialEndsAt && row.trialEndsAt > now) return 'trial' as const;
    if (row.nextPlanCode === freePlan) return 'cancelling' as const;
    return 'active' as const;
  }

  present(row: AccountRow) {
    return {
      object: 'pos_account' as const,
      id: row.id,
      country: row.country,
      currency: row.currency,
      mode: row.mode,
      status: this.status(row),
      plan: presentPlan(row.plan, row.currency),
      next_plan: row.nextPlanCode,
      /** `month` or `year`, and the interval taking over when the paid period ends. */
      billing_interval: row.billingInterval,
      next_interval: row.nextInterval,
      trial_ends_at: iso(row.trialEndsAt),
      period_start: iso(row.periodStart),
      period_end: iso(row.periodEnd),
      past_due_since: iso(row.pastDueSince),
      drops_to_free_at: row.pastDueSince ? new Date(row.pastDueSince.getTime() + days(graceDays)).toISOString() : null,
      lapsed_plan: row.lapsedPlanCode,
      limits: limitsOf(row.plan),
      shops: row.shops.map((shop, index, all) => ({
        object: 'pos_shop' as const,
        id: shop.id,
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        tin: shop.tin,
        shop_code: shop.shopCode,
        vat_bps: shop.vatBps,
        receipt_footer: shop.receiptFooter,
        email: shop.email,
        bank: shop.bankName || shop.bankAccountName || shop.bankAccountNumber ? { name: shop.bankName, account_name: shop.bankAccountName, account_number: shop.bankAccountNumber } : null,
        receipt_qr: shop.receiptQr,
        /** The main shop (first), the one online orders take from, and paused: past the plan's shop limit, it sells nothing. */
        main: index === 0,
        fulfils_online: shop.fulfilsOnline,
        paused: pausedShops(all, row.plan).has(shop.id),
        /** What kind of shop it is, and its categories that come first at the till. */
        kind: presentShopKind(shop.kind),
        tills: shop.tills.map(till => ({ object: 'pos_till' as const, id: till.id, name: till.name, printer_width: till.printerWidth, auto_print: till.autoPrint })),
      })),
      created_at: row.createdAt.toISOString(),
    };
  }

  presentCharge(charge: PosCharge, planName: string) {
    return {
      object: 'pos_charge' as const,
      id: charge.id,
      number: chargeNumber(charge.number),
      plan: { code: charge.planCode, name: planName },
      kind: charge.kind,
      interval: charge.interval,
      period_start: charge.periodStart.toISOString(),
      period_end: charge.periodEnd.toISOString(),
      price: Number(charge.priceMinor),
      credit: Number(charge.creditMinor),
      amount: Number(charge.amountMinor),
      currency: charge.currency,
      created_at: charge.createdAt.toISOString(),
    };
  }
}

export { withShops };
export type { AccountRow };
