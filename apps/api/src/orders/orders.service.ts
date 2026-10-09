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
import type { Delivery, FulfilmentRequest, FulfilmentResult, SuppliedNumber } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { EventsService } from '../webhooks/events.service.js';
import { PlatformFeesService } from '../fees/platform-fees.service.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { OwnSuppliersService } from '../reseller-integrations/own-suppliers.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { deliveryEmail, type EmailedDelivery, formatMoney } from '../notifications/templates.js';
import { emailedCategories } from '../catalogue/quotes.service.js';
import { OrderAccessService } from './order-access.service.js';
import { sellerFor } from './seller.js';

/** When to check an unconfirmed order again, after each check. After the last, it joins the exception queue. */
export const checkScheduleMs = [30, 60, 120, 300, 600, 1800, 3600, 7200, 14_400, 28_800].map(seconds => seconds * 1000);
/** Orders in the exception queue are still checked, this often, until an admin resolves them. */
const reviewCheckMs = 6 * 3600 * 1000;

type OrderWithProduct = Order & { product: Product };

/** Told when a customer's checkout order settles, so the checkout can close or refund the customer. */
export type CheckoutOrderListener = {
  settled(orderId: string, outcome: 'completed' | 'failed' | 'refunded'): Promise<void>;
  /** The checkout that paid for an order: whether it was paid into the reseller's own gateway. */
  checkoutOf(orderId: string): Promise<{ id: string; ownGateway: boolean } | null>;
  /** A finance admin refunded the delivered order: send the customer their money back through how they paid. */
  refundDelivered(orderId: string): Promise<void>;
};
type RecipientRecord = { phone?: string; account_number?: string; transaction_type?: string; [detail: string]: string | undefined };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/** The supplier reference for one attempt: the Lagos date and time first (VTpass requires it), then random hex. */
export function supplierReference(now = new Date()) {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const stamp = lagos.toISOString().replace(/[^0-9]/g, '').slice(0, 12);
  return `${stamp}BC${randomBytes(8).toString('hex')}`;
}

/** The same day and time a calendar month later (the last day of a shorter month). */
export function addMonth(date: Date) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
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
  private checkoutListener: CheckoutOrderListener | null = null;

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
    private readonly email: EmailService,
    private readonly access: OrderAccessService,
  ) {}

  /** The checkout service listens for its customers' orders (registered once at start-up). */
  onCheckoutOrder(listener: CheckoutOrderListener) {
    this.checkoutListener = listener;
  }

  private async tellCheckout(order: Pick<Order, 'id' | 'customerId'>, outcome: 'completed' | 'failed' | 'refunded') {
    if (!order.customerId) return;
    try {
      await this.checkoutListener?.settled(order.id, outcome);
    } catch (error) {
      // The checkout job repairs anything this missed (refunds due, checkouts to close).
      this.logger.error({ err: error, orderId: order.id }, 'Checkout could not handle a settled order; the checkout job retries');
    }
  }

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

  /**
   * One order for its reseller (`POST /v1/orders`, `GET /v1/orders/:id`): with what was delivered and its access link,
   * the page to give the customer. Both are secrets: never in lists, webhooks or admin views.
   */
  private async detail(order: OrderWithProduct & { deliveries?: OrderDelivery[] }) {
    return { ...this.present(order, true), access: await this.access.link(order) };
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

  /**
   * Places an order on an open quote. A customer's checkout (`checkout`) honours its quote even after it expires (the
   * customer paid that price) and, when BitoCard took the payment (`funding: 'customer'`, the default), holds the cost
   * from what the customer paid instead of the wallet. A payment into the reseller's own gateway (`funding: 'wallet'`)
   * left the money with them, so the cost comes from their wallet like any order.
   */
  async create(
    resellerId: string,
    mode: LedgerMode,
    input: { quote_id: string; simulate?: 'completed' | 'failed' | 'pending' },
    checkout?: { customerId: string; funding?: 'customer' | 'wallet' },
  ) {
    if (input.simulate && mode !== 'test') throw testModeOnly();
    const quote = await this.prisma.quote.findFirst({ where: { id: input.quote_id, resellerId, mode }, include: { product: true } });
    if (!quote) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'resource_missing', 'No such quote.', 'quote_id');
    if (quote.status === 'used') throw conflict('quote_used', 'This quote has already been used for an order. Create a new quote.');
    if (!checkout && quote.expiresAt <= new Date()) throw conflict('quote_expired', 'This quote has expired. Create a new quote.');
    const fromCustomer = Boolean(checkout) && checkout?.funding !== 'wallet';
    // BitoCard never collects money for a sale it is not the seller of: own-supplier products need the reseller's gateway.
    if (fromCustomer && quote.source === 'own') throw new Error('Own-supplier products are paid through the reseller gateway');
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
      hold = await this.wallets.hold({
        resellerId,
        mode,
        amount: quote.wholesaleMinor + quote.taxMinor,
        reference: `order:${id}`,
        description: `Order: ${quote.product.name}`,
        from: fromCustomer ? 'customer' : 'wallet',
      });
    }
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.quote.updateMany({ where: { id: quote.id, status: 'open', ...(checkout ? {} : { expiresAt: { gt: new Date() } }) }, data: { status: 'used' } });
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
            customerId: checkout?.customerId ?? null,
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
    return this.detail(order);
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
    return this.detail(order);
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
    if (order.status !== 'processing') return this.detail(await this.load(id));
    await this.prisma.order.update({ where: { id }, data: { simulate: outcome } });
    return this.detail(await this.attempt(id, 'check'));
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
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'processing', supplierReference: order.supplierReference },
        data: { supplierTransactionId: result.supplierTransactionId },
      });
    }
  }

  private async wait(order: Order, result: FulfilmentResult) {
    const checks = order.checks + 1;
    const review = checks >= checkScheduleMs.length;
    // Only while the order is still with the supplier this answer came from: never overwrite a fallback's attempt.
    const waited = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'processing', supplierReference: order.supplierReference },
      data: {
        checks,
        needsReview: review,
        supplierTransactionId: result.supplierTransactionId ?? order.supplierTransactionId,
        nextCheckAt: new Date(Date.now() + (review ? reviewCheckMs : checkScheduleMs[checks - 1])),
      },
    });
    if (waited.count === 1 && review && !order.needsReview) {
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
          body: `${order.source === 'own' ? 'A resellerâ€™s own-supplier order' : 'An order'} is still unconfirmed by ${order.supplierCode} after every scheduled check.`,
          link: `/orders/${order.id}`,
        });
      }
    }
  }

  /** Records the delivery and takes the held money: wholesale as revenue, tax as tax payable, and the supplier cost. */
  private async complete(order: Order, result: { supplierTransactionId?: string; deliveries?: Delivery[]; numbers?: SuppliedNumber[]; reportedCost?: FulfilmentResult['reportedCost'] }) {
    const deliveries = result.deliveries ?? [];
    const reconciled = reconcile(order, result.reportedCost);
    const encryption = deliveries.some(d => d.code || d.pin) ? this.encryption() : null;
    const numbers = await this.numbersOf(order, result.numbers, deliveries);
    const claimed = await this.prisma.$transaction(async tx => {
      const [{ nextval }] = order.source === 'own' ? [{ nextval: null }] : await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_receipt_number_seq')`;
      // Only the supplier attempt this delivery came from can complete the order.
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: 'processing', supplierReference: order.supplierReference },
        data: {
          status: 'completed',
          needsReview: false,
          nextCheckAt: null,
          completedAt: new Date(),
          receiptNumber: nextval === null ? null : Number(nextval),
          supplierTransactionId: result.supplierTransactionId ?? order.supplierTransactionId,
          ...(reconciled ? { supplierReportedCostMinor: reconciled.reported, costMismatch: reconciled.mismatch } : {}),
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
      for (const number of numbers) {
        await tx.virtualNumber.create({
          data: {
            orderId: order.id,
            resellerId: order.resellerId,
            mode: order.mode,
            productId: order.productId,
            supplierCode: order.supplierCode,
            supplierNumberId: number.supplierNumberId,
            number: number.number,
            monthlyCostMinor: number.monthlyCostMinor,
            costCurrency: number.costCurrency,
            expiresAt: number.expiresAt ?? addMonth(new Date()),
          },
        });
      }
      await this.recordEvent(tx, 'order.completed', order.id);
      return true;
    });
    if (claimed) {
      this.events.committed();
      if (reconciled?.mismatch) {
        this.logger.warn({ orderId: order.id, supplier: order.supplierCode, expected: String(order.supplierCostMinor), reported: String(reconciled.reported) }, 'Supplier charged a different amount than expected');
        await this.inbox.admins('admin.order.cost_mismatch', {
          subject: order.id,
          title: 'A supplier charged a different amount',
          body: `${order.supplierCode} charged ${formatMoney(reconciled.reported, order.supplierCurrency)} for an order expected to cost ${formatMoney(order.supplierCostMinor, order.supplierCurrency)}. Check its discount or commission.`,
          link: `/orders/${order.id}`,
          mode: order.mode,
        });
      }
      await this.settle(order.id);
      await this.emailDeliveries(order.id);
      await this.tellCheckout(order, 'completed');
    }
  }

  /**
   * The virtual numbers an order bought, to keep for renewals and SMS: as the supplier reported them, or in the sandbox
   * the test number it delivered (priced at the offer's monthly cost). Numbers bought through a reseller's own supplier
   * account are theirs to manage there.
   */
  private async numbersOf(order: Order, reported: SuppliedNumber[] | undefined, deliveries: Delivery[]): Promise<SuppliedNumber[]> {
    if (order.source === 'own') return [];
    if (reported?.length) return reported;
    if (order.mode !== 'test') return [];
    const delivered = deliveries.filter(delivery => delivery.kind === 'virtual_number' && delivery.serial);
    if (!delivered.length) return [];
    const offer = await this.prisma.supplierProduct.findUnique({ where: { id: order.supplierProductId }, select: { meta: true, costCurrency: true } });
    const monthly = Number((offer?.meta as Record<string, unknown> | null)?.monthlyMinor ?? 0);
    return delivered.map((delivery, index) => ({
      supplierNumberId: `sandbox_${order.supplierReference}_${index}`,
      number: delivery.serial!,
      expiresAt: null,
      monthlyCostMinor: BigInt(monthly > 0 ? monthly : 100),
      costCurrency: offer?.costCurrency ?? order.supplierCurrency,
    }));
  }

  /**
   * Emails the codes or licence keys to the reseller's customer when the quote named an address (`recipient.email`),
   * under the reseller's store name. Sent once: the order is claimed (`delivery_emailed_at`) before sending and released
   * if the send fails, so the `orders` job retries it for a day. Never throws, and never logs the codes.
   */
  private async emailDeliveries(orderId: string) {
    const now = new Date();
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { product: true, deliveries: true } });
    const to = (order?.recipient as RecipientRecord | null)?.email;
    if (!order || order.status !== 'completed' || order.deliveryEmailedAt || !to || !emailedCategories.has(order.product.category)) return false;
    const coded = order.deliveries.filter(delivery => delivery.codeEncrypted && (delivery.kind === 'gift_card' || delivery.kind === 'licence_key'));
    if (!coded.length) return false;
    const claimed = await this.prisma.order.updateMany({ where: { id: orderId, deliveryEmailedAt: null }, data: { deliveryEmailedAt: now } });
    if (claimed.count === 0) return false;
    try {
      const encryption = this.encryption();
      const [store, reseller] = await Promise.all([
        this.prisma.store.findFirst({ where: { resellerId: order.resellerId }, select: { name: true } }),
        this.prisma.reseller.findUniqueOrThrow({ where: { id: order.resellerId }, select: { name: true } }),
      ]);
      const deliveries: EmailedDelivery[] = coded.map(delivery => ({
        kind: delivery.kind as EmailedDelivery['kind'],
        code: encryption.decrypt(delivery.codeEncrypted!),
        ...(delivery.pinEncrypted ? { pin: encryption.decrypt(delivery.pinEncrypted) } : {}),
        ...(delivery.details ? { details: delivery.details as Record<string, string> } : {}),
      }));
      const { url } = await this.access.link(order);
      await this.email.send(
        deliveryEmail(to, { store: store?.name ?? reseller.name, product: order.product.name, deliveries, instructions: order.product.redeemInstructions, sandbox: order.mode === 'test', link: url }),
      );
      return true;
    } catch (error) {
      await this.prisma.order.updateMany({ where: { id: orderId, deliveryEmailedAt: now }, data: { deliveryEmailedAt: null } });
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', orderId }, 'Could not email the delivery; the orders job retries it');
      return false;
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
    const paidByCustomer = order.customerId && order.holdId ? ((await this.prisma.hold.findUnique({ where: { id: order.holdId } }))?.fromCustomerMinor ?? 0n) > 0n : false;
    if (paidByCustomer && order.resellerProfitMinor > 0n) {
      // A customer paid the store through BitoCard: the store's margin becomes its earnings, inside the payout hold like
      // any sale. (Paid into the reseller's own gateway, the margin is already theirs.)
      await this.wallets.creditEarnings({
        resellerId: order.resellerId,
        mode: order.mode,
        amount: order.resellerProfitMinor,
        reference: `order:${order.id}`,
        description: `Sale: ${order.product.name}`,
        source: this.wallets.ref(order.resellerId, order.currency, 'customer_payments'),
      });
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
      await this.fail(order.id, 'Your supplier could not fulfil the order. BitoCard\'s fee hold has been returned to your wallet.', detail, order.supplierReference);
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
          where: { id: order.id, status: 'processing', supplierReference: order.supplierReference },
          data: {
            supplierCode: priced.offer.supplierCode,
            supplierProductId: priced.offer.id,
            supplierCostMinor: priced.supplierCost * BigInt(order.quantity),
            supplierCurrency: priced.offer.costCurrency,
            supplierReference: supplierReference(),
            supplierTransactionId: null,
            checks: 0,
            // Scheduled at once, so the order is still checked if this run stops before the new supplier answers.
            nextCheckAt: new Date(Date.now() + checkScheduleMs[0]),
          },
        });
        // Another check already moved, completed or failed the order: it is not this run's to fail.
        if (moved.count === 0) return;
        this.logger.log({ orderId: order.id, from: order.supplierCode, to: priced.offer.supplierCode }, 'Order moved to another supplier');
        await this.attempt(order.id, 'place');
        return;
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    await this.fail(order.id, 'The order could not be fulfilled. The amount held has been returned to your wallet.', detail, order.supplierReference);
  }

  /**
   * Fails the order and releases its hold. A supplier's failure passes the attempt's reference, so it can only fail the
   * order while it is still with that attempt (never one a concurrent check has since moved to another supplier).
   */
  private async fail(orderId: string, reason: string, detail?: string, supplierReference?: string) {
    const failed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: 'processing', ...(supplierReference ? { supplierReference } : {}) },
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
    await this.tellCheckout(order, 'failed');
  }

  /** Checks orders whose next check is due, and repairs completed orders whose ledger entries were interrupted. Run every few minutes. */
  async checkDue(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: { status: 'processing', mode: 'live', nextCheckAt: { lte: now } },
      orderBy: { nextCheckAt: 'asc' },
      take: 50,
    });
    const outcome = { checked: 0, completed: 0, failed: 0, repaired: 0, emailed: 0 };
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
    // Delivery emails that could not be sent are retried for a day.
    const unsent = await this.prisma.order.findMany({
      where: { status: 'completed', deliveryEmailedAt: null, completedAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, recipient: { path: ['email'], string_contains: '@' } },
      select: { id: true },
      take: 50,
      orderBy: { completedAt: 'asc' },
    });
    for (const order of unsent) if (await this.emailDeliveries(order.id)) outcome.emailed += 1;
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
    const checkout = order.customerId ? await this.prisma.checkout.findUnique({ where: { orderId: id }, include: { payment: true } }) : null;
    const references = [
      `order_cost:${id}`,
      `order_refund:${id}`,
      ...(checkout ? [`payment:${checkout.paymentId}`, `checkout_refund:${checkout.id}`, `earnings:order:${id}`] : []),
      ...(order.holdId ? [`hold:${order.holdId}`, `hold_capture:${order.holdId}`, `hold_release:${order.holdId}`] : []),
      ...(fee ? [fee.reference, `fee:refund:${fee.id}`, ...(fee.holdId ? [`hold:${fee.holdId}`, `hold_release:${fee.holdId}`] : [])] : []),
    ];
    const entries = await this.prisma.journalEntry.findMany({ where: { reference: { in: references } }, include: { postings: { include: { account: true } } }, orderBy: { createdAt: 'asc' } });
    const notifications = await this.prisma.supplierWebhook.findMany({ where: { orderId: id }, orderBy: { receivedAt: 'asc' } });
    return {
      ...this.present(order),
      reseller_id: order.resellerId,
      needs_review: order.needsReview,
      supplier: {
        code: order.supplierCode,
        reference: order.supplierReference,
        transaction_id: order.supplierTransactionId,
        cost: minor(order.supplierCostMinor),
        currency: order.supplierCurrency,
        // What the supplier said it charged, and whether that differs from the cost the order was priced from.
        reported_cost: order.supplierReportedCostMinor === null ? null : minor(order.supplierReportedCostMinor),
        cost_mismatch: order.costMismatch,
      },
      checks: order.checks,
      next_check_at: order.nextCheckAt?.toISOString() ?? null,
      /** A store customer paid for it at checkout: refunds go back to them, through how they paid. */
      checkout: checkout
        ? {
            id: checkout.id,
            status: checkout.status,
            store_id: checkout.storeId,
            gateway: checkout.payment?.provider ?? checkout.gateway,
            /** Paid into the reseller's own gateway account (their connection), not BitoCard's. */
            own_gateway: Boolean(checkout.connectionId),
            amount: minor(checkout.amountMinor),
            currency: checkout.currency,
            refund_attempts: checkout.refundAttempts,
            refunded_at: checkout.refundedAt?.toISOString() ?? null,
          }
        : null,
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
    const checkout = order.customerId ? await this.checkoutListener?.checkoutOf(order.id) : null;
    if (order.customerId && !checkout) throw conflict('order_not_refundable', 'This store order has no checkout to refund.');
    if (checkout && !checkout.ownGateway) return this.refundCustomerPaid(actorId, order, input);
    const result = order.source === 'own' ? await this.refundOwn(actorId, order, input.reason) : await this.refundToWallet(actorId, order, input);
    // Paid into the reseller's own gateway: the wholesale (or BitoCard's fee) goes back to their wallet, and the
    // customer is refunded from their gateway account.
    if (checkout) await this.refundCheckout(order.id);
    return checkout ? this.adminGet(order.id) : result;
  }

  private async refundCheckout(orderId: string) {
    try {
      await this.checkoutListener?.refundDelivered(orderId);
    } catch (error) {
      // The checkout job retries refunds that are due.
      this.logger.error({ err: error, orderId }, 'Customer refund not sent yet; the checkout job retries');
    }
  }

  /**
   * A delivered order a store customer paid through BitoCard: the sale is reversed into what the customer paid
   * (`customer_payments`): wholesale and tax back from BitoCard, the store's margin back from its earnings (still held,
   * or withdrawable), then the customer is refunded in full through their payment method.
   */
  private async refundCustomerPaid(actorId: string | null, order: OrderWithProduct, input: { reason: string; supplier_refunded: boolean }) {
    const profit = order.resellerProfitMinor;
    const lot = profit > 0n ? await this.prisma.earningsLot.findUnique({ where: { reference: `order:${order.id}` } }) : null;
    const entry = (from: 'reseller_earnings_held' | 'reseller_earnings') =>
      this.ledger.prepare({
        mode: order.mode,
        type: 'order_refund',
        reference: `order_refund:${order.id}`,
        resellerId: order.resellerId,
        description: `Refund to customer: ${order.product.name}`,
        metadata: { order_id: order.id, reason: input.reason, actor_id: actorId, to: 'customer' },
        lines: [
          { account: { kind: 'platform_revenue', currency: order.currency }, debit: order.wholesaleMinor },
          ...(order.taxMinor > 0n ? [{ account: { kind: 'tax_payable' as const, currency: order.currency }, debit: order.taxMinor }] : []),
          ...(lot ? [{ account: { kind: from, currency: order.currency, resellerId: order.resellerId }, debit: profit }] : []),
          { account: { kind: 'customer_payments', currency: order.currency, resellerId: order.resellerId }, credit: order.wholesaleMinor + order.taxMinor + (lot ? profit : 0n) },
          ...this.supplierRefundLines(order, input.supplier_refunded),
        ],
      });
    const [fromHeld, fromReleased] = await Promise.all([entry('reseller_earnings_held'), entry('reseller_earnings')]);
    let refunded: boolean;
    try {
      refunded = await this.prisma.$transaction(async tx => {
        const claimed = await tx.order.updateMany({ where: { id: order.id, status: 'completed' }, data: { status: 'refunded' } });
        if (claimed.count !== 1) return false;
        // Still inside the payout hold: taken back from held earnings, and never released.
        const reversed = lot ? await tx.earningsLot.updateMany({ where: { id: lot.id, releasedAt: null }, data: { releasedAt: new Date(), reversedAt: new Date() } }) : { count: 1 };
        await this.ledger.write(tx, reversed.count === 1 ? fromHeld : fromReleased);
        await this.recordEvent(tx, 'order.refunded', order.id);
        return true;
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        throw conflict('earnings_withdrawn', 'The store has already withdrawn the profit from this sale, so it cannot be refunded here. Refund the customer from the payment providerâ€™s dashboard and adjust the storeâ€™s wallet.');
      }
      throw error;
    }
    if (!refunded) throw conflict('order_not_refundable', 'Only completed orders can be refunded.');
    this.events.committed();
    await this.audit.record({ actorId, action: 'order.refunded', targetType: 'order', targetId: order.id, before: order, after: { status: 'refunded', ...input, to: 'customer' } });
    await this.refundCheckout(order.id);
    return this.adminGet(order.id);
  }

  private supplierRefundLines(order: Order, supplierRefunded: boolean) {
    return supplierRefunded
      ? [
          { account: { kind: 'supplier_float' as const, currency: order.supplierCurrency, provider: order.supplierCode }, debit: order.supplierCostMinor },
          { account: { kind: 'cost_of_sales' as const, currency: order.supplierCurrency, provider: order.supplierCode }, credit: order.supplierCostMinor },
        ]
      : [];
  }

  /** Refunds a completed order to the reseller wallet (as topped-up funds). */
  private async refundToWallet(actorId: string | null, order: OrderWithProduct, input: { reason: string; supplier_refunded: boolean }) {
    const id = order.id;
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
        ...this.supplierRefundLines(order, input.supplier_refunded),
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

/**
 * What the supplier said it charged, against the cost the order was priced from (both for the whole order, in the
 * supplier currency): a difference of more than half a percent (and one minor unit) is a mismatch for admins to check,
 * usually a changed discount or commission. Null when the supplier did not say, or said in another currency.
 */
export function reconcile(order: Pick<Order, 'supplierCostMinor' | 'supplierCurrency'>, reported: FulfilmentResult['reportedCost']) {
  if (!reported || reported.currency !== order.supplierCurrency) return null;
  const difference = reported.amountMinor > order.supplierCostMinor ? reported.amountMinor - order.supplierCostMinor : order.supplierCostMinor - reported.amountMinor;
  const tolerance = order.supplierCostMinor / 200n > 1n ? order.supplierCostMinor / 200n : 1n;
  return { reported: reported.amountMinor, mismatch: difference > tolerance };
}
