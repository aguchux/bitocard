import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CustomerWalletsService } from '../checkout/customer-wallets.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { linkPattern, heldUnits, invalid, priceText } from '../classifieds/rules.js';
import { ResaleService } from '../classifieds/resale.service.js';
import { SafePayGuardsService } from '../classifieds/safe-pay-guards.service.js';
import { deliveryOptions, fulfilmentOf, newSellerSales, orderInclude, type OrderRow, safePayFee, SafePayService, totalOf } from '../classifieds/safe-pay.service.js';
import { publicName } from '../classifieds/search.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { templateFor } from '../stores/templates.js';
import { redact } from '../support/redact.js';
import { EventsService } from '../webhooks/events.service.js';
import { moved } from './pricing.js';
import { ResaleStoresService } from './resale-stores.service.js';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
/** Units one resale order can buy. */
export const maxQuantity = 10;
/** Reseller strikes count over this many days. */
export const resellerStrikeDays = 90;
export const orderThreads = ['order', 'trade'] as const;
export type OrderThread = (typeof orderThreads)[number];
export const resaleOrderStatuses = ['locked', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded', 'declined', 'cancelled', 'lapsed'] as const;
const maxThreadMessage = 2000;

const notFound = (what = 'order') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const unavailable = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message);

/** Asking to be paid outside BitoCard, or for bank details: never in an order's threads. */
const paymentWords = /\b(pay\s+(me|us)\s+(directly|direct|outside|cash)|pay\s+outside|transfer\s+(it\s+|the\s+money\s+)?to\s+(my|our)|account\s+(number|no\.?|details)|bank\s+(details|transfer)|send\s+(the\s+|your\s+)?money)\b/i;

/**
 * A message for an order's threads: plain text, at most 2,000 characters, never a link, an account or card number, or
 * a request to pay outside BitoCard (the order is already paid through it); codes and passwords are masked.
 */
export function checkOrderMessage(raw: string) {
  const text = (raw ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw invalid('parameter_missing', 'Write a message.', 'body');
  if (text.length > maxThreadMessage) throw invalid('parameter_invalid', `Messages can be at most ${maxThreadMessage} characters.`, 'body');
  if (linkPattern.test(text) || /\d(?:[ -]?\d){9,}/.test(text) || paymentWords.test(text)) {
    throw invalid('message_refused', 'Links, account or card numbers and requests to pay outside BitoCard cannot be sent here: the order is already paid through BitoCard.', 'body');
  }
  return redact(text);
}

const covers = [
  'Your money is locked in your wallet until the supplier confirms, then held by BitoCard until you have the item.',
  'If the order is not confirmed, or is cancelled, it goes straight back to your wallet.',
  'At a hand-over in person, give your release code only once you have checked the item.',
  'For a delivery, confirm when it arrives in good condition, or open a dispute if it does not, or is not as described.',
];

type BuyInput = { ref: number; quantity?: number; fulfilment: 'meet_up' | 'delivery'; delivery_address?: string; delivery_state_id?: string };

/**
 * B2B reselling, stage 4 (`docs/BITOCARD_B2B_RESELLING_PLAN.md`): buying on a Resale shop. The buyer, a customer of the
 * reseller's store, buys from their store wallet; the total is locked in the same transaction that creates the order
 * (`customer_wallet` to `customer_wallet_locked`, the stock held), every figure fixed then; the supplier accepts in the
 * Shop tab (or it is accepted by itself) and Safe pay takes it from there: escrow, hand-over or tracked shipping,
 * release split three ways. This service is the buyer's side, the reseller's (`/v1/resale/orders`), both order threads,
 * reseller strikes and the `resale_order.*` events, which Safe pay reports through `useResaleEvents`.
 */
@Injectable()
export class ResaleOrdersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safePay: SafePayService,
    private readonly stores: ResaleStoresService,
    private readonly resale: ResaleService,
    private readonly guards: SafePayGuardsService,
    private readonly wallets: CustomerWalletsService,
    private readonly sellers: StoreSellers,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.safePay.useResaleEvents({ changed: (tx, id) => this.recordEvent(tx, id, 'resale_order.updated'), committed: () => this.events.committed() });
    this.safePay.useResellerStrikes(async (resellerId, country) => {
      await this.afterStrike(resellerId, country);
    });
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(key);
  }

  // ---- The buyer ----

  /** The buyer's store: a published Resale shop of a reseller who can resell now. */
  private async shop(customer: CustomerWithStore) {
    const store = customer.store;
    if (store.reseller.house || !templateFor(store.template)?.resale || store.status !== 'published') throw notFound('store');
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: store.resellerId }, select: { id: true, status: true, country: true, resaleStrikesClearedAt: true } });
    if (reseller.status === 'suspended') throw notFound('store');
    const country = await this.stores.canResell(reseller.id);
    if (!country) throw unavailable('resale_checkout_unavailable', 'This store cannot take orders at the moment.');
    return { store, reseller, country, mode: this.sellers.mode(store) };
  }

  /** The listing on sale in the buyer's store, with the price and terms worked out now. */
  private async item(storeId: string, country: string, ref: number) {
    const [item] = await this.stores.onSale(storeId, country, { listingRef: BigInt(ref) });
    if (!item) throw conflict('listing_unavailable', 'This is not available here any more.', 'ref');
    return item;
  }

  /** What buying would cost: the price for the units, any delivery charge, BitoCard's fee and the total, and the wallet. */
  async quote(customer: CustomerWithStore, input: BuyInput) {
    const context = await this.shop(customer);
    const figures = await this.figures(customer, context, input);
    const balance = await this.wallets.balance(customer.id, context.mode, figures.currency);
    return {
      object: 'resale_order_quote' as const,
      ref: input.ref,
      quantity: figures.quantity,
      currency: figures.currency,
      price: Number(figures.price),
      delivery_fee: Number(figures.deliveryFee),
      buyer_fee: Number(figures.buyerFee),
      total: Number(figures.total),
      wallet_balance: Number(balance),
      enough: balance >= figures.total,
      available: figures.available,
      fulfilment: fulfilmentOf(figures.listing),
      delivery: deliveryOptions(figures.listing),
      phone_confirmed: Boolean(customer.phoneVerifiedAt && customer.phone),
      accept_hours: figures.acceptHours,
      covers,
    };
  }

  /** Every figure of a purchase, fixed when the buyer buys. */
  private async figures(customer: CustomerWithStore, context: Awaited<ReturnType<ResaleOrdersService['shop']>>, input: BuyInput) {
    const item = await this.item(context.store.id, context.country, input.ref);
    const listing = await this.prisma.classifiedListing.findUniqueOrThrow({ where: { id: item.row.listingId } });
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(maxQuantity, item.left)) {
      throw invalid('parameter_invalid', item.left === 1 ? 'There is 1 left.' : `Choose from 1 to ${Math.min(maxQuantity, item.left)}.`, 'quantity');
    }
    const [safePay, limits] = await Promise.all([this.prisma.classifiedSafePaySettings.findUnique({ where: { country: context.country } }), this.resale.limits(context.country)]);
    if (!(await this.settings.isOnForCountry('classifieds_safe_pay', context.country)) || !safePay || safePay.buyerFeeBps === null || safePay.buyerFeeCapMinor === null || safePay.sellerFeeBps === null || safePay.sellerFeeCapMinor === null) {
      throw unavailable('resale_checkout_unavailable', 'Buying here is not open in this country yet.');
    }
    if (limits.resellerFeeBps === null || limits.resellerFeeCapMinor === null) throw unavailable('resale_checkout_unavailable', 'Buying here is not open in this country yet.');
    const units = BigInt(quantity);
    const supplierPrice = listing.priceMinor! * units;
    const price = item.price * units;
    const supplierNet = moved(listing.priceMinor!, -item.terms.discountBps) * units;
    const fulfilment = await this.safePay.checkFulfilment(listing, input);
    const buyerFee = safePayFee(price, safePay.buyerFeeBps, safePay.buyerFeeCapMinor);
    return {
      item,
      listing,
      quantity,
      currency: listing.currency,
      supplierPrice,
      price,
      supplierNet,
      margin: price - supplierNet,
      buyerFee,
      deliveryFee: fulfilment.fee,
      fulfilment,
      total: price + fulfilment.fee + buyerFee,
      available: item.left,
      acceptHours: limits.acceptHours,
      safePay: { ...safePay, buyerFeeBps: safePay.buyerFeeBps, buyerFeeCapMinor: safePay.buyerFeeCapMinor, sellerFeeBps: safePay.sellerFeeBps, sellerFeeCapMinor: safePay.sellerFeeCapMinor },
      limits: { resellerFeeBps: limits.resellerFeeBps, resellerFeeCapMinor: limits.resellerFeeCapMinor, resellerStrikeLimit: limits.resellerStrikeLimit },
    };
  }

  /**
   * The buyer buys: everything is checked (the store, the listing on sale at this price, the stock, the three people,
   * strikes, the wallet), then the total is locked and the order created in one transaction, the listing's row locked
   * so stock is never sold twice. `expected_total` (what the buyer was shown) refuses a changed total.
   */
  async buy(customer: CustomerWithStore, input: BuyInput & { expected_total: number }) {
    const context = await this.shop(customer);
    if (!customer.emailVerifiedAt) throw unavailable('email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    if (!customer.phone || !customer.phoneVerifiedAt) throw conflict('phone_required', 'Confirm your mobile number on your account first: the supplier calls it to deliver.', 'phone');
    if (!(await this.wallets.enabled({ id: context.reseller.id }, context.mode, context.store))) throw unavailable('resale_checkout_unavailable', 'This store cannot take orders at the moment.');
    const figures = await this.figures(customer, context, input);
    if (BigInt(input.expected_total) !== figures.total) throw conflict('price_changed', `The total is now ${priceText(figures.total, figures.currency)}. Check it and buy again.`, 'expected_total');
    const supplierId = figures.listing.customerId;
    if (supplierId === customer.id) throw invalid('parameter_invalid', 'This is your own listing.', 'ref');
    await this.guards.requireDifferentPeople(customer.id, supplierId);
    await this.requireResellerApart(context.reseller.id, [customer.id, supplierId]);
    await this.guards.requireNotLimited(supplierId, context.country, false);
    const standing = await this.standing(context.reseller.id, context.country);
    if (standing.limited) throw unavailable('resale_checkout_unavailable', 'This store cannot take orders at the moment.');
    if (figures.safePay.newSellerOrderLimitMinor !== null && figures.price > figures.safePay.newSellerOrderLimitMinor) {
      const sales = await this.prisma.classifiedOrder.count({ where: { sellerId: supplierId, status: 'released' } });
      if (sales < newSellerSales) throw conflict('new_seller_limit', `This supplier is new: orders can be at most ${priceText(figures.safePay.newSellerOrderLimitMinor, figures.currency)} for now.`);
    }
    const balance = await this.wallets.balance(customer.id, context.mode, figures.currency);
    if (balance < figures.total) throw this.walletLow(figures.total - balance, figures.currency);

    const id = randomUUID();
    const now = new Date();
    const entry = await this.ledger.prepare({
      mode: context.mode,
      type: 'classified_lock',
      reference: `classified_order:${id}:locked`,
      description: `Order on ${context.store.name}`,
      resellerId: context.reseller.id,
      lines: [
        { account: { kind: 'customer_wallet', currency: figures.currency, customerId: customer.id }, debit: figures.total },
        { account: { kind: 'customer_wallet_locked', currency: figures.currency, customerId: customer.id }, credit: figures.total },
      ],
    });
    const listing = figures.listing;
    const row = figures.item.row;
    const supplierName = figures.item.row.listing.customer.name;
    const snapshot = {
      title: listing.title,
      condition: listing.condition,
      description: listing.description,
      note: row.noteStatus === 'approved' ? row.note : null,
      supplier: publicName(supplierName),
    };
    try {
      await this.prisma.$transaction(async tx => {
        const [locked] = await tx.$queryRaw<{ stock: number }[]>`SELECT "stock" FROM "classified_listings" WHERE "id" = ${listing.id}::uuid FOR UPDATE`;
        if (!locked || (await heldUnits(tx, listing.id)) + figures.quantity > locked.stock) throw conflict('listing_reserved', 'Someone has just bought the last of these.');
        await tx.classifiedOrder.create({
          data: {
            id,
            kind: 'resale',
            listingId: listing.id,
            buyerId: customer.id,
            sellerId: supplierId,
            storeId: context.store.id,
            resellerId: context.reseller.id,
            resaleListingId: row.id,
            dealId: figures.item.deal?.id ?? null,
            mode: context.mode,
            country: context.country,
            currency: figures.currency,
            quantity: figures.quantity,
            priceMinor: figures.price,
            supplierPriceMinor: figures.supplierPrice,
            discountBps: figures.item.terms.discountBps,
            supplierNetMinor: figures.supplierNet,
            resellerMarginMinor: figures.margin,
            resellerFeeBps: figures.limits.resellerFeeBps,
            resellerFeeCapMinor: figures.limits.resellerFeeCapMinor,
            buyerFeeBps: figures.safePay.buyerFeeBps,
            buyerFeeCapMinor: figures.safePay.buyerFeeCapMinor,
            buyerFeeMinor: figures.buyerFee,
            sellerFeeBps: figures.safePay.sellerFeeBps,
            sellerFeeCapMinor: figures.safePay.sellerFeeCapMinor,
            deliveryFeeMinor: figures.deliveryFee,
            deliveryStateId: figures.fulfilment.stateId,
            fulfilment: input.fulfilment,
            deliveryAddress: figures.fulfilment.address ? this.encryption().encrypt(figures.fulfilment.address) : null,
            buyerPhone: this.encryption().encrypt(customer.phone!),
            snapshot,
            status: 'locked',
            lockedAt: now,
            acceptBy: new Date(now.getTime() + figures.acceptHours * hourMs),
          },
        });
        await this.ledger.write(tx, entry);
        await tx.resaleOrderMessage.create({ data: { orderId: id, thread: 'order', author: 'bitocard', body: 'Your order is placed. Your payment is locked in your wallet until the supplier confirms it; never pay anyone outside BitoCard.' } });
        await this.recordEvent(tx, id, 'resale_order.created');
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw this.walletLow(figures.total, figures.currency);
      throw error;
    }
    this.events.committed();
    let order = await this.safePay.reloadOrder(id);
    await this.inbox.customer({ customerId: order.seller.id, storeId: order.seller.storeId }, 'customer.classifieds.order_requested', {
      subject: `${id}:requested`,
      title: `New order through ${context.store.name}`,
      body: `"${order.listing.title}" × ${order.quantity}, paid and locked. Accept within ${figures.acceptHours} hours.`,
      link: `/shop/orders/${id}`,
      mode: order.mode,
    });
    await this.inbox.reseller(context.reseller.id, 'resale.order_new', { subject: `${id}:new`, title: `New order SP-${order.number}`, body: `"${order.listing.title}" × ${order.quantity} for ${priceText(order.priceMinor, order.currency)}. It waits for the supplier to accept.`, link: `/resale/orders/${id}`, mode: order.mode });
    // A supplier who chose auto-accept takes it straight away (if they can accept now).
    if (await this.safePay.autoAccept(id)) order = await this.safePay.reloadOrder(id);
    return this.safePay.present(order, 'buyer');
  }

  async purchases(customer: CustomerWithStore, filter: { limit?: number; offset?: number }) {
    if (customer.store.reseller.house) throw notFound('store');
    const where = { buyerId: customer.id, kind: 'resale', storeId: customer.storeId };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: filter.limit ?? 30, skip: filter.offset ?? 0 }),
      this.prisma.classifiedOrder.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.safePay.present(row, 'buyer')), total };
  }

  async purchase(customer: CustomerWithStore, id: string) {
    return this.safePay.present(await this.buyerOrder(customer, id), 'buyer');
  }

  private async buyerOrder(customer: CustomerWithStore, id: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || order.kind !== 'resale' || order.buyerId !== customer.id || order.storeId !== customer.storeId) throw notFound();
    return order;
  }

  private walletLow(short: bigint, currency: string) {
    return new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Add ${priceText(short, currency)} to your wallet to buy this.`, 'amount');
  }

  // ---- Three different people ----

  /**
   * The reseller (its owner and team) must not be the buyer or the supplier: refused when a team member's email is one
   * of theirs, or the reseller's verified owner has their verified name and date of birth. Admins are told once.
   */
  async requireResellerApart(resellerId: string, customerIds: string[]) {
    const [members, reseller, customers, cases] = await Promise.all([
      this.prisma.resellerMember.findMany({ where: { resellerId }, select: { user: { select: { email: true } } } }),
      this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { verifiedName: true } }),
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, email: true } }),
      this.prisma.kycCase.findMany({ where: { subject: 'customer', customerReference: { in: customerIds }, status: { notIn: ['declined'] } }, select: { fullName: true } }),
    ]);
    const emails = new Set(members.map(member => member.user.email.toLowerCase()));
    const key = (name: string | null | undefined) => (name ? name.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ') : null);
    const owner = key(reseller?.verifiedName);
    const same = customers.some(customer => emails.has(customer.email.toLowerCase())) || (owner !== null && cases.some(row => key(row.fullName) === owner));
    if (!same) return;
    await this.inbox.admins('admin.classifieds.same_person', { subject: `reseller:${resellerId}:${customerIds.join(':')}`, title: 'Resale order refused: the reseller on another side', body: 'A reseller matched the buyer or the supplier of a resale order by email or verified name. The order was refused; check the accounts.', link: `/resellers/${resellerId}` });
    throw unavailable('same_person', 'This order cannot be placed here.');
  }

  // ---- Reseller strikes ----

  /**
   * A reseller's strikes in the last 90 days (since an admin last lifted them) against the country's limit: resale
   * orders their stores cancelled, disputes lost because of their store (BitoCard's `fault: reseller`) and upheld
   * reports of their stores.
   */
  async standing(resellerId: string, country: string) {
    const [reseller, limits] = await Promise.all([this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { resaleStrikesClearedAt: true } }), this.resale.limits(country)]);
    const window = new Date(Date.now() - resellerStrikeDays * dayMs);
    const since = reseller?.resaleStrikesClearedAt && reseller.resaleStrikesClearedAt > window ? reseller.resaleStrikesClearedAt : window;
    const [cancelled, disputes, reports] = await Promise.all([
      this.prisma.classifiedOrder.count({ where: { resellerId, endedBy: 'reseller', OR: [{ closedAt: { gt: since } }, { refundedAt: { gt: since } }] } }),
      this.prisma.classifiedDispute.count({ where: { fault: 'reseller', decidedAt: { gt: since }, order: { resellerId } } }),
      this.prisma.resaleStoreReport.count({ where: { resellerId, status: 'upheld', decidedAt: { gt: since } } }),
    ]);
    const strikes = cancelled + disputes + reports;
    return { strikes, strike_limit: limits.resellerStrikeLimit, limited: strikes >= limits.resellerStrikeLimit, cancelled_by_store: cancelled, disputes_lost: disputes, reports_upheld: reports, cleared_at: reseller?.resaleStrikesClearedAt?.toISOString() ?? null };
  }

  /** After a strike: a reseller who has just reached the limit is told their checkout is paused, and so are admins (once until lifted). */
  async afterStrike(resellerId: string, country: string) {
    const standing = await this.standing(resellerId, country);
    if (!standing.limited) return standing;
    const subject = `${resellerId}:${standing.cleared_at ?? 'never'}`;
    await this.inbox.reseller(resellerId, 'resale.order_updated', { subject: `limited:${subject}`, title: 'Your Resale shop checkout is paused', body: `Your stores have ${standing.strikes} strikes in ${resellerStrikeDays} days (orders cancelled, disputes lost, reports upheld). Contact BitoCard to have it reviewed.`, link: '/resale/orders' });
    await this.inbox.admins('admin.classifieds.seller_limited', { subject: `reseller:${subject}`, title: 'A reseller reached the resale strike limit', body: `${standing.cancelled_by_store} orders cancelled, ${standing.disputes_lost} disputes lost and ${standing.reports_upheld} reports upheld in ${resellerStrikeDays} days.`, link: `/resellers/${resellerId}` });
    return standing;
  }

  async clearStrikes(actorId: string | null, resellerId: string, reason: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { id: true, country: true } });
    if (!reseller?.country) throw notFound('reseller');
    const before = await this.standing(resellerId, reseller.country);
    await this.prisma.reseller.update({ where: { id: resellerId }, data: { resaleStrikesClearedAt: new Date() } });
    await this.audit.record({ actorId, action: 'resale.strikes_cleared', targetType: 'reseller', targetId: resellerId, before: { strikes: before.strikes, limited: before.limited }, after: { reason } });
    return { object: 'resale_standing' as const, reseller_id: resellerId, ...(await this.standing(resellerId, reseller.country)) };
  }

  async adminStanding(resellerId: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { country: true } });
    if (!reseller?.country) throw notFound('reseller');
    return { object: 'resale_standing' as const, reseller_id: resellerId, ...(await this.standing(resellerId, reseller.country)) };
  }

  // ---- The reseller ----

  private async resellerOrder(resellerId: string, id: string, scope?: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || order.kind !== 'resale' || order.resellerId !== resellerId || (scope && order.storeId !== scope)) throw notFound();
    return order;
  }

  async list(resellerId: string, filter: { status?: string; store_id?: string; limit?: number; offset?: number }, scope?: string) {
    const where: Prisma.ClassifiedOrderWhereInput = {
      kind: 'resale',
      resellerId,
      ...(scope ? { storeId: scope } : filter.store_id ? { storeId: filter.store_id } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.classifiedOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.prisma.classifiedOrder.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => summary(row)), has_more: offset + rows.length < total, total };
  }

  /** One order for the reseller, with the buyer's details once accepted (the view logged) and its shipment. */
  async get(resellerId: string, id: string, viewerId: string | null, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    const details = await this.safePay.buyerDetails(order, { viewer: 'reseller', viewerId });
    return this.detail(order, details);
  }

  private detail(order: OrderRow, details: Awaited<ReturnType<SafePayService['buyerDetails']>>) {
    const full = this.safePay.present(order, 'reseller', details);
    return {
      ...summary(order),
      supplier: full.supplier!,
      buyer: details,
      note_shown: ((order.snapshot as { note?: string | null } | null)?.note ?? null) as string | null,
      shipment: full.shipment,
      deadlines: full.deadlines,
      timeline: full.timeline,
      ended_by: order.endedBy,
      end_reason: order.endReason,
      dispute: full.dispute,
    };
  }

  async cancel(resellerId: string, id: string, reason: string | undefined, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    await this.safePay.cancelForStore(order.id, resellerId, reason ?? null);
    await this.afterStrike(resellerId, order.country);
    return this.detail(await this.resellerOrder(resellerId, id, scope), null);
  }

  async resellerDispatchPhoto(resellerId: string, id: string, photoId: string, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    return this.safePay.dispatchPhoto(order, photoId);
  }

  // ---- Threads ----

  /**
   * An order's messages for one viewer. The buyer reads only the order chat, every store message as the store's; the
   * supplier and the reseller read both threads, with who wrote each.
   */
  private presentMessage(message: { id: string; thread: string; author: string; body: string; createdAt: Date }, order: OrderRow, viewer: 'buyer' | 'supplier' | 'reseller') {
    const storeSide = message.author === 'supplier' || message.author === 'reseller';
    const from = message.author === 'bitocard' ? 'bitocard' : message.author === viewer ? 'me' : viewer === 'buyer' && storeSide ? 'store' : message.author;
    return {
      object: 'resale_order_message' as const,
      id: message.id,
      thread: message.thread as OrderThread,
      from,
      name: message.author === 'bitocard' ? 'BitoCard' : storeSide && viewer === 'buyer' ? (order.store?.name ?? '') : message.author === 'buyer' ? publicName(order.buyer.name) : message.author === 'supplier' ? publicName(order.seller.name) : (order.store?.name ?? ''),
      body: message.body,
      created_at: message.createdAt.toISOString(),
    };
  }

  private async read(order: OrderRow, viewer: 'buyer' | 'supplier' | 'reseller', thread: OrderThread, after?: string) {
    if (viewer === 'buyer' && thread !== 'order') throw notFound('thread');
    const since = after ? await this.prisma.resaleOrderMessage.findFirst({ where: { id: after, orderId: order.id }, select: { createdAt: true } }) : null;
    const rows = await this.prisma.resaleOrderMessage.findMany({ where: { orderId: order.id, thread, ...(since ? { createdAt: { gt: since.createdAt } } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 });
    return { object: 'list' as const, thread, data: rows.map(row => this.presentMessage(row, order, viewer)) };
  }

  /** Writes in a thread (open while the order is, and 30 days after) and tells the others who read it. */
  private async write(order: OrderRow, author: 'buyer' | 'supplier' | 'reseller', authorId: string | null, thread: OrderThread, raw: string) {
    if (author === 'buyer' && thread !== 'order') throw notFound('thread');
    const ended = order.releasedAt ?? order.refundedAt ?? order.closedAt;
    if (ended && Date.now() - ended.getTime() > 30 * dayMs) throw conflict('thread_closed', 'This order ended more than 30 days ago.');
    const body = checkOrderMessage(raw);
    const message = await this.prisma.resaleOrderMessage.create({ data: { orderId: order.id, thread, author, authorId, body } });
    const preview = body.slice(0, 140);
    const toBuyer = thread === 'order' && author !== 'buyer';
    const toSupplier = author !== 'supplier';
    const toReseller = author !== 'reseller';
    if (toBuyer) await this.inbox.customer({ customerId: order.buyer.id, storeId: order.buyer.storeId }, 'customer.purchase.message', { subject: message.id, title: `${order.store?.name ?? 'The store'} wrote about your order`, body: preview, link: `/account/purchases/${order.id}`, mode: order.mode });
    if (toSupplier) await this.inbox.customer({ customerId: order.seller.id, storeId: order.seller.storeId }, 'customer.classifieds.order_message', { subject: message.id, title: `${author === 'buyer' ? 'The buyer' : order.store?.name} wrote on SP-${order.number}${thread === 'trade' ? ' (trade thread)' : ''}`, body: preview, link: `/shop/orders/${order.id}`, mode: order.mode });
    if (toReseller && order.resellerId) await this.inbox.reseller(order.resellerId, 'resale.order_message', { subject: message.id, title: `${author === 'buyer' ? 'The buyer' : 'The supplier'} wrote on SP-${order.number}${thread === 'trade' ? ' (trade thread)' : ''}`, body: preview, link: `/resale/orders/${order.id}`, mode: order.mode });
    return this.presentMessage(message, order, author);
  }

  async buyerMessages(customer: CustomerWithStore, id: string, after?: string) {
    return this.read(await this.buyerOrder(customer, id), 'buyer', 'order', after);
  }

  async buyerWrites(customer: CustomerWithStore, id: string, body: string) {
    return this.write(await this.buyerOrder(customer, id), 'buyer', customer.id, 'order', body);
  }

  private async supplierOrder(customer: CustomerWithStore, id: string) {
    if (!customer.store.reseller.house) throw notFound();
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || order.kind !== 'resale' || order.sellerId !== customer.id) throw notFound();
    return order;
  }

  async supplierMessages(customer: CustomerWithStore, id: string, thread: OrderThread, after?: string) {
    return this.read(await this.supplierOrder(customer, id), 'supplier', thread, after);
  }

  async supplierWrites(customer: CustomerWithStore, id: string, thread: OrderThread, body: string) {
    return this.write(await this.supplierOrder(customer, id), 'supplier', customer.id, thread, body);
  }

  async resellerMessages(resellerId: string, id: string, thread: OrderThread, after?: string, scope?: string) {
    return this.read(await this.resellerOrder(resellerId, id, scope), 'reseller', thread, after);
  }

  async resellerWrites(resellerId: string, userId: string | null, id: string, thread: OrderThread, body: string, scope?: string) {
    return this.write(await this.resellerOrder(resellerId, id, scope), 'reseller', userId, thread, body);
  }

  /** Deletes the threads of resale orders that ended more than 12 months ago (like Shop chats). */
  async purgeOldThreads(now = new Date()) {
    const before = new Date(now.getTime() - 365 * dayMs);
    const { count } = await this.prisma.resaleOrderMessage.deleteMany({
      where: { order: { kind: 'resale', OR: [{ releasedAt: { lt: before } }, { refundedAt: { lt: before } }, { closedAt: { lt: before } }], status: { notIn: ['locked', 'paid', 'sent', 'disputed'] } } },
    });
    return count;
  }

  // ---- Suppliers' auto-accept ----

  async autoAccept(customer: CustomerWithStore) {
    if (!customer.store.reseller.house) throw notFound();
    const row = await this.prisma.classifiedSeller.findUnique({ where: { customerId: customer.id }, select: { resaleAutoAccept: true } });
    return { object: 'resale_auto_accept' as const, enabled: row?.resaleAutoAccept ?? false };
  }

  async setAutoAccept(customer: CustomerWithStore, enabled: boolean) {
    if (!customer.store.reseller.house) throw notFound();
    await this.prisma.classifiedSeller.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id, resaleAutoAccept: enabled }, update: { resaleAutoAccept: enabled } });
    return this.autoAccept(customer);
  }

  // ---- Events ----

  /** Records a resale order's event in the transaction that changed it (`resale_order.created` or `.updated`). */
  async recordEvent(tx: Prisma.TransactionClient, id: string, type: 'resale_order.created' | 'resale_order.updated') {
    const order = await tx.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || order.kind !== 'resale' || !order.resellerId) return;
    await this.events.record(tx, { resellerId: order.resellerId, storeId: order.storeId, mode: order.mode, type, object: summary(order) });
  }
}

/** A resale order as the reseller's lists and events carry it: its figures and state, never the buyer's details. */
export function summary(order: OrderRow) {
  return {
    object: 'resale_order' as const,
    id: order.id,
    number: `SP-${order.number}`,
    mode: order.mode,
    store_id: order.storeId!,
    status: order.status,
    listing: { id: order.listing.id, ref: Number(order.listing.ref), title: order.listing.title ?? '' },
    quantity: order.quantity,
    currency: order.currency,
    price: Number(order.priceMinor),
    delivery_fee: Number(order.deliveryFeeMinor),
    buyer_fee: Number(order.buyerFeeMinor),
    total: Number(totalOf(order)),
    supplier_net: Number(order.supplierNetMinor),
    margin: Number(order.resellerMarginMinor),
    reseller_fee: order.resellerFeeMinor === null ? null : Number(order.resellerFeeMinor),
    earnings: order.resellerPayoutMinor === null ? null : Number(order.resellerPayoutMinor),
    refund: order.refundMinor === null ? null : Number(order.refundMinor),
    deal_id: order.dealId,
    fulfilment: order.fulfilment as 'meet_up' | 'delivery',
    courier: order.courier,
    tracking_number: order.trackingNumber,
    tracking_url: order.trackingUrl,
    delivered_at: order.deliveredAt?.toISOString() ?? null,
    accept_by: order.acceptBy.toISOString(),
    accepted_at: order.acceptedAt?.toISOString() ?? null,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
