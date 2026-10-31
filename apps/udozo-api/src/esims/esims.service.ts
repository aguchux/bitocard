import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PricingService } from '../catalogue/pricing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import { type Esim, type EsimTopUp, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import { insufficientFunds, type Line, LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { currencyNotHeld, WalletService, walletCurrencies } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { OrdersService } from '../orders/orders.service.js';
import { SupplierWebhooksService } from '../orders/supplier-webhooks.js';
import { ProviderError } from '../payments/provider-error.js';
import { dataAmount, type EsimNotice } from '../suppliers/esim-access.adapter.js';
import type { EsimState, EsimTopUpOption } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { EventsService } from '../webhooks/events.service.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such eSIM.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/** Usage is refreshed from the supplier when asked for and older than this (suppliers update it every few hours). */
const usageStaleMs = 10 * 60 * 1000;
/** An unclear top-up is asked again on this schedule (same reference), then left for an admin. */
const topUpRetryMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
/** States in which an eSIM can still take a top-up. */
const toppable = new Set(['ready', 'installed', 'active', 'used_up']);

const statusNames = ['ready', 'installed', 'active', 'used_up', 'expired', 'cancelled', 'revoked', 'suspended'] as const;
export type EsimStatus = (typeof statusNames)[number];

/** An option's public ID: a digest of the supplier's package, so its code is never shown. */
const optionId = (supplierPackage: string) => `opt_${createHash('sha256').update(supplierPackage).digest('hex').slice(0, 20)}`;

export function presentEsim(esim: Esim) {
  const total = esim.dataTotalBytes === null ? null : Number(esim.dataTotalBytes);
  const used = esim.dataUsedBytes === null ? null : Number(esim.dataUsedBytes);
  return {
    object: 'esim' as const,
    id: esim.id,
    order_id: esim.orderId,
    mode: esim.mode,
    iccid: esim.iccid,
    status: esim.status as EsimStatus,
    data: {
      /** Bytes; null for unlimited or not reported yet. */
      total,
      used,
      remaining: total !== null && used !== null ? Math.max(total - used, 0) : null,
      updated_at: esim.usageUpdatedAt?.toISOString() ?? null,
    },
    expires_at: esim.expiresAt?.toISOString() ?? null,
    top_ups: esim.topUps as 'none' | 'data' | 'days',
    /** Never installed: it can be cancelled for a refund (with every eSIM of its order). */
    cancellable: esim.status === 'ready',
    created_at: esim.createdAt.toISOString(),
    updated_at: esim.updatedAt.toISOString(),
  };
}

export function presentEsimTopUp(topUp: EsimTopUp, audience: 'reseller' | 'customer' = 'reseller') {
  return {
    object: 'esim_top_up' as const,
    id: topUp.id,
    esim_id: topUp.esimId,
    mode: topUp.mode,
    name: topUp.name,
    status: topUp.status as 'pending' | 'completed' | 'failed',
    /** What it cost: BitoCard's price to you, or for your customer what they paid. */
    amount: minor(audience === 'customer' || topUp.customerId ? topUp.priceMinor : topUp.wholesaleMinor),
    currency: topUp.currency,
    paid_by: topUp.customerId ? ('customer' as const) : ('reseller' as const),
    failure_reason: topUp.failureReason,
    created_at: topUp.createdAt.toISOString(),
    completed_at: topUp.completedAt?.toISOString() ?? null,
  };
}

type Payer = { kind: 'reseller' } | { kind: 'customer'; customerId: string; walletCurrency?: string };

/**
 * eSIMs after their order: their status, data use and expiry (from the supplier when asked, and its notifications),
 * top-ups and cancelling. An eSIM stays with the supplier that issued it.
 *
 * - **Top-ups** are the supplier's packages for that eSIM. The reseller pays BitoCard's wholesale price (the
 *   supplier's cost at today's rate plus BitoCard's margin for the product) from their wallet; a store's customer pays
 *   the reseller's price (their markup on it) from their own wallet (either currency), the margin going to the store's
 *   earnings. The money is held, the supplier asked with our reference, then taken; a refusal returns it. Unclear is not
 *   failed: the hold stays and the same top-up is asked again (`job`).
 * - **Cancelling** an order whose eSIMs were never installed cancels each with the supplier (which refunds BitoCard)
 *   and refunds the order as an admin refund would: to the reseller's wallet, or to the customer.
 */
@Injectable()
export class EsimsService implements OnModuleInit {
  private readonly logger = new Logger('Esims');

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: SupplierAdapters,
    private readonly pricing: PricingService,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly orders: OrdersService,
    private readonly events: EventsService,
    private readonly inbox: InboxService,
    private readonly supplierWebhooks: SupplierWebhooksService,
  ) {}

  onModuleInit() {
    this.supplierWebhooks.onEsimNotice((supplierCode, notice) => this.notice(supplierCode, notice));
  }

  private simulated(esim: Pick<Esim, 'mode' | 'supplierEsimId'>) {
    return esim.mode === 'test' || esim.supplierEsimId.startsWith('sandbox_');
  }

  private supplier(esim: Esim) {
    const supplier = this.adapters.get(esim.supplierCode).esims;
    if (!supplier) throw new ProviderError(esim.supplierCode, 'eSIMs cannot be managed with this supplier', true);
    return supplier;
  }

  // -- Reading -------------------------------------------------------------------------------------------------------

  private async find(resellerId: string, mode: LedgerMode, id: string) {
    const esim = await this.prisma.esim.findFirst({ where: { id, resellerId, mode } });
    if (!esim) throw notFound();
    return esim;
  }

  async list(resellerId: string, mode: LedgerMode, filter: { order_id?: string; limit?: number; starting_after?: string }, storeId?: string) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.esim.findMany({
      where: { resellerId, mode, ...(filter.order_id ? { orderId: filter.order_id } : {}), ...(storeId ? { order: { storeId } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(presentEsim), has_more: rows.length > limit };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    return presentEsim(await this.fresh(await this.find(resellerId, mode, id)));
  }

  /** An order's eSIMs, freshly read (its page, for the customer who proved it is theirs). */
  async forOrder(orderId: string) {
    const rows = await this.prisma.esim.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map(async row => presentEsim(await this.fresh(row))));
  }

  /** The eSIM with its status and usage read again from the supplier when they are stale (never fails the read). */
  private async fresh(esim: Esim) {
    if (this.simulated(esim) || ['cancelled', 'revoked'].includes(esim.status)) return esim;
    if (esim.usageUpdatedAt && Date.now() - esim.usageUpdatedAt.getTime() < usageStaleMs) return esim;
    try {
      const state = await this.supplier(esim).status(esim.supplierEsimId);
      return (await this.apply(esim, state, { usage: true })) ?? esim;
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', esimId: esim.id }, 'eSIM status not read');
      return esim;
    }
  }

  /** Saves what the supplier says; records `esim.updated` when it changed anything shown. Returns the saved eSIM. */
  private async apply(esim: Esim, state: Partial<EsimState>, options: { usage?: boolean } = {}) {
    const data: Prisma.EsimUpdateInput = {};
    if (state.status && (statusNames as readonly string[]).includes(state.status) && state.status !== esim.status) {
      // Never back to "ready" once on a phone, and never out of a final state by a late notification.
      const final = ['cancelled', 'revoked'].includes(esim.status);
      if (!final && !(state.status === 'ready' && esim.status !== 'ready')) {
        data.status = state.status;
        if (esim.status === 'ready' && state.status !== 'cancelled') data.installedAt = new Date();
      }
    }
    if (state.supplierStatus !== undefined && state.supplierStatus !== esim.supplierStatus) data.supplierStatus = state.supplierStatus;
    if (state.profileStatus !== undefined && state.profileStatus !== esim.profileStatus) data.profileStatus = state.profileStatus;
    if (state.totalBytes !== undefined && state.totalBytes !== null && state.totalBytes !== esim.dataTotalBytes) data.dataTotalBytes = state.totalBytes;
    if (state.usedBytes !== undefined && state.usedBytes !== null && state.usedBytes !== esim.dataUsedBytes) data.dataUsedBytes = state.usedBytes;
    if (state.expiresAt && state.expiresAt.getTime() !== esim.expiresAt?.getTime()) data.expiresAt = state.expiresAt;
    const shown = Object.keys(data).some(key => key !== 'supplierStatus' && key !== 'profileStatus');
    if (options.usage || state.usedBytes !== undefined) data.usageUpdatedAt = new Date();
    if (!Object.keys(data).length) return esim;
    const saved = await this.prisma.$transaction(async tx => {
      const updated = await tx.esim.update({ where: { id: esim.id }, data });
      if (shown) await this.events.record(tx, { resellerId: esim.resellerId, orderId: esim.orderId, mode: esim.mode, type: 'esim.updated', object: presentEsim(updated) });
      return updated;
    });
    if (shown) this.events.committed();
    return saved;
  }

  // -- Top-ups -------------------------------------------------------------------------------------------------------

  /** The top-ups the eSIM takes now, priced for whoever pays (`audience`). */
  private async options(esim: Esim): Promise<EsimTopUpOption[]> {
    if (!toppable.has(esim.status) || esim.topUps === 'none') return [];
    if (this.simulated(esim)) {
      // The sandbox offers two simulated top-ups priced like the eSIM itself.
      const offer = await this.prisma.supplierProduct.findFirst({ where: { productId: esim.productId, supplierCode: esim.supplierCode } });
      const cents = BigInt(Math.max(Math.ceil(Number((offer?.meta as Record<string, unknown> | null)?.price ?? 10_000) / 100), 100));
      return esim.topUps === 'days'
        ? [3, 7].map(days => ({ supplierPackage: `sandbox|${days}`, name: `More days: ${days}`, data: 'Same daily allowance', days, perDay: true, costMinor: cents * BigInt(days), costCurrency: 'USD' }))
        : [1, 3].map(gb => ({ supplierPackage: `sandbox|${gb}`, name: `${gb}GB more`, data: `${gb}GB`, days: 7, perDay: false, costMinor: cents * BigInt(gb), costCurrency: 'USD' }));
    }
    return this.supplier(esim).topUpOptions({ supplierEsimId: esim.supplierEsimId, iccid: esim.iccid });
  }

  /** Each option's prices: BitoCard's wholesale (what the reseller pays) and the reseller's price to their customer. */
  private async priced(esim: Esim, options: EsimTopUpOption[]) {
    if (!options.length) return [];
    const [ctx, product] = await Promise.all([this.pricing.context(esim.resellerId, esim.mode), this.prisma.product.findUniqueOrThrow({ where: { id: esim.productId } })]);
    return Promise.all(
      options.map(async option => {
        const { wholesale, currency } = await this.pricing.wholesaleFor(ctx, product, option.costMinor, option.costCurrency, esim.supplierCode);
        const price = this.pricing.resellerPrice(ctx, product, wholesale);
        return { option, id: optionId(option.supplierPackage), wholesale, price, currency };
      }),
    );
  }

  private presentOption(item: Awaited<ReturnType<EsimsService['priced']>>[number], audience: 'reseller' | 'customer') {
    return {
      object: 'esim_top_up_option' as const,
      id: item.id,
      name: item.option.name,
      data: item.option.data,
      days: item.option.days,
      amount: minor(audience === 'reseller' ? item.wholesale : item.price),
      currency: item.currency,
    };
  }

  async resellerOptions(resellerId: string, mode: LedgerMode, id: string) {
    const esim = await this.find(resellerId, mode, id);
    const priced = await this.priced(esim, await this.options(esim));
    return { object: 'list' as const, data: priced.map(item => this.presentOption(item, 'reseller')) };
  }

  async resellerTopUp(resellerId: string, mode: LedgerMode, id: string, input: { option_id: string }) {
    const esim = await this.find(resellerId, mode, id);
    return presentEsimTopUp(await this.topUp(esim, input.option_id, { kind: 'reseller' }));
  }

  async resellerTopUps(resellerId: string, mode: LedgerMode, id: string) {
    const esim = await this.find(resellerId, mode, id);
    const rows = await this.prisma.esimTopUp.findMany({ where: { esimId: esim.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { object: 'list' as const, data: rows.map(row => presentEsimTopUp(row)) };
  }

  /** The order's eSIM, for its customer (the order's page): only orders a store customer bought can be topped up by them. */
  private async customerEsim(order: { id: string; customerId: string | null }, esimId: string) {
    const esim = await this.prisma.esim.findFirst({ where: { id: esimId, orderId: order.id } });
    if (!esim) throw notFound();
    return esim;
  }

  async customerOptions(order: { id: string; customerId: string | null }, esimId: string) {
    const esim = await this.customerEsim(order, esimId);
    if (!order.customerId) return { object: 'list' as const, data: [], wallets: [], available: false };
    const priced = await this.priced(esim, await this.options(esim));
    const currency = priced[0]?.currency ?? (await this.wallets.currencyOf(esim.resellerId)).currency;
    const wallets = await Promise.all(
      walletCurrencies(currency).map(async code => ({ currency: code, primary: code === currency, balance: minor(await this.customerBalance(order.customerId!, esim.mode, code)) })),
    );
    const data = await Promise.all(
      priced.map(async item => ({
        ...this.presentOption(item, 'customer'),
        /** What it costs from each wallet: the price, and in US dollars at BitoCard's rate (rounded up; null while unavailable). */
        prices: await Promise.all(
          walletCurrencies(item.currency).map(async code => ({
            currency: code,
            amount: code === item.currency ? minor(item.price) : ((await this.fx.usdCovering(item.price, item.currency).catch(() => null))?.amount ?? null),
          })),
        ),
      })),
    );
    return { object: 'list' as const, data: data.map(item => ({ ...item, prices: item.prices.map(price => ({ currency: price.currency, amount: price.amount === null ? null : minor(price.amount) })) })), wallets, available: true };
  }

  async customerTopUp(order: { id: string; customerId: string | null }, esimId: string, input: { option_id: string; wallet_currency?: string }) {
    if (!order.customerId) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'top_up_by_store', 'Ask the store you bought it from to top this eSIM up.');
    }
    const esim = await this.customerEsim(order, esimId);
    return presentEsimTopUp(await this.topUp(esim, input.option_id, { kind: 'customer', customerId: order.customerId, walletCurrency: input.wallet_currency }), 'customer');
  }

  private async customerBalance(customerId: string, mode: LedgerMode, currency: string) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId, mode, currency }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  /**
   * Starts a top-up: the price is paid (the customer's wallet into the store's `customer_payments`) or held (the
   * reseller's wallet), the wholesale held, then the supplier asked. Returns the top-up as it stands.
   */
  private async topUp(esim: Esim, chosen: string, payer: Payer) {
    if (!toppable.has(esim.status)) throw conflict('esim_not_active', 'This eSIM can no longer be topped up.');
    const priced = await this.priced(esim, await this.options(esim));
    const item = priced.find(entry => entry.id === chosen);
    if (!item) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'option_unavailable', 'This top-up is not available for this eSIM. List the top-ups again.', 'option_id');
    const id = randomUUID();
    const customer = payer.kind === 'customer';
    let walletCurrency: string | null = null;
    let walletAmount: bigint | null = null;
    let payment: Awaited<ReturnType<LedgerService['prepare']>> | null = null;
    if (customer) {
      walletCurrency = (payer.walletCurrency ?? item.currency).toUpperCase();
      if (!walletCurrencies(item.currency).includes(walletCurrency)) throw currencyNotHeld(walletCurrency);
      walletAmount = walletCurrency === item.currency ? item.price : (await this.fx.usdCovering(item.price, item.currency)).amount;
      payment = await this.ledger.prepare({
        mode: esim.mode,
        type: 'esim_top_up_payment',
        reference: `esim_top_up_payment:${id}`,
        resellerId: esim.resellerId,
        description: `eSIM top-up paid from wallet: ${item.option.name}`,
        metadata: { esim_top_up_id: id },
        lines: this.paymentLines(esim, payer.customerId, item.price, item.currency, walletCurrency, walletAmount),
      });
    }
    try {
      await this.prisma.$transaction(async tx => {
        await tx.esimTopUp.create({
          data: {
            id,
            esimId: esim.id,
            resellerId: esim.resellerId,
            customerId: customer ? payer.customerId : null,
            mode: esim.mode,
            reference: `bc_tu_${id.replaceAll('-', '').slice(0, 24)}`,
            supplierPackage: item.option.supplierPackage,
            name: item.option.name,
            days: item.option.perDay ? item.option.days : null,
            costMinor: item.option.costMinor,
            costCurrency: item.option.costCurrency,
            wholesaleMinor: item.wholesale,
            priceMinor: customer ? item.price : item.wholesale,
            currency: item.currency,
            ...(customer && walletCurrency !== item.currency ? { walletCurrency, walletAmountMinor: walletAmount } : {}),
          },
        });
        if (payment) await this.ledger.write(tx, payment);
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds' && customer) {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Your wallet is too low: this top-up costs ${formatMoney(walletAmount!, walletCurrency!)}.`);
      }
      throw error;
    }
    try {
      const hold = await this.wallets.hold({ resellerId: esim.resellerId, mode: esim.mode, amount: item.wholesale, reference: `esim_top_up:${id}`, description: `eSIM top-up: ${item.option.name}`, from: customer ? 'customer' : 'wallet' });
      await this.prisma.esimTopUp.update({ where: { id }, data: { holdId: hold.id } });
    } catch (error) {
      await this.fail(id, 'Your wallet could not cover the top-up.');
      throw error instanceof ApiError ? error : insufficientFunds();
    }
    await this.run(id);
    return this.prisma.esimTopUp.findUniqueOrThrow({ where: { id } });
  }

  /** What leaves the customer's wallet (converted from US dollars at BitoCard's rate) into the store's `customer_payments`. */
  private paymentLines(esim: Esim, customerId: string, price: bigint, currency: string, walletCurrency: string, walletAmount: bigint): Line[] {
    const into: Line = { account: { kind: 'customer_payments', currency, resellerId: esim.resellerId }, credit: price };
    if (walletCurrency === currency) return [{ account: { kind: 'customer_wallet', currency, customerId }, debit: price }, into];
    return [
      { account: { kind: 'customer_wallet', currency: walletCurrency, customerId }, debit: walletAmount },
      { account: { kind: 'currency_exchange', currency: walletCurrency }, credit: walletAmount },
      { account: { kind: 'currency_exchange', currency }, debit: price },
      into,
    ];
  }

  /**
   * Asks the supplier for a pending top-up (again, with the same reference, after an unclear answer). Completed: the
   * wholesale is taken, the supplier cost booked and, paid by a customer, the margin goes to the store's earnings.
   * Refused: the money goes back. Unclear: tried again later; after the last try an admin looks.
   */
  async run(id: string) {
    const topUp = await this.prisma.esimTopUp.findUnique({ where: { id }, include: { esim: true } });
    if (!topUp || topUp.status !== 'pending' || !topUp.holdId) return;
    const { esim } = topUp;
    let state: EsimState | null;
    try {
      if (this.simulated(esim)) {
        const [, amount] = topUp.supplierPackage.split('|');
        const addBytes = topUp.days ? 0n : BigInt(Number(amount) || 1) * 1024n ** 3n;
        const days = topUp.days ?? 7;
        state = {
          status: esim.status === 'used_up' ? 'active' : esim.status,
          supplierStatus: esim.supplierStatus,
          profileStatus: esim.profileStatus,
          totalBytes: esim.dataTotalBytes === null ? null : esim.dataTotalBytes + addBytes,
          usedBytes: esim.dataUsedBytes,
          expiresAt: new Date((esim.expiresAt ?? new Date()).getTime() + days * 24 * 60 * 60 * 1000),
        };
      } else {
        state = await this.supplier(esim).topUp({ supplierEsimId: esim.supplierEsimId, supplierPackage: topUp.supplierPackage, reference: topUp.reference, costMinor: topUp.costMinor, days: topUp.days });
      }
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        this.logger.warn({ err: error.message, topUpId: id }, 'eSIM top-up refused');
        await this.fail(id, 'The top-up could not be added. Nothing was charged.');
        return;
      }
      const attempts = topUp.attempts + 1;
      const wait = topUpRetryMs[attempts - 1];
      await this.prisma.esimTopUp.update({ where: { id }, data: { attempts, nextCheckAt: wait ? new Date(Date.now() + wait) : null } });
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', topUpId: id, attempts }, 'eSIM top-up unclear; asked again later');
      if (!wait) {
        await this.inbox.admins('admin.esim.top_up_unclear', {
          subject: id,
          title: 'An eSIM top-up needs checking',
          body: `A top-up (${topUp.name}) for an eSIM from ${esim.supplierCode} is still unconfirmed after every retry. Check it in the supplier's console, then settle it by hand.`,
          link: `/orders/${esim.orderId}`,
          mode: esim.mode,
        });
      }
      return;
    }
    const claimed = await this.prisma.esimTopUp.updateMany({ where: { id, status: 'pending' }, data: { status: 'completed', completedAt: new Date(), nextCheckAt: null } });
    if (claimed.count === 0) return;
    await this.wallets.captureHold(topUp.holdId, `eSIM top-up: ${topUp.name}`);
    const costReference = `esim_top_up_cost:${id}`;
    if (!this.simulated(esim) && topUp.costMinor > 0n && !(await this.prisma.journalEntry.findUnique({ where: { reference: costReference } }))) {
      await this.ledger.post({
        mode: esim.mode,
        type: 'order_cost',
        reference: costReference,
        description: `Supplier cost: eSIM top-up (${topUp.name})`,
        metadata: { esim_top_up_id: id, supplier: esim.supplierCode },
        lines: [
          { account: { kind: 'cost_of_sales', currency: topUp.costCurrency, provider: esim.supplierCode }, debit: topUp.costMinor },
          { account: { kind: 'supplier_float', currency: topUp.costCurrency, provider: esim.supplierCode }, credit: topUp.costMinor },
        ],
      });
    }
    if (topUp.customerId && topUp.priceMinor > topUp.wholesaleMinor) {
      await this.wallets.creditEarnings({
        resellerId: esim.resellerId,
        mode: esim.mode,
        amount: topUp.priceMinor - topUp.wholesaleMinor,
        reference: `esim_top_up_earnings:${id}`,
        description: `eSIM top-up sold: ${topUp.name}`,
        source: { kind: 'customer_payments', currency: topUp.currency, resellerId: esim.resellerId },
      });
    }
    if (state) await this.apply(await this.prisma.esim.findUniqueOrThrow({ where: { id: esim.id } }), { ...state, status: state.status === 'used_up' ? 'active' : state.status }, { usage: true });
  }

  /** A top-up that will not happen: the hold returned and, paid by a customer, their money back exactly as it left. */
  private async fail(id: string, reason: string) {
    const claimed = await this.prisma.esimTopUp.updateMany({ where: { id, status: 'pending' }, data: { status: 'failed', failureReason: reason, completedAt: new Date(), nextCheckAt: null } });
    if (claimed.count === 0) return;
    const topUp = await this.prisma.esimTopUp.findUniqueOrThrow({ where: { id }, include: { esim: true } });
    if (topUp.holdId) await this.wallets.releaseHold(topUp.holdId, `eSIM top-up not added: ${topUp.name}`);
    if (topUp.customerId && (await this.prisma.journalEntry.findUnique({ where: { reference: `esim_top_up_payment:${id}` } }))) {
      const walletCurrency = topUp.walletCurrency ?? topUp.currency;
      const walletAmount = topUp.walletAmountMinor ?? topUp.priceMinor;
      const lines = this.paymentLines(topUp.esim, topUp.customerId, topUp.priceMinor, topUp.currency, walletCurrency, walletAmount).map(line =>
        line.debit !== undefined ? { account: line.account, credit: line.debit } : { account: line.account, debit: line.credit! },
      );
      await this.ledger.post({
        mode: topUp.mode,
        type: 'esim_top_up_refund',
        reference: `esim_top_up_refund:${id}`,
        resellerId: topUp.resellerId,
        description: `eSIM top-up refunded: ${topUp.name}`,
        metadata: { esim_top_up_id: id },
        lines,
      });
    }
  }

  /** The `esims` job: asks again about top-ups the supplier left unclear. */
  async job() {
    const due = await this.prisma.esimTopUp.findMany({ where: { status: 'pending', nextCheckAt: { lte: new Date() } }, select: { id: true }, take: 50 });
    for (const { id } of due) await this.run(id).catch(error => this.logger.error({ err: error, topUpId: id }, 'eSIM top-up check failed'));
    return { checked: due.length };
  }

  // -- Cancelling ----------------------------------------------------------------------------------------------------

  async resellerCancel(resellerId: string, mode: LedgerMode, id: string) {
    const esim = await this.find(resellerId, mode, id);
    return this.cancel(esim.orderId);
  }

  async customerCancel(order: { id: string }, esimId: string) {
    await this.customerEsim({ id: order.id, customerId: null }, esimId);
    return this.cancel(order.id);
  }

  /**
   * Cancels every eSIM of an order none of which was ever installed (each read again from the supplier first), then
   * refunds the order in full. Refused when any was installed: a used eSIM cannot be returned.
   */
  private async cancel(orderId: string) {
    const rows = await this.prisma.esim.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    if (!rows.length) throw notFound();
    const current = await Promise.all(rows.map(row => this.freshNow(row)));
    if (current.some(row => row.status !== 'ready' && row.status !== 'cancelled')) {
      throw conflict('esim_in_use', 'An eSIM that was installed cannot be cancelled. Only orders whose eSIMs were never installed can be refunded.');
    }
    for (const esim of current.filter(row => row.status === 'ready')) {
      if (!this.simulated(esim)) {
        try {
          await this.supplier(esim).cancel(esim.supplierEsimId);
        } catch (error) {
          this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', esimId: esim.id }, 'eSIM not cancelled');
          throw conflict('esim_not_cancellable', 'This eSIM cannot be cancelled now. Contact support if it was never installed.');
        }
      }
      await this.apply(esim, { status: 'cancelled', supplierStatus: 'CANCEL' });
      await this.prisma.esim.update({ where: { id: esim.id }, data: { cancelledAt: new Date() } });
    }
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === 'completed') await this.orders.refund(null, orderId, { reason: 'eSIM cancelled before it was installed', supplier_refunded: true });
    const after = await this.prisma.esim.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: after.map(presentEsim), refunded: true };
  }

  /** Read again from the supplier now (cancelling must not trust a stale "ready"). */
  private async freshNow(esim: Esim) {
    if (this.simulated(esim) || ['cancelled', 'revoked'].includes(esim.status)) return esim;
    const state = await this.supplier(esim).status(esim.supplierEsimId);
    return (await this.apply(esim, state, { usage: true })) ?? esim;
  }

  // -- Supplier notifications ----------------------------------------------------------------------------------------

  /**
   * A supplier's notification about one eSIM: its status, data use or expiry saved, and the customer told once when
   * little data is left (20% or less) or it is about to expire. Unknown eSIMs are ignored.
   */
  async notice(supplierCode: string, notice: EsimNotice) {
    const esim = await this.prisma.esim.findUnique({ where: { supplierCode_supplierEsimId: { supplierCode, supplierEsimId: notice.supplierEsimId } } });
    if (!esim) return { matched: false };
    const saved = (await this.apply(esim, notice.state, { usage: notice.kind === 'usage' })) ?? esim;
    if (notice.kind === 'usage' && notice.remaining !== null && notice.remaining <= 0.2) {
      const percent = Math.round(notice.remaining * 100);
      const claimed = await this.prisma.esim.updateMany({ where: { id: esim.id, OR: [{ lowDataNotified: null }, { lowDataNotified: { gt: percent } }] }, data: { lowDataNotified: percent } });
      if (claimed.count === 1) {
        const left = saved.dataTotalBytes !== null && saved.dataUsedBytes !== null ? dataAmount(Number(saved.dataTotalBytes - saved.dataUsedBytes)) : `${percent}%`;
        await this.tellCustomer(saved, 'customer.esim.low_data', `${saved.iccid}:data:${percent}`, `Your eSIM has ${left} of data left`, 'Top it up on your order page before you run out.');
      }
    }
    if (notice.kind === 'validity') {
      const claimed = await this.prisma.esim.updateMany({ where: { id: esim.id, expiryNotified: null }, data: { expiryNotified: new Date() } });
      if (claimed.count === 1) {
        await this.tellCustomer(saved, 'customer.esim.expiring', `${saved.iccid}:expiry:${saved.expiresAt?.toISOString() ?? ''}`, 'Your eSIM expires soon', 'Its plan ends within a day. Top it up on your order page to keep using it.');
      }
    }
    return { matched: true };
  }

  private async tellCustomer(esim: Esim, type: 'customer.esim.low_data' | 'customer.esim.expiring', subject: string, title: string, body: string) {
    const order = await this.prisma.order.findUnique({ where: { id: esim.orderId }, select: { customerId: true, customer: { select: { storeId: true } } } });
    if (!order?.customerId || !order.customer) return;
    const checkout = await this.prisma.checkout.findUnique({ where: { orderId: esim.orderId }, select: { id: true } });
    await this.inbox.customer({ customerId: order.customerId, storeId: order.customer.storeId }, type, {
      subject,
      title,
      body,
      link: checkout ? `/account/orders/${checkout.id}` : '/account/orders',
      mode: esim.mode,
    });
  }
}
