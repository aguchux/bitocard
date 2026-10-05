import { randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { offersInclude } from '../catalogue/catalogue.service.js';
import { PricingService } from '../catalogue/pricing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Order, OrderDelivery, OrderStatus, Product, ProductCategory } from '../generated/prisma/client.js';
import { LedgerService, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { resellerNotVerified, testModeOnly } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import type { Delivery, FulfilmentRequest, FulfilmentResult } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { EventsService } from '../webhooks/events.service.js';
import { PlatformFeesService } from '../fees/platform-fees.service.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { OwnSuppliersService } from '../reseller-integrations/own-suppliers.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { sellerFor } from './seller.js';

/** When to check an unconfirmed order again, after each check. After the last, it joins the exception queue. */
export const checkScheduleMs = [30, 60, 120, 300, 600, 1800, 3600, 7200, 14_400, 28_800].map(seconds => seconds * 1000);
/** Orders in the exception queue are still checked, this often, until an admin resolves them. */
const reviewCheckMs = 6 * 3600 * 1000;

type OrderWithProduct = Order & { product: Product };
type RecipientRecord = { phone?: string; account_number?: string; transaction_type?: string; [detail: string]: string | undefined };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/** The supplier reference for one attempt: the Lagos date and time first (VTpass requires it), then random hex. */
export function supplierReference(now = new Date()) {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const stamp = lagos.toISOString().replace(/[^0-9]/g, '').slice(0, 12);
  return `${stamp}BC${randomBytes(8).toString('hex')}`;
}

export const receiptNumber = (number: number | null) => (number === null ? null : `BC-${String(number).padStart(6, '0')}`);

/**
 * Orders. The wholesale cost and tax are held from the wallet, the routed supplier fulfils, and the hold is taken
 * only when the supplier confirms. Unclear outcomes are checked again with the same supplier on a schedule and
 * reach the admin exception queue if they stay unclear; a definite failure tries another supplier that can honour
 * the quote, and otherwise releases the hold.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly pricing: PricingService,
    private readonly adapters: SupplierAdapters,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly fees: PlatformFeesService,
    private readonly own: OwnSuppliersService,
    private readonly inbox: InboxService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  // -- Presenting ------------------------------------------------------------------------------------------------

  /** Deliveries (codes, PINs, tokens) are included only when `withSecrets` is set: the single-order view. */
  present(order: OrderWithProduct & { deliveries?: OrderDelivery[] }, withSecrets = false) {
    const encryption = withSecrets && order.deliveries?.length ? this.encryption() : null;
    const own = order.source === 'own';
    return {
      object: 'order' as const,
      id: order.id,
      mode: order.mode,
      status: order.status,
      quote_id: order.quoteId,
      product: { id: order.product.id, name: order.product.name, category: order.product.category },
      face_value: minor(order.faceValueMinor),
      face_currency: order.faceCurrency,
      quantity: order.quantity,
      currency: order.currency,
      wholesale: minor(order.wholesaleMinor),
      tax: minor(order.taxMinor),
      /**
       * Taken from the wallet: wholesale plus tax (BitoCard is the seller of record and pays the tax); for your own
       * supplier, only BitoCard's fee (the most it can be while processing, then what was charged).
       */
      charged: minor(own ? (order.feeMinor ?? 0n) : order.wholesaleMinor + order.taxMinor),
      price: minor(order.priceMinor),
      reseller_profit: minor(order.resellerProfitMinor),
      recipient: order.recipient as RecipientRecord | null,
      customer_reference: order.customerReference,
      /** `own`: fulfilled through your own supplier account (you are the seller); `bitocard` otherwise. */
      source: order.source as 'bitocard' | 'own',
      integration: own ? { id: order.supplierCode, name: connectable(order.supplierCode)?.name ?? order.supplierCode } : null,
      ...(withSecrets
        ? {
            deliveries: (order.deliveries ?? []).map(d => ({
              kind: d.kind,
              code: d.codeEncrypted && encryption ? encryption.decrypt(d.codeEncrypted) : null,
              pin: d.pinEncrypted && encryption ? encryption.decrypt(d.pinEncrypted) : null,
              serial: d.serial,
              details: d.details ?? {},
            })),
          }
        : {}),
      failure_reason: order.failureReason,
      receipt_number: receiptNumber(order.receiptNumber),
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
      completed_at: order.completedAt?.toISOString() ?? null,
    };
  }

  /** The order as the reseller sees it, without delivered codes: webhooks never carry secrets. */
  private async recordEvent(tx: Tx, type: 'order.completed' | 'order.failed' | 'order.refunded', id: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { product: true } });
    await this.events.record(tx, { resellerId: order.resellerId, mode: order.mode, type, object: this.present(order) });
  }

  private load(id: string) {
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: { product: true, deliveries: true } });
  }

  // -- Reseller API ----------------------------------------------------------------------------------------------

  async create(resellerId: string, mode: LedgerMode, input: { quote_id: string; simulate?: 'completed' | 'failed' | 'pending' }) {
    if (input.simulate && mode !== 'test') throw testModeOnly();
    const quote = await this.prisma.quote.findFirst({ where: { id: input.quote_id, resellerId, mode }, include: { product: true } });
    if (!quote) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'resource_missing', 'No such quote.', 'quote_id');
    if (quote.status === 'used') throw conflict('quote_used', 'This quote has already been used for an order. Create a new quote.');
    if (quote.expiresAt <= new Date()) throw conflict('quote_expired', 'This quote has expired. Create a new quote.');
    if (mode === 'live') {
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
      if (reseller.status !== 'active') throw resellerNotVerified();
    }

    const id = randomUUID();
    const own = quote.source === 'own';
    let hold: { id: string } | null = null;
    let fee: { id: string; heldMinor: bigint } | null = null;
    if (own) {
      // The reseller's own supplier: BitoCard holds only its fee, at the rate the quote locked.
      const connection = quote.connectionId ? await this.prisma.resellerConnection.findUnique({ where: { id: quote.connectionId } }) : null;
      if (connection?.status !== 'active') throw conflict('integration_unavailable', 'Your supplier account is no longer connected. Create a new quote.');
      fee = await this.fees.hold({
        resellerId,
        mode,
        kind: 'supplier_order',
        category: quote.product.category,
        baseMinor: quote.feeBaseMinor ?? 0n,
        source: { type: 'order', id },
        description: `Order: ${quote.product.name}`,
        locked: { ruleId: quote.feeRuleId, ratePpb: quote.feeRatePpb ?? 0, minFeeMinor: quote.feeMinMinor },
      });
    } else {
      hold = await this.wallets.hold({ resellerId, mode, amount: quote.wholesaleMinor + quote.taxMinor, reference: `order:${id}`, description: `Order: ${quote.product.name}` });
    }
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.quote.updateMany({ where: { id: quote.id, status: 'open', expiresAt: { gt: new Date() } }, data: { status: 'used' } });
        if (claimed.count === 0) throw conflict('quote_used', 'This quote has already been used for an order. Create a new quote.');
        await tx.order.create({
          data: {
            id,
            resellerId,
            mode,
            quoteId: quote.id,
            productId: quote.productId,
            quantity: quote.quantity,
            faceValueMinor: quote.faceValueMinor,
            faceCurrency: quote.faceCurrency,
            currency: quote.currency,
            wholesaleMinor: quote.wholesaleMinor,
            taxMinor: quote.taxMinor,
            priceMinor: quote.priceMinor,
            resellerProfitMinor: quote.resellerProfitMinor,
            recipient: quote.recipient ?? undefined,
            customerReference: quote.customerReference,
            holdId: hold?.id ?? null,
            source: quote.source,
            connectionId: quote.connectionId,
            feeChargeId: fee?.id ?? null,
            feeMinor: fee?.heldMinor ?? null,
            supplierCode: quote.supplierCode,
            supplierProductId: quote.supplierProductId,
            supplierCostMinor: quote.supplierCostMinor,
            supplierCurrency: quote.supplierCurrency,
            supplierReference: supplierReference(),
            simulate: mode === 'test' ? (input.simulate ?? 'completed') : null,
            // If this request dies before recording an outcome, the scheduled check still picks the order up.
            nextCheckAt: new Date(Date.now() + checkScheduleMs[0]),
          },
        });
      });
    } catch (error) {
      if (hold) await this.wallets.releaseHold(hold.id, 'Order not placed: funds released');
      if (fee) await this.fees.release(fee.id);
      throw error;
    }
    const order = await this.attempt(id, 'place');
    return this.present(order, true);
  }

  async list(resellerId: string, mode: LedgerMode, filter: { status?: OrderStatus; customer_reference?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const orders = await this.prisma.order.findMany({
      where: { resellerId, mode, status: filter.status, customerReference: filter.customer_reference },
      include: { product: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: orders.slice(0, limit).map(order => this.present(order)), has_more: orders.length > limit };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, resellerId, mode }, include: { product: true, deliveries: true } });
    if (!order) throw notFound();
    return this.present(order, true);
  }

  /** The customer receipt: BitoCard (the regional Golojan entity) as seller of record, under the reseller's store brand. */
  async receipt(resellerId: string, mode: LedgerMode, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, resellerId, mode }, include: { product: true, reseller: { include: { stores: true } } } });
    if (!order) throw notFound();
    if (order.source === 'own') throw conflict('receipt_unavailable', 'You are the seller of orders through your own supplier, so BitoCard does not issue their receipts.');
    if (order.status !== 'completed' || order.receiptNumber === null) throw conflict('receipt_unavailable', 'Receipts are issued for completed orders.');
    const seller = sellerFor(order.reseller.country ?? 'NG');
    const taxBreakdown = order.taxMinor > 0n ? ((await this.prisma.quote.findUnique({ where: { id: order.quoteId } })) ?? null) : null;
    const unit = order.priceMinor / BigInt(order.quantity);
    return {
      object: 'receipt' as const,
      number: receiptNumber(order.receiptNumber),
      order_id: order.id,
      mode: order.mode,
      issued_at: (order.completedAt ?? order.updatedAt).toISOString(),
      seller: { name: seller.name, [seller.companyNumberLabel.toLowerCase().replaceAll(' ', '_')]: seller.companyNumber, registered_address: seller.registeredAddress },
      sold_through: order.reseller.stores[0]?.name ?? order.reseller.name,
      currency: order.currency,
      items: [{ description: order.product.name, quantity: order.quantity, unit_price: minor(unit), amount: minor(order.priceMinor) }],
      subtotal: minor(order.priceMinor - order.taxMinor),
      tax: taxBreakdown ? { name: taxBreakdown.taxName, rate_percent: (taxBreakdown.taxRateBps ?? 0) / 100, amount: minor(order.taxMinor) } : null,
      total: minor(order.priceMinor),
      customer_reference: order.customerReference,
    };
  }

  async simulate(resellerId: string, mode: LedgerMode, id: string, outcome: 'completed' | 'failed') {
    if (mode !== 'test') throw testModeOnly();
    const order = await this.prisma.order.findFirst({ where: { id, resellerId, mode: 'test' } });
    if (!order) throw notFound();
    if (order.status !== 'processing') return this.present(await this.load(id), true);
    await this.prisma.order.update({ where: { id }, data: { simulate: outcome } });
    return this.present(await this.attempt(id, 'check'), true);
  }

  // -- Fulfilment ------------------------------------------------------------------------------------------------

  private async request(order: OrderWithProduct): Promise<FulfilmentRequest> {
    const offer =
      order.source === 'own'
        ? await this.prisma.resellerOffer.findUniqueOrThrow({ where: { id: order.supplierProductId } })
        : await this.prisma.supplierProduct.findUniqueOrThrow({ where: { id: order.supplierProductId } });
    return {
      reference: order.supplierReference,
      sku: offer.sku,
      meta: (offer.meta ?? {}) as Record<string, unknown>,
      category: order.product.category,
      country: order.product.country,
      faceValue: order.faceValueMinor,
      faceCurrency: order.faceCurrency,
      quantity: order.quantity,
      recipient: (order.recipient ?? {}) as FulfilmentRequest['recipient'],
    };
  }

  /** The sandbox never calls suppliers: it delivers realistic test items, or the outcome chosen with `simulate`. */
  private sandboxResult(order: OrderWithProduct): FulfilmentResult {
    if (order.simulate === 'failed') return { status: 'failed', detail: 'Simulated failure' };
    if (order.simulate === 'pending') return { status: 'pending', detail: 'Simulated pending' };
    return { status: 'completed', supplierTransactionId: `sandbox_${order.supplierReference}`, deliveries: sandboxDeliveries(order.product.category, order.quantity) };
  }

  /**
   * Calls the supplier (to place the order, or to check it) and applies what comes back. An unscheduled check (a
   * supplier notification) leaves the order's check schedule alone, so notifications never hurry it into the exception queue.
   */
  async attempt(id: string, action: 'place' | 'check', options: { scheduled?: boolean } = {}) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { product: true } });
    if (order.status !== 'processing') return this.load(id);
    let result: FulfilmentResult;
    if (order.mode === 'test') {
      result = this.sandboxResult(order);
    } else {
      // The reseller's own orders go through their own account, and only theirs.
      const adapter = order.source === 'own' ? await this.own.adapterFor(order.resellerId, order.supplierCode) : this.adapters.get(order.supplierCode);
      const request = await this.request(order);
      try {
        if (!adapter) throw new ProviderError(order.supplierCode, 'your supplier account is no longer connected', action === 'place');
        if (action === 'place') {
          if (!adapter.placeOrder) throw new ProviderError(order.supplierCode, 'ordering not supported', true);
          result = await adapter.placeOrder(request);
        } else {
          result = adapter.orderStatus ? await adapter.orderStatus(request, order.supplierTransactionId ?? undefined) : { status: 'pending', detail: 'No status check available' };
        }
      } catch (error) {
        // Only a clear refusal of a new order is a failure. A failed status check says nothing about the order.
        const refused = action === 'place' && error instanceof ProviderError && error.definite;
        result = { status: refused ? 'failed' : 'pending', detail: (error as Error).message.slice(0, 500) };
      }
    }
    await this.prisma.orderAttempt.create({
      data: { orderId: id, supplierCode: order.supplierCode, reference: order.supplierReference, action, outcome: result.status, detail: result.detail?.slice(0, 500) },
    });
    if (result.status === 'completed') await this.complete(order, result);
    else if (result.status === 'failed') await this.failOrFallBack(order, result.detail);
    else if (options.scheduled === false) await this.noteTransaction(order, result);
    else await this.wait(order, result);
    return this.load(id);
  }

  /** Still pending after an unscheduled check: keep the supplier's transaction ID, change nothing else. */
  private async noteTransaction(order: Order, result: FulfilmentResult) {
    if (result.supplierTransactionId && !order.supplierTransactionId) {
      await this.prisma.order.updateMany({ where: { id: order.id, status: 'processing' }, data: { supplierTransactionId: result.supplierTransactionId } });
    }
  }

  private async wait(order: Order, result: FulfilmentResult) {
    const checks = order.checks + 1;
    const review = checks >= checkScheduleMs.length;
    await this.prisma.order.updateMany({
      where: { id: order.id, status: 'processing' },
      data: {
        checks,
        needsReview: review,
        supplierTransactionId: result.supplierTransactionId ?? order.supplierTransactionId,
        nextCheckAt: new Date(Date.now() + (review ? reviewCheckMs : checkScheduleMs[checks - 1])),
      },
    });
    if (review && !order.needsReview) {
      this.logger.warn({ orderId: order.id, supplier: order.supplierCode }, 'Order outcome still unclear; added to the exception queue');
      const product = (await this.prisma.product.findUnique({ where: { id: order.productId }, select: { name: true } }))?.name ?? 'An order';
      await this.inbox.reseller(order.resellerId, 'order.needs_review', {
        subject: order.id,
        title: `${product}: outcome still unclear`,
        body:
          order.source === 'own'
            ? 'Your supplier has not confirmed this order yet. We keep checking; check it in your supplier account too before doing anything else.'
            : 'The supplier has not confirmed this order yet. BitoCard is looking into it; the amount stays held until it is settled.',
        link: `/orders/${order.id}`,
        mode: order.mode,
      });
      if (order.mode === 'live') {
        await this.inbox.admins('admin.order.needs_review', {
          subject: order.id,
          title: `${product}: in the exception queue`,
          body: `${order.source === 'own' ? 'A reseller’s own-supplier order' : 'An order'} is still unconfirmed by ${order.supplierCode} after every scheduled check.`,
          link: `/orders/${order.id}`,
        });
      }
    }
  }

  /** Records the delivery and takes the held money: wholesale as revenue, tax as tax payable, and the supplier cost. */
  private async complete(order: Order, result: { supplierTransactionId?: string; deliveries?: Delivery[] }) {
    const deliveries = result.deliveries ?? [];
    const encryption = deliveries.some(d => d.code || d.pin) ? this.encryption() : null;
    const claimed = await this.prisma.$transaction(async tx => {
      const [{ nextval }] = order.source === 'own' ? [{ nextval: null }] : await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_receipt_number_seq')`;
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: 'processing' },
        data: {
          status: 'completed',
          needsReview: false,
          nextCheckAt: null,
          completedAt: new Date(),
          receiptNumber: nextval === null ? null : Number(nextval),
          supplierTransactionId: result.supplierTransactionId ?? order.supplierTransactionId,
        },
      });
      if (updated.count === 0) return false;
      for (const delivery of deliveries) {
        await tx.orderDelivery.create({
          data: {
            orderId: order.id,
            kind: delivery.kind,
            codeEncrypted: delivery.code && encryption ? encryption.encrypt(delivery.code) : null,
            pinEncrypted: delivery.pin && encryption ? encryption.encrypt(delivery.pin) : null,
            serial: delivery.serial ?? null,
            details: delivery.details ?? undefined,
          },
        });
      }
      await this.recordEvent(tx, 'order.completed', order.id);
      return true;
    });
    if (claimed) {
      this.events.committed();
      await this.settle(order.id);
    }
  }

  /** Ledger entries for a completed order. Idempotent, so the scheduled job can repair an interrupted completion. */
  private async settle(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { product: true } });
    if (order.source === 'own') {
      // BitoCard paid no supplier: it charges its fee, exactly, and nothing else.
      if (order.feeChargeId) {
        const fee = await this.fees.settle(order.feeChargeId);
        await this.prisma.order.update({ where: { id: order.id }, data: { feeMinor: fee.chargedMinor ?? 0n } });
      }
      return;
    }
    if (order.holdId) {
      await this.wallets.captureHold(order.holdId, `Order delivered: ${order.product.name}`, [{ kind: 'tax_payable', amount: order.taxMinor }]);
    }
    const reference = `order_cost:${order.id}`;
    if (!(await this.prisma.journalEntry.findUnique({ where: { reference } }))) {
      await this.ledger.post({
        mode: order.mode,
        type: 'order_cost',
        reference,
        description: `Supplier cost: ${order.product.name}`,
        metadata: { order_id: order.id, supplier: order.supplierCode },
        lines: [
          { account: { kind: 'cost_of_sales', currency: order.supplierCurrency, provider: order.supplierCode }, debit: order.supplierCostMinor },
          { account: { kind: 'supplier_float', currency: order.supplierCurrency, provider: order.supplierCode }, credit: order.supplierCostMinor },
        ],
      });
    }
  }

  /** A confirmed failure: try another supplier that can still honour the quote, or fail the order and release the hold. */
  private async failOrFallBack(order: OrderWithProduct, detail?: string) {
    if (order.source === 'own') {
      await this.fail(order.id, 'Your supplier could not fulfil the order. BitoCard\'s fee hold has been returned to your wallet.', detail);
      return;
    }
    const failed = await this.prisma.orderAttempt.findMany({ where: { orderId: order.id, outcome: 'failed' }, select: { supplierCode: true } });
    const exclude = new Set(failed.map(attempt => attempt.supplierCode));
    try {
      const ctx = await this.pricing.context(order.resellerId, order.mode);
      const product = await this.prisma.product.findUniqueOrThrow({ where: { id: order.productId }, include: offersInclude });
      const priced = await this.pricing.price(ctx, product, order.faceValueMinor, exclude);
      // The fallback must honour the quote: its cost may not exceed what the reseller is paying.
      if (priced.cost * BigInt(order.quantity) <= order.wholesaleMinor) {
        const moved = await this.prisma.order.updateMany({
          where: { id: order.id, status: 'processing', supplierCode: order.supplierCode },
          data: {
            supplierCode: priced.offer.supplierCode,
            supplierProductId: priced.offer.id,
            supplierCostMinor: priced.supplierCost * BigInt(order.quantity),
            supplierCurrency: priced.offer.costCurrency,
            supplierReference: supplierReference(),
            supplierTransactionId: null,
            checks: 0,
            nextCheckAt: null,
          },
        });
        if (moved.count === 1) {
          this.logger.log({ orderId: order.id, from: order.supplierCode, to: priced.offer.supplierCode }, 'Order moved to another supplier');
          await this.attempt(order.id, 'place');
          return;
        }
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    await this.fail(order.id, 'The order could not be fulfilled. The amount held has been returned to your wallet.', detail);
  }

  private async fail(orderId: string, reason: string, detail?: string) {
    const failed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: 'processing' },
        data: { status: 'failed', failureReason: reason, needsReview: false, nextCheckAt: null, completedAt: new Date() },
      });
      if (claimed.count === 1) await this.recordEvent(tx, 'order.failed', orderId);
      return claimed.count === 1;
    });
    if (!failed) return;
    this.events.committed();
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.holdId) await this.wallets.releaseHold(order.holdId, 'Order failed: funds released');
    if (order.feeChargeId) {
      await this.fees.release(order.feeChargeId);
      await this.prisma.order.update({ where: { id: orderId }, data: { feeMinor: 0n } });
    }
    this.logger.log({ orderId, detail }, 'Order failed');
  }

  /** Checks orders whose next check is due, and repairs completed orders whose ledger entries were interrupted. Run every few minutes. */
  async checkDue(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: { status: 'processing', mode: 'live', nextCheckAt: { lte: now } },
      orderBy: { nextCheckAt: 'asc' },
      take: 50,
    });
    const outcome = { checked: 0, completed: 0, failed: 0, repaired: 0 };
    for (const order of due) {
      try {
        const after = await this.attempt(order.id, 'check');
        outcome.checked += 1;
        if (after.status === 'completed') outcome.completed += 1;
        if (after.status === 'failed') outcome.failed += 1;
      } catch (error) {
        this.logger.error({ err: error, orderId: order.id }, 'Order check failed');
      }
    }
    const unsettled = await this.prisma.order.findMany({ where: { status: 'completed', holdId: { not: null } }, select: { id: true, holdId: true }, take: 200, orderBy: { completedAt: 'desc' } });
    const holds = await this.prisma.hold.findMany({ where: { id: { in: unsettled.map(o => o.holdId!) }, status: 'held' }, select: { id: true } });
    for (const order of unsettled.filter(o => holds.some(h => h.id === o.holdId))) {
      await this.settle(order.id);
      outcome.repaired += 1;
    }
    const ownUnsettled = await this.prisma.order.findMany({ where: { status: 'completed', source: 'own', feeChargeId: { not: null } }, select: { id: true, feeChargeId: true }, take: 200, orderBy: { completedAt: 'desc' } });
    const heldFees = await this.prisma.feeCharge.findMany({ where: { id: { in: ownUnsettled.map(o => o.feeChargeId!) }, status: 'held' }, select: { id: true } });
    for (const order of ownUnsettled.filter(o => heldFees.some(f => f.id === o.feeChargeId))) {
      await this.settle(order.id);
      outcome.repaired += 1;
    }
    return outcome;
  }

  // -- Admin -----------------------------------------------------------------------------------------------------

  async adminList(filter: { status?: OrderStatus; needs_review?: boolean; reseller_id?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 50;
    const orders = await this.prisma.order.findMany({
      where: { status: filter.status, needsReview: filter.needs_review, resellerId: filter.reseller_id },
      include: { product: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return {
      object: 'list' as const,
      data: orders.slice(0, limit).map(order => ({ ...this.present(order), reseller_id: order.resellerId, needs_review: order.needsReview, supplier: order.supplierCode })),
      has_more: orders.length > limit,
    };
  }

  /** Everything about an order for tracing: supplier attempts and every ledger entry. Delivered codes are not shown. */
  async adminGet(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { product: true, attempts: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw notFound();
    const fee = order.feeChargeId ? await this.prisma.feeCharge.findUnique({ where: { id: order.feeChargeId } }) : null;
    const references = [
      `order_cost:${id}`,
      `order_refund:${id}`,
      ...(order.holdId ? [`hold:${order.holdId}`, `hold_capture:${order.holdId}`, `hold_release:${order.holdId}`] : []),
      ...(fee ? [fee.reference, `fee:refund:${fee.id}`, ...(fee.holdId ? [`hold:${fee.holdId}`, `hold_release:${fee.holdId}`] : [])] : []),
    ];
    const entries = await this.prisma.journalEntry.findMany({ where: { reference: { in: references } }, include: { postings: { include: { account: true } } }, orderBy: { createdAt: 'asc' } });
    const notifications = await this.prisma.supplierWebhook.findMany({ where: { orderId: id }, orderBy: { receivedAt: 'asc' } });
    return {
      ...this.present(order),
      reseller_id: order.resellerId,
      needs_review: order.needsReview,
      supplier: { code: order.supplierCode, reference: order.supplierReference, transaction_id: order.supplierTransactionId, cost: minor(order.supplierCostMinor), currency: order.supplierCurrency },
      checks: order.checks,
      next_check_at: order.nextCheckAt?.toISOString() ?? null,
      attempts: order.attempts.map(a => ({ supplier: a.supplierCode, reference: a.reference, action: a.action, outcome: a.outcome, detail: a.detail, at: a.createdAt.toISOString() })),
      notifications: notifications.map(n => ({ id: n.id, supplier: n.supplierCode, event_type: n.eventType, status: n.status, received_at: n.receivedAt.toISOString() })),
      ledger: entries.map(e => ({
        type: e.type,
        reference: e.reference,
        at: e.createdAt.toISOString(),
        postings: e.postings.map(p => ({ account: p.account.kind, owner: p.account.ownerKey, currency: p.account.currency, amount: Number(p.amountMinor) })),
      })),
    };
  }

  async adminRequery(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound();
    await this.attempt(id, 'check');
    return this.adminGet(id);
  }

  /**
   * Admin decision on an unresolved order, after confirming with the supplier directly. Completing it can attach
   * the delivered codes; failing it releases the hold (no fallback: the admin has decided).
   */
  async resolve(actorId: string | null, id: string, input: { outcome: 'completed' | 'failed'; reason: string; deliveries?: Delivery[] }) {
    const before = await this.prisma.order.findUnique({ where: { id }, include: { product: true } });
    if (!before) throw notFound();
    if (before.status !== 'processing') throw conflict('order_not_processing', 'Only orders still processing can be resolved.');
    // A number handed over by an admin is shown like one DIDWW delivered.
    const deliveries = (input.deliveries ?? []).map(d => (d.kind === 'virtual_number' && d.serial && !d.details ? { ...d, details: { number: d.serial } } : d));
    if (input.outcome === 'completed') await this.complete(before, { deliveries });
    else await this.fail(id, 'The order could not be fulfilled. The amount held has been returned to your wallet.', input.reason);
    const after = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: `order.resolved_${input.outcome}`, targetType: 'order', targetId: id, before, after: { ...after, reason: input.reason } });
    return this.adminGet(id);
  }

  /** An own-supplier order: BitoCard took only its fee, so that is what it gives back. The reseller deals with their supplier. */
  private async refundOwn(actorId: string | null, order: OrderWithProduct, reason: string) {
    if (order.feeChargeId) await this.fees.refund(order.feeChargeId, actorId, reason);
    const refunded = await this.prisma.$transaction(async tx => {
      const claimed = await tx.order.updateMany({ where: { id: order.id, status: 'completed' }, data: { status: 'refunded', feeMinor: 0n } });
      if (claimed.count === 1) await this.recordEvent(tx, 'order.refunded', order.id);
      return claimed.count === 1;
    });
    if (!refunded) throw conflict('order_not_refundable', 'Only completed orders can be refunded.');
    this.events.committed();
    await this.audit.record({ actorId, action: 'order.refunded', targetType: 'order', targetId: order.id, before: order, after: { status: 'refunded', reason, fee_only: true } });
    return this.adminGet(order.id);
  }

  /**
   * Refunds a completed order to the reseller wallet (as topped-up funds). If the supplier refunded BitoCard too,
   * the supplier cost is reversed as well.
   */
  async refund(actorId: string | null, id: string, input: { reason: string; supplier_refunded: boolean }) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { product: true } });
    if (!order) throw notFound();
    if (order.status !== 'completed') throw conflict('order_not_refundable', 'Only completed orders can be refunded.');
    if (order.source === 'own') return this.refundOwn(actorId, order, input.reason);
    const total = order.wholesaleMinor + order.taxMinor;
    const entry = await this.ledger.prepare({
      mode: order.mode,
      type: 'order_refund',
      reference: `order_refund:${order.id}`,
      resellerId: order.resellerId,
      description: `Refund: ${order.product.name}`,
      metadata: { order_id: order.id, reason: input.reason, actor_id: actorId },
      lines: [
        { account: { kind: 'platform_revenue', currency: order.currency }, debit: order.wholesaleMinor },
        ...(order.taxMinor > 0n ? [{ account: { kind: 'tax_payable' as const, currency: order.currency }, debit: order.taxMinor }] : []),
        { account: { kind: 'reseller_funding', currency: order.currency, resellerId: order.resellerId }, credit: total },
        ...(input.supplier_refunded
          ? [
              { account: { kind: 'supplier_float' as const, currency: order.supplierCurrency, provider: order.supplierCode }, debit: order.supplierCostMinor },
              { account: { kind: 'cost_of_sales' as const, currency: order.supplierCurrency, provider: order.supplierCode }, credit: order.supplierCostMinor },
            ]
          : []),
      ],
    });
    const refunded = await this.prisma.$transaction(async tx => {
      const claimed = await tx.order.updateMany({ where: { id, status: 'completed' }, data: { status: 'refunded' } });
      if (claimed.count === 1) {
        await this.ledger.write(tx, entry);
        await this.recordEvent(tx, 'order.refunded', id);
      }
      return claimed.count === 1;
    });
    if (!refunded) throw conflict('order_not_refundable', 'Only completed orders can be refunded.');
    this.events.committed();
    await this.audit.record({ actorId, action: 'order.refunded', targetType: 'order', targetId: id, before: order, after: { status: 'refunded', ...input } });
    return this.adminGet(id);
  }
}

/** Test gift card codes and tokens that look real but are clearly marked as sandbox. */
function sandboxDeliveries(category: ProductCategory, quantity: number): Delivery[] {
  const code = () => `SANDBOX-${randomBytes(6).toString('hex').toUpperCase()}`;
  if (category === 'gift_cards') return Array.from({ length: quantity }, () => ({ kind: 'gift_card' as const, code: code(), pin: String(1000 + Math.floor(Math.random() * 9000)) }));
  if (category === 'software') return Array.from({ length: quantity }, () => ({ kind: 'licence_key' as const, code: `SANDBOX-${randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g)!.join('-')}` }));
  if (category === 'bills') return [{ kind: 'token', code: '0000-0000-0000-0000-0000', details: { units: '0.0' } }];
  if (category === 'virtual_numbers') {
    // 555-0100 to 555-0199 are reserved for fiction in North America: never a real subscriber.
    const number = `+120255501${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    return [{ kind: 'virtual_number', serial: number, details: { number, sandbox: 'true' } }];
  }
  return [{ kind: 'confirmation' }];
}
