import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { emailedCategories, QuotesService } from '../catalogue/quotes.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlatformFeesService } from '../fees/platform-fees.service.js';
import type { Checkout, CheckoutStatus, Order, OrderDelivery, Payment, Product, Store } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { OrdersService, receiptNumber } from '../orders/orders.service.js';
import { presentMethod } from '../payments/payment-methods.service.js';
import { isPaymentGateway, paymentGateways } from '../payments/payment-providers.js';
import { paymentRef, PaymentsService } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { type PaymentOption, StoreSellers } from './store-sellers.js';

const minute = 60 * 1000;
/** Refunds that fail this many times are left for an admin (they stay `refund_pending`, and admins are told). */
const maxRefundAttempts = 5;

/** How customers' orders are grouped in their account (`GET /v1/store/checkouts?show=`, and the summary's "on the way"). */
export const checkoutGroups = {
  progress: ['awaiting_payment', 'paid', 'refund_pending'],
  delivered: ['completed'],
  refunded: ['refunded'],
} as const satisfies Record<string, readonly CheckoutStatus[]>;
export type CheckoutGroup = keyof typeof checkoutGroups;

type CheckoutFull = Checkout & {
  payment: Payment | null;
  quote: { product: Product; faceValueMinor: bigint; faceCurrency: string; quantity: number; taxMinor: bigint; taxName: string | null; recipient: unknown };
  order: (Order & { product: Product; deliveries: OrderDelivery[] }) | null;
};

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');
const cannotSell = () => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'store_checkout_unavailable', 'This store cannot take this order right now. Try again later.');

export type CheckoutInput = {
  product_id: string;
  face_value: number;
  quantity?: number;
  country: string;
  method?: string;
  recipient?: { phone?: string; account_number?: string; transaction_type?: 'change' | 'renew'; email?: string };
  return_url: string;
};

/**
 * Customers buying on a store: the price is quoted and locked, the customer pays it on the gateway's payment page, and
 * only once the gateway confirms the payment is the order placed.
 *
 * - **Through BitoCard's gateway** (bitocard.com, and resellers' stores using the market's checkout methods): the cost is
 *   held from what the customer paid (never the reseller's wallet); when it is delivered the wholesale and tax go to
 *   BitoCard and the margin to the store's earnings; if it fails, the customer is refunded in full to how they paid.
 * - **Through the reseller's own gateway** (their connection): the money goes into their account and never through
 *   BitoCard's ledger. BitoCard holds its `gateway_payment` fee from their wallet when the payment starts (charged once
 *   paid, released if not), and the order's cost comes from their wallet like any order. Refunds go back through their
 *   account, and BitoCard's fee is returned when nothing was delivered.
 *
 * bitocard.com sells through BitoCard's house account for the customer's market; a reseller's store through the
 * reseller (`StoreSellers`). Customers must have confirmed their email, and pass the identity check where the market
 * requires it for the category.
 */
@Injectable()
export class CheckoutService implements OnModuleInit {
  private readonly logger = new Logger('Checkout');
  /** Sandbox only: the order outcome to simulate for a checkout being paid now (see `simulate`). */
  private readonly sandboxOrders = new Map<string, 'completed' | 'failed'>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly quotes: QuotesService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly fees: PlatformFeesService,
    private readonly identity: IdentityService,
    private readonly inbox: InboxService,
  ) {}

  onModuleInit() {
    this.payments.onCheckout({ paid: id => this.paid(id), failed: id => this.unpaid(id) });
    this.payments.onOwnGateway((connectionId, gateway) => this.stores.ownProvider(connectionId, gateway));
    this.orders.onCheckoutOrder({
      settled: (id, outcome) => this.orderSettled(id, outcome),
      checkoutOf: async orderId => {
        const checkout = await this.prisma.checkout.findUnique({ where: { orderId } });
        return checkout ? { id: checkout.id, ownGateway: Boolean(checkout.connectionId) } : null;
      },
      refundDelivered: orderId => this.refundDelivered(orderId),
    });
  }

  // -- Presenting ------------------------------------------------------------------------------------------------

  private load(where: { id: string } | { paymentId: string } | { orderId: string }) {
    return this.prisma.checkout.findFirst({ where, include: { payment: true } }).then(async checkout => {
      if (!checkout) return null;
      const [quote, order] = await Promise.all([
        this.prisma.quote.findUniqueOrThrow({ where: { id: checkout.quoteId }, include: { product: true } }),
        checkout.orderId ? this.prisma.order.findUnique({ where: { id: checkout.orderId }, include: { product: true, deliveries: true } }) : null,
      ]);
      return { ...checkout, quote, order } as CheckoutFull;
    });
  }

  /** What the customer sees: the price they paid, never the wholesale cost, margin or supplier. Codes only on one checkout. */
  present(checkout: CheckoutFull, withDeliveries = false) {
    const product = checkout.quote.product;
    const delivered = checkout.order?.status === 'completed' ? checkout.order : null;
    return {
      object: 'checkout' as const,
      id: checkout.id,
      mode: checkout.mode,
      status: checkout.status,
      product: { id: product.id, key: product.key, name: product.name, category: product.category, brand: product.brand },
      face_value: minor(checkout.quote.faceValueMinor),
      face_currency: checkout.quote.faceCurrency,
      quantity: checkout.quote.quantity,
      amount: minor(checkout.amountMinor),
      currency: checkout.currency,
      tax: checkout.quote.taxName ? { name: checkout.quote.taxName, amount: minor(checkout.quote.taxMinor) } : null,
      method: isPaymentGateway(checkout.gateway) ? presentMethod(checkout.gateway) : { object: 'payment_method' as const, id: checkout.gateway, label: 'Sandbox', description: 'Simulated payment' },
      checkout_url: checkout.status === 'awaiting_payment' && checkout.payment?.status === 'pending' ? checkout.payment.checkoutUrl : null,
      recipient: checkout.quote.recipient ?? null,
      order: checkout.order
        ? {
            id: checkout.order.id,
            status: checkout.order.status,
            receipt_number: receiptNumber(checkout.order.receiptNumber),
            completed_at: checkout.order.completedAt?.toISOString() ?? null,
            ...(withDeliveries && delivered ? { deliveries: this.orders.present(delivered, true).deliveries ?? [], redeem_instructions: product.redeemInstructions } : {}),
          }
        : null,
      failure_reason: checkout.failureReason,
      refunded_at: checkout.refundedAt?.toISOString() ?? null,
      created_at: checkout.createdAt.toISOString(),
      updated_at: checkout.updatedAt.toISOString(),
    };
  }

  // -- Customers -------------------------------------------------------------------------------------------------

  /** How customers can pay on a store, best first (bitocard.com: in the country given; a reseller's store: theirs). */
  async methodsFor(store: Store, countryCode: string) {
    const mode = this.stores.mode(store);
    const seller = await this.sellerOrNull(store, countryCode);
    const options = seller ? await this.stores.paymentOptions(store, seller, mode) : [];
    return { object: 'list' as const, mode, data: options.filter(option => option.gateway !== 'sandbox').map(option => presentMethod(option.gateway as keyof typeof paymentGateways)) };
  }

  private async sellerOrNull(store: Store, countryCode: string) {
    try {
      return await this.stores.seller(store, countryCode);
    } catch (error) {
      if (error instanceof ApiError) return null;
      throw error;
    }
  }

  /** The payment option asked for, else the store's first; the sandbox in test mode when nothing is switched on. */
  private choose(options: PaymentOption[], mode: string, asked?: string): PaymentOption {
    if (asked) {
      const found = options.find(option => option.gateway === asked);
      if (found) return found;
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'payment_method_unavailable', 'This payment method is not available here. List the methods offered first.', 'method');
    }
    if (options[0]) return options[0];
    if (mode === 'test') return { gateway: 'sandbox' };
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', 'Payments are not available in your country yet.');
  }

  async start(customer: CustomerWithStore, input: CheckoutInput) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email before buying: enter the code we emailed you.');
    }
    const store = customer.store;
    const mode = this.stores.mode(store);
    const seller = await this.stores.seller(store, input.country);
    const product = await this.prisma.product.findUnique({ where: { id: input.product_id } });
    const listed = product && (this.stores.isHouse(store) ? product.listed : await this.prisma.resellerListing.findUnique({ where: { resellerId_productId: { resellerId: seller.id, productId: product.id } } }));
    if (!product || !listed) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'resource_missing', 'No such product.', 'product_id');

    const rule = await this.prisma.countryCategory.findUnique({ where: { countryCode_category: { countryCode: seller.country!, category: product.category } } });
    if (rule?.customerVerification && !(await this.identity.isCustomerVerified(seller.id, mode, customer.id))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before buying this. It takes a few minutes and is needed once.');
    }
    const option = this.choose(await this.stores.paymentOptions(store, seller, mode), mode, input.method);

    // Codes and licence keys are also emailed to the customer, unless they named another address.
    const recipient = { ...input.recipient };
    if (emailedCategories.has(product.category) && !recipient.email) recipient.email = customer.email;
    const presented = await this.quotes.create(
      seller.id,
      mode,
      { product_id: product.id, face_value: input.face_value, quantity: input.quantity, recipient, customer_reference: customer.id },
      // Products from the reseller's own supplier can only be paid into their own gateway.
      { ownSources: Boolean(option.own) },
    );
    const quote = await this.prisma.quote.findUniqueOrThrow({ where: { id: presented.id } });

    const id = randomUUID();
    const paymentId = randomUUID();
    let feeChargeId: string | null = null;
    if (option.own) feeChargeId = await this.holdGatewayFee(seller.id, mode, quote, paymentId, product.name);

    await this.prisma.checkout.create({
      data: {
        id,
        storeId: store.id,
        customerId: customer.id,
        resellerId: seller.id,
        mode,
        quoteId: quote.id,
        gateway: option.gateway,
        amountMinor: quote.priceMinor,
        currency: quote.currency,
        connectionId: option.own?.connectionId ?? null,
        feeChargeId,
      },
    });
    const returnUrl = new URL(input.return_url);
    returnUrl.searchParams.set('checkout', id);
    try {
      await this.payments.openPayment({
        id: paymentId,
        resellerId: seller.id,
        mode,
        purpose: 'checkout',
        gateway: option.gateway,
        own: option.own,
        reference: `bc_chk_${id.replaceAll('-', '')}`,
        amount: quote.priceMinor,
        country: seller.country!,
        currency: quote.currency,
        payer: { email: customer.email, name: customer.name },
        returnUrl: returnUrl.toString(),
        description: quote.quantity > 1 ? `${quote.quantity} x ${product.name}` : product.name,
      });
      await this.prisma.checkout.update({ where: { id }, data: { paymentId } });
    } catch (error) {
      await this.prisma.checkout.update({ where: { id }, data: { status: 'failed', failureReason: 'The payment could not be started.' } });
      if (feeChargeId) await this.fees.release(feeChargeId).catch(err => this.logger.error({ err, checkoutId: id }, 'Fee hold not released'));
      throw error;
    }
    return this.present((await this.load({ id }))!);
  }

  /**
   * Before a customer pays into the reseller's own gateway: BitoCard's `gateway_payment` fee is held from their wallet,
   * and the wallet must also cover the order's cost (BitoCard-sourced products) so the customer is never charged for
   * an order that cannot be placed. Customers are told only that the store cannot take the order; the reseller is told why.
   */
  private async holdGatewayFee(resellerId: string, mode: Checkout['mode'], quote: { id: string; priceMinor: bigint; wholesaleMinor: bigint; taxMinor: bigint; source: string; feeMaxMinor: bigint | null }, paymentId: string, name: string) {
    let fee: { id: string } | null = null;
    try {
      fee = await this.fees.hold({ resellerId, mode, kind: 'gateway_payment', baseMinor: quote.priceMinor, source: { type: 'payment', id: paymentId }, description: `Store payment: ${name}` });
      const cost = quote.source === 'own' ? (quote.feeMaxMinor ?? 0n) : quote.wholesaleMinor + quote.taxMinor;
      const wallet = await this.wallets.wallet(resellerId, mode);
      if (BigInt(wallet.available) < cost) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', 'The wallet balance is too low for this.');
      return fee.id;
    } catch (error) {
      if (fee) await this.fees.release(fee.id);
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        await this.inbox.reseller(resellerId, 'store.checkout_refused', {
          // Once a day at most.
          subject: `${mode}:${new Date().toISOString().slice(0, 10)}`,
          title: 'A customer could not buy from your store',
          body: `Your wallet could not cover the cost of ${name} and BitoCard's fee, so the order was turned away before the customer paid. Top up your wallet to keep selling.`,
          link: '/wallet',
          mode,
        });
        throw cannotSell();
      }
      throw error;
    }
  }

  async list(customer: CustomerWithStore, page: { limit?: number; starting_after?: string; show?: CheckoutGroup }) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.checkout.findMany({
      where: { customerId: customer.id, NOT: { status: 'failed', orderId: null }, ...(page.show ? { status: { in: [...checkoutGroups[page.show]] } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
      select: { id: true },
    });
    const data = await Promise.all(rows.slice(0, limit).map(async row => this.present((await this.load({ id: row.id }))!)));
    return { object: 'list' as const, data, has_more: rows.length > limit };
  }

  /**
   * The customer's figures for their account home: what they spent (delivered orders, by currency; refunds left out),
   * how many orders they have and how many are on their way, and how many were delivered this calendar month (UTC).
   */
  async summary(customer: CustomerWithStore, now = new Date()) {
    const rows = await this.prisma.checkout.findMany({
      where: { customerId: customer.id, NOT: { status: 'failed', orderId: null } },
      select: { status: true, amountMinor: true, currency: true },
    });
    const spent = new Map<string, bigint>();
    const delivered = rows.filter(item => item.status === 'completed');
    for (const row of delivered) spent.set(row.currency, (spent.get(row.currency) ?? 0n) + row.amountMinor);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const deliveredThisMonth = await this.prisma.order.count({ where: { customerId: customer.id, status: 'completed', completedAt: { gte: monthStart } } });
    return {
      object: 'customer_summary' as const,
      // Most delivered orders first: amounts in different currencies cannot be compared.
      orders_total: [...spent]
        .map(([currency, amount]) => ({ amount: minor(amount), currency, count: delivered.filter(row => row.currency === currency).length }))
        .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
        .map(({ amount, currency }) => ({ amount, currency })),
      orders: {
        total: rows.length,
        in_progress: rows.filter(row => (checkoutGroups.progress as readonly string[]).includes(row.status)).length,
      },
      delivered_this_month: deliveredThisMonth,
    };
  }

  /** One checkout, with its codes once delivered. A checkout still waiting for payment is checked with the gateway first. */
  async get(customer: CustomerWithStore, id: string) {
    let checkout = await this.load({ id });
    if (!checkout || checkout.customerId !== customer.id) throw notFound();
    if (checkout.status === 'awaiting_payment' && checkout.payment?.status === 'pending' && checkout.mode === 'live') {
      await this.payments.requery(checkout.payment).catch(error => this.logger.warn({ err: error, checkoutId: id }, 'Payment check failed'));
      checkout = (await this.load({ id }))!;
    }
    return this.present(checkout, true);
  }

  /** Sandbox checkouts only: finish the payment as paid or failed, and the order it places as delivered or failed. */
  async simulate(customer: CustomerWithStore, id: string, outcome: 'succeeded' | 'failed', order: 'completed' | 'failed' = 'completed') {
    const checkout = await this.load({ id });
    if (!checkout || checkout.customerId !== customer.id) throw notFound();
    if (!checkout.payment) throw notFound();
    this.sandboxOrders.set(id, order);
    try {
      await this.payments.simulate(checkout.payment, outcome);
    } finally {
      this.sandboxOrders.delete(id);
    }
    return this.present((await this.load({ id }))!, true);
  }

  // -- Payments and orders ---------------------------------------------------------------------------------------

  /** The customer paid: charge BitoCard's fee on an own-gateway payment, then place the order (once). */
  private async paid(paymentId: string) {
    const checkout = await this.prisma.checkout.findUnique({ where: { paymentId } });
    if (!checkout) return;
    await this.prisma.checkout.updateMany({ where: { id: checkout.id, status: 'awaiting_payment' }, data: { status: 'paid' } });
    if (checkout.feeChargeId) await this.fees.settle(checkout.feeChargeId);
    await this.placeOrder(checkout.id);
  }

  private async placeOrder(checkoutId: string) {
    const checkout = await this.prisma.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
    if (checkout.status !== 'paid' || checkout.orderId) return;
    const existing = await this.prisma.order.findUnique({ where: { quoteId: checkout.quoteId } });
    if (existing) {
      // Placed by an earlier attempt that stopped before recording it.
      await this.prisma.checkout.update({ where: { id: checkout.id }, data: { orderId: existing.id } });
      if (existing.status !== 'processing') await this.orderSettled(existing.id, existing.status === 'completed' ? 'completed' : 'failed');
      return;
    }
    try {
      const simulate = checkout.mode === 'test' ? (this.sandboxOrders.get(checkout.id) ?? 'completed') : undefined;
      const order = await this.orders.create(
        checkout.resellerId,
        checkout.mode,
        { quote_id: checkout.quoteId, simulate },
        // Paid into the reseller's own gateway, the cost comes from their wallet; otherwise from what the customer paid.
        { customerId: checkout.customerId, funding: checkout.connectionId ? 'wallet' : 'customer' },
      );
      await this.prisma.checkout.update({ where: { id: checkout.id }, data: { orderId: order.id } });
      // An order that settled at once was reported before its ID was recorded here.
      if (order.status !== 'processing') await this.orderSettled(order.id, order.status === 'completed' ? 'completed' : 'failed');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // Another run (the request and the checkout job) may have placed the order with this quote meanwhile: follow
      // that order instead of refunding a customer whose order is going ahead.
      const placed = await this.prisma.order.findUnique({ where: { quoteId: checkout.quoteId } });
      if (placed) {
        await this.prisma.checkout.updateMany({ where: { id: checkout.id, orderId: null }, data: { orderId: placed.id } });
        if (placed.status !== 'processing') await this.orderSettled(placed.id, placed.status === 'completed' ? 'completed' : 'failed');
        return;
      }
      // Refused before anything was bought (the product is no longer available, or the reseller's wallet is short):
      // the customer gets their money back.
      this.logger.warn({ checkoutId, code: error.code }, 'Paid checkout could not be ordered; refunding');
      const moved = await this.prisma.checkout.updateMany({
        where: { id: checkout.id, status: 'paid', orderId: null },
        data: { status: 'refund_pending', refundKind: 'undelivered', failureReason: 'The product could not be supplied. Your payment is being refunded.' },
      });
      if (moved.count === 1 && error.code === 'insufficient_funds') {
        await this.inbox.reseller(checkout.resellerId, 'store.checkout_refused', {
          subject: `${checkout.mode}:${new Date().toISOString().slice(0, 10)}`,
          title: 'A paid store order could not be placed',
          body: 'Your wallet could not cover the cost of an order a customer had paid for, so the customer is being refunded. Top up your wallet to keep selling.',
          link: '/wallet',
          mode: checkout.mode,
        });
      }
      await this.refund(checkout.id);
    }
  }

  /** The payment failed or was abandoned: nothing was taken, and BitoCard's fee hold goes back. */
  private async unpaid(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    const checkout = await this.prisma.checkout.findUnique({ where: { paymentId } });
    await this.prisma.checkout.updateMany({
      where: { paymentId, status: 'awaiting_payment' },
      data: { status: 'failed', failureReason: payment?.failureReason ?? 'The payment was not completed.' },
    });
    if (checkout?.feeChargeId) await this.returnFee(checkout.feeChargeId, 'The customer did not pay');
  }

  /** BitoCard's gateway fee when the sale came to nothing: a hold is released, a charged fee refunded. */
  private async returnFee(chargeId: string, reason: string) {
    const charge = await this.prisma.feeCharge.findUnique({ where: { id: chargeId } });
    if (charge?.status === 'held') await this.fees.release(chargeId);
    else if (charge?.status === 'charged') await this.fees.refund(chargeId, null, reason);
  }

  private async orderSettled(orderId: string, outcome: 'completed' | 'failed' | 'refunded') {
    const checkout = await this.load({ orderId });
    if (!checkout) return;
    const product = checkout.quote.product;
    const recipient = { customerId: checkout.customerId, storeId: checkout.storeId };
    if (outcome === 'completed') {
      const done = await this.prisma.checkout.updateMany({ where: { id: checkout.id, status: 'paid' }, data: { status: 'completed' } });
      if (done.count === 1) {
        await this.inbox.customer(recipient, 'customer.order.completed', {
          subject: checkout.id,
          title: `${product.name} delivered`,
          body: emailedCategories.has(product.category) ? 'Your order is ready. Open it to see your codes; we have also emailed them to you.' : 'Your order has been delivered.',
          link: `/account/orders/${checkout.id}`,
          mode: checkout.mode,
        });
      }
      return;
    }
    // Failed after payment.
    const moved = await this.prisma.checkout.updateMany({
      where: { id: checkout.id, status: { in: ['paid', 'completed'] } },
      data: { status: 'refund_pending', refundKind: 'undelivered', failureReason: 'Your order could not be completed. Your payment is being refunded.' },
    });
    if (moved.count === 1) {
      await this.inbox.customer(recipient, 'customer.order.failed', {
        subject: checkout.id,
        title: `${product.name} could not be delivered`,
        body: `We could not complete your order, so we are refunding ${formatMoney(checkout.amountMinor, checkout.currency)} to how you paid.`,
        link: `/account/orders/${checkout.id}`,
        mode: checkout.mode,
      });
      await this.refund(checkout.id);
    }
  }

  /**
   * A finance admin refunded the delivered order (the order service has already reversed the sale): the customer's
   * payment goes back in full to how they paid.
   */
  private async refundDelivered(orderId: string) {
    const checkout = await this.prisma.checkout.findUnique({ where: { orderId } });
    if (!checkout) return;
    // `paid` too: a checkout whose delivery was not recorded (the request stopped after the order completed).
    await this.prisma.checkout.updateMany({ where: { id: checkout.id, status: { in: ['completed', 'paid'] } }, data: { status: 'refund_pending', refundKind: 'admin', failureReason: null } });
    await this.refund(checkout.id);
  }

  /**
   * Returns the customer's payment in full to how they paid (BitoCard's gateway, or the reseller's own account). Sent
   * once (the refund's ID is kept), checked until the gateway confirms it, then booked. Never throws.
   */
  async refund(checkoutId: string) {
    const checkout = await this.prisma.checkout.findUnique({ where: { id: checkoutId }, include: { payment: true } });
    if (!checkout || checkout.status !== 'refund_pending' || !checkout.payment) return checkout?.status ?? null;
    const payment = checkout.payment;
    const provider = await this.payments.providerFor(payment);
    if (!provider) {
      this.logger.error({ checkoutId, provider: payment.provider, own: Boolean(payment.connectionId) }, 'Refund needs a payment gateway that is no longer set up');
      await this.prisma.checkout.update({ where: { id: checkout.id }, data: { refundAttempts: { increment: 1 } } });
    } else {
      // Only one run sends or checks a refund at a time: claim the row by its last change (the request that settled the
      // order and the checkout job can both get here).
      const claimed = await this.prisma.checkout.updateMany({ where: { id: checkout.id, status: 'refund_pending', updatedAt: checkout.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count === 0) return (await this.prisma.checkout.findUniqueOrThrow({ where: { id: checkout.id } })).status;
      // The same reference on every retry, so the gateway recognises a refund it already made after a timeout; a new one
      // only after the gateway refused (`refundAttempts` counts refusals), since a refused reference cannot be reused.
      const base = `bc_rf_${checkout.id.replaceAll('-', '')}`;
      const ref = { ...paymentRef(payment), refundReference: checkout.refundAttempts > 0 ? `${base}_${checkout.refundAttempts}` : base };
      try {
        const result = checkout.refundReference ? await provider.refundStatus({ ...ref, providerRefundId: checkout.refundReference }) : await provider.refund(ref);
        if (!checkout.refundReference || result.status === 'failed') {
          await this.prisma.checkout.update({
            where: { id: checkout.id },
            data: { refundReference: result.status === 'failed' ? null : result.providerRefundId, refundAttempts: { increment: result.status === 'failed' ? 1 : 0 } },
          });
        }
        if (result.status === 'refunded') await this.refunded(checkout.id);
        if (result.status === 'failed') this.logger.error({ checkoutId, reason: result.failureReason }, 'Refund refused by the provider');
      } catch (error) {
        const definite = error instanceof ProviderError && error.definite;
        if (definite) await this.prisma.checkout.update({ where: { id: checkout.id }, data: { refundAttempts: { increment: 1 } } });
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', checkoutId }, 'Refund not sent yet; the checkout job retries');
      }
    }
    const after = await this.prisma.checkout.findUniqueOrThrow({ where: { id: checkout.id } });
    if (after.status === 'refund_pending' && after.refundAttempts >= maxRefundAttempts && checkout.refundAttempts < maxRefundAttempts) {
      const where = payment.connectionId ? `the reseller's own ${payment.provider} account` : payment.provider;
      await this.inbox.admins('admin.checkout.refund_stuck', {
        subject: checkout.id,
        title: 'A customer refund needs attention',
        body: `A refund of ${formatMoney(checkout.amountMinor, checkout.currency)} through ${where} failed ${maxRefundAttempts} times. Refund the customer by hand.`,
        link: '/orders',
        mode: checkout.mode,
      });
    }
    return after.status;
  }

  private async refunded(checkoutId: string) {
    const checkout = await this.prisma.checkout.findUniqueOrThrow({ where: { id: checkoutId }, include: { payment: true } });
    // Paid through BitoCard's gateway: what the customer paid leaves `customer_payments`. The reseller's own gateway
    // never touched BitoCard's ledger.
    const entry = checkout.connectionId
      ? null
      : await this.ledger.prepare({
          mode: checkout.mode,
          type: 'checkout_refund',
          reference: `checkout_refund:${checkout.id}`,
          resellerId: checkout.resellerId,
          description: checkout.refundKind === 'admin' ? 'Customer refunded: order refunded' : 'Customer refunded: order not delivered',
          metadata: { checkout_id: checkout.id, payment_id: checkout.paymentId },
          lines: [
            { account: { kind: 'customer_payments', currency: checkout.currency, resellerId: checkout.resellerId }, debit: checkout.amountMinor },
            { account: { kind: 'provider_balance', currency: checkout.currency, provider: checkout.payment!.provider }, credit: checkout.amountMinor },
          ],
        });
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.checkout.updateMany({ where: { id: checkout.id, status: 'refund_pending' }, data: { status: 'refunded', refundedAt: new Date() } });
      if (claimed.count === 1 && entry) await this.ledger.write(tx, entry);
      return claimed.count === 1;
    });
    if (!done) return;
    // BitoCard keeps its gateway fee only for a sale that was delivered.
    if (checkout.feeChargeId && checkout.refundKind !== 'admin') {
      await this.returnFee(checkout.feeChargeId, 'The order was not delivered').catch(error => this.logger.error({ err: error, checkoutId }, 'Gateway fee not returned'));
    }
    await this.inbox.customer({ customerId: checkout.customerId, storeId: checkout.storeId }, 'customer.order.refunded', {
      subject: checkout.id,
      title: `${formatMoney(checkout.amountMinor, checkout.currency)} refunded`,
      body: 'Your refund has been sent to how you paid. Banks and mobile money providers can take a few days to show it.',
      link: `/account/orders/${checkout.id}`,
      mode: checkout.mode,
    });
  }

  /**
   * The `checkout` job: places orders for paid checkouts whose order was not placed (the request stopped), retries
   * and checks refunds, and closes checkouts whose payment failed. Safe to run twice or late.
   */
  async job(now = new Date()) {
    const outcome = { ordered: 0, refunds: 0, closed: 0 };
    const stalled = await this.prisma.checkout.findMany({ where: { status: 'paid', orderId: null, updatedAt: { lt: new Date(now.getTime() - minute) } }, take: 50 });
    for (const checkout of stalled) {
      try {
        // A fee left held by an interrupted request is charged before the order (settling twice is harmless).
        if (checkout.feeChargeId) await this.fees.settle(checkout.feeChargeId);
        await this.placeOrder(checkout.id);
      } catch (error) {
        this.logger.error({ err: error, checkoutId: checkout.id }, 'Could not place the order');
      }
      outcome.ordered += 1;
    }
    const refunds = await this.prisma.checkout.findMany({ where: { status: 'refund_pending', refundAttempts: { lt: maxRefundAttempts } }, take: 50 });
    for (const checkout of refunds) {
      if ((await this.refund(checkout.id)) === 'refunded') outcome.refunds += 1;
    }
    const unpaid = await this.prisma.checkout.findMany({ where: { status: 'awaiting_payment', payment: { status: 'failed' } }, select: { paymentId: true }, take: 100 });
    for (const checkout of unpaid) {
      if (checkout.paymentId) await this.unpaid(checkout.paymentId);
      outcome.closed += 1;
    }
    return outcome;
  }
}
