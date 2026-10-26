import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { CustomerWalletsService } from '../checkout/customer-wallets.js';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { checkDocument, maxDocumentBytes } from '../kyc/files.js';
import { KycStorage } from '../kyc/storage.js';
import { type Line, LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { cleanMessage } from './conversations.service.js';
import { SafePayGuardsService } from './safe-pay-guards.service.js';
import { ListingsService } from './listings.service.js';
import type { MediaUpload } from './media.service.js';
import { heldUnits, invalid, isOnShop, priceText } from './rules.js';
import { publicName } from './search.service.js';
import { ShopTermsService } from './terms.service.js';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
/** A seller enters the release code at most this many times. */
export const releaseCodeTries = 5;
/** A seller's first Safe pay sales, while the new-seller order limit applies. */
export const newSellerSales = 5;
/** An accepted offer can be paid with Safe pay for this long. */
export const acceptedOfferMs = 7 * dayMs;
/** Photos one dispute can hold. */
export const maxDisputePhotos = 20;
export const disputeReasons = ['not_received', 'not_as_described', 'damaged', 'other'] as const;
export type DisputeReason = (typeof disputeReasons)[number];
export const disputeDecisions = ['refund', 'partial', 'release'] as const;
export type DisputeDecision = (typeof disputeDecisions)[number];
export const disputeFaults = ['supplier', 'reseller', 'none'] as const;
export type DisputeFault = (typeof disputeFaults)[number];
/** Dispatch photos one order can hold, and the fewest that mark it shipped. */
export const maxDispatchPhotos = 8;
export const minDispatchPhotos = 2;
/** What a seller reports about a parcel after shipping it. */
export const shipmentUpdates = ['in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned'] as const;
export type ShipmentUpdate = (typeof shipmentUpdates)[number];
/** A resale buyer's details stay on the order this long after it ends. */
export const buyerDetailsDays = 30;

type Side = 'buyer' | 'seller';
/** Who looks at an order: its buyer, its seller (the supplier of a resale order), the reseller who sold it, or BitoCard. */
export type Viewer = Side | 'reseller' | 'admin';
type Settings = { buyerFeeBps: number; buyerFeeCapMinor: bigint; sellerFeeBps: number; sellerFeeCapMinor: bigint; newSellerOrderLimitMinor: bigint | null; acceptHours: number; payHours: number; handoverDays: number; confirmDays: number };

const notFound = (what = 'order') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const unavailable = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'safe_pay_unavailable', message);
const notYours = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'order_not_yours', message);

/** What the buyer pays in all: the price, any delivery charge and their fee. */
export const totalOf = (order: { priceMinor: bigint; deliveryFeeMinor: bigint; buyerFeeMinor: bigint }) => order.priceMinor + order.deliveryFeeMinor + order.buyerFeeMinor;

/**
 * The delivery charge for a listing to a state: within the seller's state, or elsewhere where they deliver nationwide.
 * Without a state, a seller delivering only in their state charges its fee, one delivering nationwide the nationwide fee.
 */
export function deliveryFee(listing: { delivery: string; stateId: string | null; deliveryFeeStateMinor: bigint; deliveryFeeNationwideMinor: bigint }, stateId?: string | null) {
  if (listing.delivery === 'none') return null;
  if (stateId ? stateId === listing.stateId : listing.delivery === 'state') return listing.deliveryFeeStateMinor;
  return listing.delivery === 'nationwide' ? listing.deliveryFeeNationwideMinor : null;
}

/** Whoever reports on a resale order's events: the resale module records them (`useResaleEvents`). */
export type ResaleOrderEvents = {
  /** Inside the transaction that changed a resale order (its new state is readable through `tx`). */
  changed(tx: Prisma.TransactionClient, orderId: string): Promise<void>;
  /** After that transaction commits. */
  committed(): void;
};

/** A side's fee: the rate of the amount or the cap, whichever is smaller, rounded down to the minor unit. */
export function safePayFee(amount: bigint, bps: number, cap: bigint) {
  if (amount <= 0n || bps <= 0) return 0n;
  const byRate = (amount * BigInt(bps)) / 10_000n;
  return byRate < cap ? byRate : cap;
}

export const orderInclude = {
  listing: { select: { id: true, ref: true, title: true, slug: true, status: true, onShop: true, delivery: true, media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
  buyer: { select: { id: true, name: true, email: true, storeId: true } },
  seller: { select: { id: true, name: true, email: true, storeId: true } },
  store: { select: { id: true, name: true, subdomain: true, logoUrl: true } },
  reseller: { select: { id: true, name: true } },
  dispute: true,
  shipmentEvents: { orderBy: { createdAt: 'asc' } },
  dispatchPhotos: { orderBy: { createdAt: 'asc' }, select: { id: true, contentType: true, width: true, height: true, createdAt: true } },
} satisfies Prisma.ClassifiedOrderInclude;
export type OrderRow = Prisma.ClassifiedOrderGetPayload<{ include: typeof orderInclude }>;

const covers = [
  'Your money is held by BitoCard until you have the item.',
  'At a meet-up, give the release code only once you have inspected it.',
  'For a delivery, confirm when it arrives, or open a dispute if it does not, or is not as described.',
  'If the seller cancels or does not hand it over in time, you are refunded in full, fee included.',
];

/**
 * BitoCard Shop's Safe pay: the buyer asks at the listed price or an accepted offer, seeing their fee and the total; the
 * seller accepts (after their identity check and a payout bank account, live) seeing their fee and payout; the buyer
 * pays from their wallet into escrow (`classified_escrow`) in the same transaction that marks the order paid; hand-over
 * by the buyer's release code at a meet-up, or sent and confirmed for a delivery (released by itself once the
 * confirmation time ends); release moves the price less the seller's fee to the seller's withdrawable money (inside the
 * payout hold) and both fees to `classifieds_revenue`, once. Cancelled or not handed over in time: the buyer is refunded
 * in full, fee included. Disputes stop the release until BitoCard decides: a refund, a part refund or a release.
 */
@Injectable()
export class SafePayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly ledger: LedgerService,
    private readonly stores: StoreSellers,
    private readonly wallets: CustomerWalletsService,
    private readonly identity: IdentityService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly storage: KycStorage,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly guards: SafePayGuardsService,
    private readonly terms: ShopTermsService,
  ) {}

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(key);
  }

  private resaleEvents: ResaleOrderEvents | null = null;
  /** After a strike on a reseller (a dispute lost because of their store): the resale module tells them at the limit. */
  private resellerStrike: ((resellerId: string, country: string) => Promise<void>) | null = null;

  useResellerStrikes(after: (resellerId: string, country: string) => Promise<void>) {
    this.resellerStrike = after;
  }

  /** The resale module records resale orders' webhook events through this (it imports this module, not the other way). */
  useResaleEvents(events: ResaleOrderEvents) {
    this.resaleEvents = events;
  }

  /**
   * Claims an order out of its state (`where`, with its id), runs `work` in the same transaction and, for a resale
   * order, records its event there too. False when another change got there first.
   */
  private async claim(order: { id: string; kind: string }, where: Prisma.ClassifiedOrderWhereInput, data: Prisma.ClassifiedOrderUpdateManyMutationInput, work?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedOrder.updateMany({ where: { ...where, id: order.id }, data });
      if (!claimed.count) return false;
      await work?.(tx);
      if (order.kind === 'resale') await this.resaleEvents?.changed(tx, order.id);
      return true;
    });
    if (done && order.kind === 'resale') this.resaleEvents?.committed();
    return done;
  }

  // ---- Gates ----

  /** The country's Safe pay settings, once Safe pay is open there for this customer. */
  private async open(customer: CustomerWithStore) {
    const country = await this.listings.sellerCountry(customer);
    const mode = this.stores.mode(customer.store);
    if (!(await this.settings.isOnForCountry('classifieds_safe_pay', country))) throw unavailable('Safe pay is not open in this country yet.');
    const row = await this.prisma.classifiedSafePaySettings.findUnique({ where: { country } });
    if (!row || row.buyerFeeBps === null || row.buyerFeeCapMinor === null || row.sellerFeeBps === null || row.sellerFeeCapMinor === null) throw unavailable('Safe pay is not set up in this country yet.');
    const seller = await this.stores.sellerFor(customer);
    if (!(await this.wallets.enabled(seller, mode))) throw unavailable('Safe pay is paid from your BitoCard wallet, which is not open in this country.');
    const settings: Settings = { ...row, buyerFeeBps: row.buyerFeeBps, buyerFeeCapMinor: row.buyerFeeCapMinor, sellerFeeBps: row.sellerFeeBps, sellerFeeCapMinor: row.sellerFeeCapMinor };
    return { country, mode, settings, house: seller };
  }

  /** What a seller still needs before accepting Safe pay orders: their identity check and a payout bank account (live). */
  async readiness(customer: CustomerWithStore) {
    const { mode, house, country } = await this.open(customer);
    const [ready, standing] = await Promise.all([this.readinessOf(customer.id, mode, house.id, country), this.guards.standing(customer.id, country)]);
    return { ...ready, ready: ready.ready && !standing.limited, limited: standing.limited, strikes: standing.strikes, strike_limit: standing.strike_limit };
  }

  private async readinessOf(customerId: string, mode: LedgerMode, houseId: string, country: string) {
    if (mode === 'test') return { object: 'classified_safe_pay_readiness' as const, identity_checked: true, payout_account: true, ready: true };
    const [checked, account] = await Promise.all([
      this.identity.isCustomerVerified(houseId, mode, customerId),
      this.prisma.customerBankAccount.findFirst({ where: { customerId, mode, country, removedAt: null }, select: { id: true } }),
    ]);
    return { object: 'classified_safe_pay_readiness' as const, identity_checked: checked, payout_account: Boolean(account), ready: checked && Boolean(account) };
  }

  /** The price a buyer would pay: the listing's, or an offer they agreed in the last 7 days. */
  private async priceFor(customer: CustomerWithStore, country: string, listingId: string, offerId?: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId } });
    if (!listing || !isOnShop(listing) || listing.country !== country) throw notFound('listing');
    if (listing.customerId === customer.id) throw invalid('parameter_invalid', 'This is your own listing.', 'listing_id');
    if (offerId) {
      const offer = await this.prisma.classifiedOffer.findUnique({ where: { id: offerId }, include: { conversation: true } });
      if (!offer || offer.listingId !== listing.id || offer.conversation.buyerId !== customer.id) throw notFound('offer');
      if (offer.status !== 'accepted' || !offer.decidedAt || Date.now() - offer.decidedAt.getTime() > acceptedOfferMs) {
        throw conflict('offer_not_accepted', 'Use an offer the seller accepted in the last 7 days.', 'offer_id');
      }
      return { listing, price: offer.priceMinor, offerId: offer.id };
    }
    if (listing.priceKind === 'on_request' || listing.priceMinor === null || listing.priceMinor <= 0n) {
      throw conflict('price_required', 'This listing has no price: agree one by offer in the chat first.', 'offer_id');
    }
    return { listing, price: listing.priceMinor, offerId: null };
  }

  // ---- The buyer ----

  /** What Safe pay would cost the buyer: the price, their fee and the total, and what it covers. */
  async quote(customer: CustomerWithStore, listingId: string, offerId?: string) {
    const { country, settings } = await this.open(customer);
    const { listing, price, offerId: offer } = await this.priceFor(customer, country, listingId, offerId);
    const fee = safePayFee(price, settings.buyerFeeBps, settings.buyerFeeCapMinor);
    const available = Math.max(listing.stock - (await this.held(listing.id)), 0);
    return {
      object: 'classified_safe_pay_quote' as const,
      listing_id: listing.id,
      offer_id: offer,
      currency: listing.currency,
      price: Number(price),
      buyer_fee: Number(fee),
      total: Number(price + fee),
      fulfilment: fulfilmentOf(listing),
      /** The delivery charge on top, within the seller's state and elsewhere (null where they do not deliver there). */
      delivery: deliveryOptions(listing),
      /** Every unit is paid for and waiting to be handed over. */
      reserved: available === 0,
      /** Units still to be had (its stock less those held by paid orders). */
      available,
      /** How long the seller has to accept, then the buyer to pay. */
      accept_hours: settings.acceptHours,
      pay_hours: settings.payHours,
      covers,
    };
  }

  /** The buyer asks: the price and both sides' rates are fixed now; the seller has the accept time to answer. */
  async request(customer: CustomerWithStore, input: { listing_id: string; offer_id?: string; fulfilment: 'meet_up' | 'delivery'; delivery_address?: string; delivery_state_id?: string }) {
    const { country, mode, settings } = await this.open(customer);
    const { listing, price, offerId } = await this.priceFor(customer, country, input.listing_id, input.offer_id);
    await this.terms.require(customer.id);
    await this.guards.requireDifferentPeople(customer.id, listing.customerId);
    await this.guards.requireNotLimited(listing.customerId, country, false);
    const { address, fee: delivery, stateId } = await this.checkFulfilment(listing, input);
    if ((await this.held(listing.id)) >= listing.stock) throw this.reserved(listing.stock);
    if (settings.newSellerOrderLimitMinor !== null && price > settings.newSellerOrderLimitMinor) {
      const sales = await this.prisma.classifiedOrder.count({ where: { sellerId: listing.customerId, status: 'released' } });
      if (sales < newSellerSales) throw conflict('new_seller_limit', `This seller is new to Safe pay: their orders can be at most ${priceText(settings.newSellerOrderLimitMinor, listing.currency)} for now.`);
    }
    const now = new Date();
    let order;
    try {
      order = await this.prisma.classifiedOrder.create({
        data: {
          listingId: listing.id,
          buyerId: customer.id,
          sellerId: listing.customerId,
          offerId,
          mode,
          country,
          currency: listing.currency,
          priceMinor: price,
          buyerFeeBps: settings.buyerFeeBps,
          buyerFeeCapMinor: settings.buyerFeeCapMinor,
          buyerFeeMinor: safePayFee(price, settings.buyerFeeBps, settings.buyerFeeCapMinor),
          sellerFeeBps: settings.sellerFeeBps,
          sellerFeeCapMinor: settings.sellerFeeCapMinor,
          fulfilment: input.fulfilment,
          deliveryAddress: address ? this.encryption().encrypt(address) : null,
          deliveryFeeMinor: delivery,
          deliveryStateId: stateId,
          acceptBy: new Date(now.getTime() + settings.acceptHours * hourMs),
        },
        include: orderInclude,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('order_exists', 'You have already asked for this with Safe pay.');
      throw error;
    }
    await this.noteInChat(order, `${publicName(customer.name)} asked to buy with Safe pay for ${priceText(price, order.currency)}.`);
    await this.tell(order, 'seller', 'customer.classifieds.order_requested', `Safe pay request for "${order.listing.title}"`, `${publicName(customer.name)} wants to buy it for ${priceText(price, order.currency)}. Accept or decline within ${settings.acceptHours} hours.`);
    return this.present(order, 'buyer');
  }

  /**
   * How the buyer wants it: in person (where the seller hands over) or delivered (where they deliver, to a full address,
   * with its delivery charge for the state). Shared with resale orders.
   */
  async checkFulfilment(listing: { pickup: boolean; delivery: string; stateId: string | null; country: string; deliveryFeeStateMinor: bigint; deliveryFeeNationwideMinor: bigint }, input: { fulfilment: 'meet_up' | 'delivery'; delivery_address?: string; delivery_state_id?: string }) {
    if (input.fulfilment === 'meet_up') {
      if (!listing.pickup) throw invalid('parameter_invalid', 'This seller only delivers: choose delivery.', 'fulfilment');
      return { address: '', fee: 0n, stateId: null };
    }
    if (listing.delivery === 'none') throw invalid('parameter_invalid', 'This seller does not deliver: choose to meet in person.', 'fulfilment');
    const address = (input.delivery_address ?? '').trim();
    if (address.length < 10 || address.length > 500) throw invalid('parameter_invalid', 'Give the full delivery address (10 to 500 characters).', 'delivery_address');
    let stateId: string | null = null;
    if (input.delivery_state_id) {
      const state = await this.prisma.classifiedArea.findFirst({ where: { id: input.delivery_state_id, country: listing.country, kind: 'state' }, select: { id: true } });
      if (!state) throw invalid('parameter_invalid', 'Choose the state it goes to.', 'delivery_state_id');
      stateId = state.id;
    }
    const fee = deliveryFee(listing, stateId);
    if (fee === null) throw invalid('parameter_invalid', 'This seller delivers only within their own state.', 'delivery_state_id');
    return { address, fee, stateId };
  }

  /** The buyer pays the total from their wallet; the money goes into escrow as the order turns paid, once. */
  async pay(customer: CustomerWithStore, id: string) {
    const { settings } = await this.open(customer);
    const order = await this.mine(customer, id, 'buyer');
    const now = new Date();
    if (order.status !== 'awaiting_payment' || !order.payBy || order.payBy <= now) throw this.wrongStatus(order, 'paid');
    if (!isOnShop(order.listing)) throw conflict('listing_unavailable', 'This listing is no longer live.');
    await this.guards.requireDifferentPeople(customer.id, order.sellerId);
    const total = totalOf(order);
    const balance = await this.wallets.balance(customer.id, order.mode, order.currency);
    if (balance < total) throw this.walletLow(total - balance, order.currency);
    const entry = await this.ledger.prepare({
      mode: order.mode,
      type: 'classified_payment',
      reference: `classified_order:${order.id}:paid`,
      description: `Safe pay SP-${order.number}`,
      metadata: { order: Number(order.number) },
      lines: [
        { account: { kind: 'customer_wallet', currency: order.currency, customerId: customer.id }, debit: total },
        { account: { kind: 'classified_escrow', currency: order.currency }, credit: total },
      ],
    });
    const code = order.fulfilment === 'meet_up' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
    try {
      await this.prisma.$transaction(async tx => {
        // One payment at a time per listing (its row locked): each holds one unit, never more than its stock. The order is
        // claimed first, so paying it twice at once is `order_changed`, and only other buyers' paid orders use up stock.
        const [row] = await tx.$queryRaw<{ stock: number }[]>`SELECT "stock" FROM "classified_listings" WHERE "id" = ${order.listingId}::uuid FOR UPDATE`;
        const claimed = await tx.classifiedOrder.updateMany({
          where: { id: order.id, status: 'awaiting_payment', payBy: { gt: now } },
          data: { status: 'paid', paidAt: now, handoverBy: new Date(now.getTime() + settings.handoverDays * dayMs), releaseCode: code ? this.encryption().encrypt(code) : null },
        });
        if (!claimed.count) throw conflict('order_changed', 'This order changed: refresh and try again.');
        if (!row || (await heldUnits(tx, order.listingId, order.id)) + order.quantity > row.stock) throw conflict('listing_reserved', 'Someone else has just paid for this with Safe pay.');
        await this.ledger.write(tx, entry);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('listing_reserved', 'Someone else has just paid for this with Safe pay.');
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw this.walletLow(total, order.currency);
      throw error;
    }
    // Once every unit is paid for, anyone else's requests on it end.
    const { stock } = await this.prisma.classifiedListing.findUniqueOrThrow({ where: { id: order.listingId }, select: { stock: true } });
    const others = (await this.held(order.listingId)) < stock ? [] : await this.prisma.classifiedOrder.findMany({ where: { listingId: order.listingId, id: { not: order.id }, status: { in: ['requested', 'awaiting_payment'] } }, include: orderInclude });
    for (const other of others) {
      const ended = await this.prisma.classifiedOrder.updateMany({ where: { id: other.id, status: other.status }, data: { status: 'cancelled', closedAt: now, endedBy: 'bitocard', endReason: 'reserved_for_another_buyer' } });
      if (ended.count) await this.tell(other, 'buyer', 'customer.classifieds.order_cancelled', `"${other.listing.title}" is no longer available`, 'Another buyer paid for it with Safe pay first.');
    }
    const paid = await this.reload(order.id);
    await this.noteInChat(paid, 'Paid with Safe pay: BitoCard holds the money until the hand-over.');
    await this.tell(
      paid,
      'seller',
      'customer.classifieds.order_paid',
      `Safe pay order SP-${paid.number} is paid`,
      paid.fulfilment === 'meet_up' ? `Meet the buyer and hand "${paid.listing.title}" over; enter their release code to be paid.` : `Send "${paid.listing.title}" to the buyer and mark it sent.`,
    );
    return this.present(paid, 'buyer');
  }

  /** The buyer's release code (a meet-up, once paid): never shown to the seller, never sent in chat. */
  async releaseCode(customer: CustomerWithStore, id: string) {
    const order = await this.forParty(customer, id, 'buyer');
    if (order.fulfilment !== 'meet_up' || order.status !== 'paid' || !order.releaseCode) throw conflict('release_code_unavailable', 'A release code is shown once a meet-up order is paid, until it is released.');
    return { object: 'classified_release_code' as const, order_id: order.id, code: this.encryption().decrypt(order.releaseCode), tries_left: releaseCodeTries - order.releaseAttempts };
  }

  /** The buyer confirms a delivery arrived: the money is released. */
  async received(customer: CustomerWithStore, id: string) {
    const order = await this.forParty(customer, id, 'buyer');
    if (order.status !== 'sent') throw this.wrongStatus(order, 'confirmed');
    await this.settle(order, { kind: 'release' }, ['sent']);
    return this.present(await this.reload(order.id), 'buyer');
  }

  /** The buyer opens a dispute before release (not received, not as described, damaged): the release stops. */
  async dispute(customer: CustomerWithStore, id: string, input: { reason: DisputeReason; details: string }) {
    const order = await this.forParty(customer, id, 'buyer');
    if (!['paid', 'sent'].includes(order.status)) throw this.wrongStatus(order, 'disputed');
    const details = cleanMessage(input.details);
    if (details.length < 10) throw invalid('parameter_invalid', 'Say what went wrong (at least 10 characters).', 'details');
    const opened = await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedOrder.updateMany({ where: { id: order.id, status: { in: ['paid', 'sent'] } }, data: { status: 'disputed' } });
      if (!claimed.count) return false;
      const dispute = await tx.classifiedDispute.create({ data: { orderId: order.id, reason: input.reason } });
      await tx.classifiedDisputeMessage.create({ data: { disputeId: dispute.id, author: 'buyer', authorId: customer.id, body: details } });
      if (order.kind === 'resale') await this.resaleEvents?.changed(tx, order.id);
      return true;
    });
    if (!opened) throw conflict('order_changed', 'This order changed: refresh and try again.');
    if (order.kind === 'resale') this.resaleEvents?.committed();
    const disputed = await this.reload(order.id);
    await this.tellReseller(disputed, `SP-${disputed.number} is disputed`, `The buyer says there is a problem with "${disputed.listing.title}". The money stays held until BitoCard decides.`);
    await this.tell(disputed, 'seller', 'customer.classifieds.order_disputed', `SP-${disputed.number} is disputed`, `The buyer says there is a problem with "${disputed.listing.title}". The money stays held until BitoCard decides; add your side in the dispute.`);
    await this.inbox.admins('admin.classifieds.dispute_opened', { subject: disputed.dispute!.id, title: `Safe pay dispute on SP-${disputed.number}`, body: `${input.reason.replace(/_/g, ' ')}: ${details.slice(0, 120)}`, link: `/classifieds/disputes/${disputed.dispute!.id}` });
    return this.present(disputed, 'buyer');
  }

  // ---- The seller ----

  /** The seller accepts within the accept time (live: once their identity check and payout account are done). */
  async accept(customer: CustomerWithStore, id: string) {
    const { mode, house, settings } = await this.open(customer);
    const order = await this.mine(customer, id, 'seller');
    const now = new Date();
    if (order.kind === 'resale') {
      const paid = await this.acceptResale(order, house.id, settings);
      return this.present(paid, 'seller', await this.buyerDetails(paid, { viewer: 'supplier', viewerId: customer.id }));
    }
    if (order.status !== 'requested' || order.acceptBy <= now) throw this.wrongStatus(order, 'accepted');
    await this.terms.require(customer.id);
    await this.guards.requireNotLimited(customer.id, order.country, true);
    await this.guards.requireDifferentPeople(order.buyerId, customer.id);
    const ready = await this.readinessOf(customer.id, mode, house.id, order.country);
    if (!ready.identity_checked) throw conflict('seller_not_ready', 'Finish your identity check before accepting Safe pay orders.', 'identity');
    if (!ready.payout_account) throw conflict('seller_not_ready', 'Add a payout bank account in your verified name before accepting Safe pay orders.', 'payout_account');
    const claimed = await this.prisma.classifiedOrder.updateMany({ where: { id: order.id, status: 'requested', acceptBy: { gt: now } }, data: { status: 'awaiting_payment', acceptedAt: now, payBy: new Date(now.getTime() + settings.payHours * hourMs) } });
    if (!claimed.count) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const accepted = await this.reload(order.id);
    await this.noteInChat(accepted, 'The seller accepted the Safe pay request.');
    await this.tell(accepted, 'buyer', 'customer.classifieds.order_accepted', `Pay for "${accepted.listing.title}"`, `The seller accepted. Pay ${priceText(accepted.priceMinor + accepted.buyerFeeMinor, accepted.currency)} from your wallet within ${settings.payHours} hours.`);
    return this.present(accepted, 'seller');
  }

  async decline(customer: CustomerWithStore, id: string, reason?: string) {
    await this.listings.sellerCountry(customer);
    const order = await this.mine(customer, id, 'seller');
    if (order.kind === 'resale') {
      if (order.status !== 'locked') throw this.wrongStatus(order, 'declined');
      await this.unlock(order, { status: 'declined', endedBy: 'seller', reason: reason ? cleanMessage(reason).slice(0, 300) : null });
      return this.present(await this.reload(order.id), 'seller');
    }
    if (order.status !== 'requested') throw this.wrongStatus(order, 'declined');
    const claimed = await this.prisma.classifiedOrder.updateMany({ where: { id: order.id, status: 'requested' }, data: { status: 'declined', closedAt: new Date(), endedBy: 'seller', endReason: reason?.trim().slice(0, 300) || null } });
    if (!claimed.count) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const declined = await this.reload(order.id);
    await this.tell(declined, 'buyer', 'customer.classifieds.order_declined', `Safe pay request for "${declined.listing.title}" declined`, reason ? `The seller said: ${cleanMessage(reason).slice(0, 200)}` : 'The seller declined. You can still chat with them.');
    return this.present(declined, 'seller');
  }

  /** The seller enters the buyer's release code at the meet-up (5 tries): the money is released at once. */
  async release(customer: CustomerWithStore, id: string, code: string) {
    await this.listings.sellerCountry(customer);
    const order = await this.mine(customer, id, 'seller');
    if (order.fulfilment !== 'meet_up' || order.status !== 'paid' || !order.releaseCode) throw this.wrongStatus(order, 'released');
    const tried = await this.prisma.classifiedOrder.updateMany({ where: { id: order.id, status: 'paid', releaseAttempts: { lt: releaseCodeTries } }, data: { releaseAttempts: { increment: 1 } } });
    if (!tried.count) throw conflict('release_locked', 'The code was entered wrongly too many times. Ask the buyer to confirm it in their app, or contact BitoCard.');
    const expected = Buffer.from(this.encryption().decrypt(order.releaseCode));
    const given = Buffer.from(code.trim());
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const left = releaseCodeTries - order.releaseAttempts - 1;
      throw invalid('release_code_wrong', left > 0 ? `That is not the code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That is not the code, and no tries are left.', 'code');
    }
    await this.settle(order, { kind: 'release' }, ['paid']);
    return this.present(await this.reload(order.id), 'seller');
  }

  /**
   * The seller ships a delivery with a courier and its tracking number (after adding at least two dispatch photos of
   * the item and the sealed parcel). The buyer confirms once it arrives or disputes it; without a delivery reported,
   * the confirm time starts once the country's longest transit time has passed.
   */
  async markSent(customer: CustomerWithStore, id: string, input: { courier: string; tracking_number: string; tracking_url?: string; note?: string }) {
    const { settings, country } = await this.open(customer);
    const order = await this.mine(customer, id, 'seller');
    if (order.fulfilment !== 'delivery' || order.status !== 'paid') throw this.wrongStatus(order, 'sent');
    if (order.dispatchPhotos.length < minDispatchPhotos) throw conflict('dispatch_photos_required', `Add at least ${minDispatchPhotos} photos first: the item, and the parcel sealed for shipping.`, 'photos');
    const shipment = await this.checkShipment(country, input);
    const now = new Date();
    const transit = await this.transitDays(order.country);
    const claimed = await this.claim(
      order,
      { status: 'paid' },
      { status: 'sent', sentAt: now, confirmBy: new Date(now.getTime() + (transit + settings.confirmDays) * dayMs), trackingNote: input.note ? cleanMessage(input.note).slice(0, 300) : null, ...shipment },
      async tx => {
        await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'shipped', reportedBy: 'seller', note: `${shipment.courier} ${shipment.trackingNumber}` } });
      },
    );
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const sent = await this.reload(order.id);
    const body = `${shipment.courier}, tracking ${shipment.trackingNumber}. Confirm when it arrives in good condition, or open a dispute if there is a problem.`;
    await this.tell(sent, 'buyer', 'customer.classifieds.order_sent', `"${sent.listing.title}" is on its way`, body);
    await this.tellReseller(sent, `SP-${sent.number} was shipped`, `${shipment.courier}, tracking ${shipment.trackingNumber}.`);
    return this.present(sent, 'seller');
  }

  /** A courier from the country's list (its tracking link made from the number) or another named one, and the number. */
  private async checkShipment(country: string, input: { courier: string; tracking_number: string; tracking_url?: string }) {
    const courier = (input.courier ?? '').trim().replace(/\s+/g, ' ');
    if (courier.length < 2 || courier.length > 60) throw invalid('parameter_invalid', 'Name the courier (2 to 60 characters).', 'courier');
    const trackingNumber = (input.tracking_number ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,59}$/.test(trackingNumber)) throw invalid('parameter_invalid', 'Give the tracking number (3 to 60 letters, digits, spaces or dashes).', 'tracking_number');
    const listed = (await this.couriers(country)).find(item => item.name.toLowerCase() === courier.toLowerCase());
    let trackingUrl: string | null = null;
    if (input.tracking_url) {
      try {
        const url = new URL(input.tracking_url.trim());
        if (url.protocol !== 'https:' || input.tracking_url.length > 500) throw new Error();
        if (listed?.tracking_url && new URL(listed.tracking_url.replace('{tracking}', 'x')).hostname !== url.hostname) throw new Error();
        trackingUrl = url.toString();
      } catch {
        throw invalid('parameter_invalid', listed?.tracking_url ? `Use the tracking link on ${listed.name}'s own site.` : 'The tracking link must be an https address.', 'tracking_url');
      }
    } else if (listed?.tracking_url) {
      trackingUrl = listed.tracking_url.replace('{tracking}', encodeURIComponent(trackingNumber));
    }
    return { courier: listed?.name ?? courier, trackingNumber, trackingUrl };
  }

  /** The couriers BitoCard offers in a country: each with its tracking link, `{tracking}` standing for the number. */
  async couriers(country: string): Promise<{ name: string; tracking_url: string | null }[]> {
    const row = await this.prisma.classifiedSafePaySettings.findUnique({ where: { country }, select: { couriers: true } });
    return Array.isArray(row?.couriers) ? (row.couriers as { name: string; tracking_url: string | null }[]) : [];
  }

  /** `GET /v1/classifieds/safe-pay/couriers`: the couriers offered in the customer's country. */
  async courierList(customer: CustomerWithStore) {
    const country = await this.listings.sellerCountry(customer);
    return { object: 'list' as const, data: await this.couriers(country) };
  }

  private async transitDays(country: string) {
    return (await this.prisma.classifiedSafePaySettings.findUnique({ where: { country }, select: { transitDays: true } }))?.transitDays ?? 7;
  }

  /** The seller reports where a shipped parcel is; once delivered, the buyer's confirm time starts. */
  async shipmentUpdate(customer: CustomerWithStore, id: string, input: { status: ShipmentUpdate; note?: string }) {
    const { settings } = await this.open(customer);
    const order = await this.mine(customer, id, 'seller');
    if (order.status !== 'sent' || order.fulfilment !== 'delivery') throw this.wrongStatus(order, 'updated');
    if (order.deliveredAt && input.status !== 'returned') throw conflict('already_delivered', 'It is marked delivered: the buyer confirms it or opens a dispute.');
    const now = new Date();
    const delivered = input.status === 'delivered';
    const note = input.note ? cleanMessage(input.note).slice(0, 300) : null;
    const claimed = await this.claim(order, { status: 'sent' }, delivered ? { deliveredAt: now, confirmBy: new Date(now.getTime() + settings.confirmDays * dayMs) } : {}, async tx => {
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: input.status, reportedBy: 'seller', note } });
    });
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const updated = await this.reload(order.id);
    const words = { in_transit: 'is in transit', out_for_delivery: 'is out for delivery', delivered: 'was delivered', failed_attempt: 'could not be delivered this time', returned: 'is being returned to the seller' }[input.status];
    await this.tell(updated, 'buyer', 'customer.classifieds.shipment', `Your parcel ${words}`, delivered ? `Check "${updated.listing.title}" and confirm it arrived in good condition, or open a dispute within ${settings.confirmDays} days.` : `"${updated.listing.title}"${note ? `: ${note}` : '.'}`);
    await this.tellReseller(updated, `SP-${updated.number}: the parcel ${words}`, note ?? `"${updated.listing.title}"`);
    return this.present(updated, 'seller');
  }

  /** The seller adds a dispatch photo before shipping (the item, the sealed parcel): at most 8, private to the order. */
  async addDispatchPhoto(customer: CustomerWithStore, id: string, file: MediaUpload) {
    await this.listings.sellerCountry(customer);
    const order = await this.mine(customer, id, 'seller');
    if (order.fulfilment !== 'delivery' || order.status !== 'paid') throw conflict('order_changed', 'Dispatch photos are added to a paid delivery before it is shipped.');
    if (!this.storage.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Photos cannot be added yet.');
    if (file.size > maxDocumentBytes) throw invalid('file_too_large', 'Photos can be at most 4 MB.', 'file');
    const checked = checkDocument(file.buffer, file.mimetype, false);
    if ('problem' in checked) throw invalid('file_invalid', checked.problem, 'file');
    if (checked.contentType === 'application/pdf') throw invalid('file_invalid', 'Send a photo (JPEG or PNG).', 'file');
    if ((await this.prisma.classifiedDispatchPhoto.count({ where: { orderId: order.id } })) >= maxDispatchPhotos) throw conflict('too_many_files', `An order can hold ${maxDispatchPhotos} dispatch photos.`);
    const objectKey = this.storage.shopChatKey(`dispatch-${order.id}`, randomUUID());
    await this.storage.put(objectKey, checked.bytes);
    await this.prisma.classifiedDispatchPhoto.create({ data: { orderId: order.id, objectKey, contentType: checked.contentType, size: checked.bytes.length, width: checked.width, height: checked.height } });
    return this.present(await this.reload(order.id), 'seller');
  }

  /** A dispatch photo, for the order's buyer, seller or reseller, or BitoCard (audited). */
  async dispatchPhoto(order: { id: string }, photoId: string) {
    const photo = await this.prisma.classifiedDispatchPhoto.findFirst({ where: { id: photoId, orderId: order.id } });
    if (!photo) throw notFound('photo');
    const bytes = await this.storage.get(photo.objectKey);
    if (!bytes) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'file_gone', 'This photo is no longer kept.');
    return { contentType: photo.contentType, bytes, name: `dispatch.${photo.contentType === 'image/png' ? 'png' : 'jpg'}` };
  }

  async partyDispatchPhoto(customer: CustomerWithStore, id: string, photoId: string) {
    const order = await this.forParty(customer, id);
    return this.dispatchPhoto(order, photoId);
  }

  async adminDispatchPhoto(actorId: string | null, id: string, photoId: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw notFound();
    await this.audit.record({ actorId, action: 'classifieds.dispatch_photo_viewed', targetType: 'classified_order', targetId: id, before: null, after: { photo_id: photoId } });
    return this.dispatchPhoto(order, photoId);
  }

  // ---- Resale orders ----

  /**
   * The supplier accepts a resale order (or it is accepted by itself, with auto-accept): the buyer's locked money goes
   * into escrow in the same transaction that marks it paid, the hand-over time starts and a meet-up's release code is
   * made. Needs what accepting any Safe pay order needs (terms, strikes, identity check and payout account).
   */
  async acceptResale(order: OrderRow, houseId: string, settings: Settings, auto = false) {
    const now = new Date();
    if (order.status !== 'locked' || order.acceptBy <= now) throw this.wrongStatus(order, 'accepted');
    await this.terms.require(order.sellerId);
    await this.guards.requireNotLimited(order.sellerId, order.country, true);
    await this.guards.requireDifferentPeople(order.buyerId, order.sellerId);
    const ready = await this.readinessOf(order.sellerId, order.mode, houseId, order.country);
    if (!ready.identity_checked) throw conflict('seller_not_ready', 'Finish your identity check before accepting Safe pay orders.', 'identity');
    if (!ready.payout_account) throw conflict('seller_not_ready', 'Add a payout bank account in your verified name before accepting Safe pay orders.', 'payout_account');
    const total = totalOf(order);
    const entry = await this.ledger.prepare({
      mode: order.mode,
      type: 'classified_payment',
      reference: `classified_order:${order.id}:paid`,
      description: `Safe pay SP-${order.number}`,
      metadata: { order: Number(order.number) },
      resellerId: order.resellerId,
      lines: [
        { account: { kind: 'customer_wallet_locked', currency: order.currency, customerId: order.buyerId }, debit: total },
        { account: { kind: 'classified_escrow', currency: order.currency }, credit: total },
      ],
    });
    const code = order.fulfilment === 'meet_up' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
    const claimed = await this.claim(
      order,
      { status: 'locked', acceptBy: { gt: now } },
      { status: 'paid', acceptedAt: now, paidAt: now, handoverBy: new Date(now.getTime() + settings.handoverDays * dayMs), releaseCode: code ? this.encryption().encrypt(code) : null },
      tx => this.ledger.write(tx, entry).then(() => undefined),
    );
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const paid = await this.reload(order.id);
    await this.noteInChat(paid, `${auto ? 'Accepted' : 'The supplier accepted'}: BitoCard holds the money until the hand-over.`);
    await this.tell(paid, 'buyer', 'customer.purchase.updated', `Your order for "${paid.listing.title}" is confirmed`, paid.fulfilment === 'meet_up' ? 'Your payment is held by BitoCard. Arrange the hand-over in the order chat; give your release code only once you have checked the item.' : 'Your payment is held by BitoCard until it arrives. You will be told when it is shipped.');
    if (auto) await this.tell(paid, 'seller', 'customer.classifieds.order_paid', `Resale order SP-${paid.number} was accepted for you`, paid.fulfilment === 'meet_up' ? `Hand "${paid.listing.title}" over to the buyer; enter their release code to be paid.` : `Ship "${paid.listing.title}" to the buyer with tracking, after adding dispatch photos.`);
    await this.tellReseller(paid, `SP-${paid.number} was accepted`, `The supplier ${auto ? 'accepts orders automatically' : 'accepted it'}: the buyer's money is held until the hand-over.`);
    return paid;
  }

  /** Ends a locked resale order (declined, cancelled or not accepted in time): the buyer's money is unlocked, once. */
  async unlock(order: OrderRow, end: { status: 'declined' | 'cancelled' | 'lapsed'; endedBy: string; reason: string | null }) {
    const total = totalOf(order);
    const entry = await this.ledger.prepare({
      mode: order.mode,
      type: 'classified_unlock',
      reference: `classified_order:${order.id}:unlocked`,
      description: `Safe pay SP-${order.number} ${end.status}`,
      metadata: { order: Number(order.number) },
      resellerId: order.resellerId,
      lines: [
        { account: { kind: 'customer_wallet_locked', currency: order.currency, customerId: order.buyerId }, debit: total },
        { account: { kind: 'customer_wallet', currency: order.currency, customerId: order.buyerId }, credit: total },
      ],
    });
    const claimed = await this.claim(order, { status: 'locked' }, { status: end.status, closedAt: new Date(), endedBy: end.endedBy, endReason: end.reason }, tx => this.ledger.write(tx, entry).then(() => undefined));
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const ended = await this.reload(order.id);
    const why = end.status === 'lapsed' ? 'The store did not confirm this order in time' : end.endedBy === 'reseller' ? 'The store cancelled this order' : 'The store could not take this order';
    if (end.endedBy !== 'buyer') await this.tell(ended, 'buyer', 'customer.purchase.updated', `Your order for "${ended.listing.title}" was cancelled`, `${why}. ${priceText(total, ended.currency)} is back in your wallet.`);
    if (end.endedBy === 'buyer' || end.endedBy === 'reseller') await this.tell(ended, 'seller', 'customer.classifieds.order_cancelled', `SP-${ended.number} was cancelled`, `The ${end.endedBy === 'buyer' ? 'buyer' : 'store'} cancelled the order for "${ended.listing.title}" before you accepted it.`);
    await this.tellReseller(ended, `SP-${ended.number} ${end.status === 'lapsed' ? 'was not accepted in time' : `was ${end.status}`}`, `The buyer's ${priceText(total, ended.currency)} is back in their wallet.`);
    return ended;
  }

  /** Accepts a new resale order by itself when its supplier chose to (and could accept it now); null otherwise. */
  async autoAccept(orderId: string) {
    const order = await this.reload(orderId);
    if (order.kind !== 'resale' || order.status !== 'locked') return null;
    const choice = await this.prisma.classifiedSeller.findUnique({ where: { customerId: order.sellerId }, select: { resaleAutoAccept: true } });
    if (!choice?.resaleAutoAccept) return null;
    const supplier = await this.prisma.customer.findUniqueOrThrow({ where: { id: order.sellerId }, include: { store: { include: { reseller: { select: { house: true } } } } } });
    try {
      const { house, settings } = await this.open(supplier);
      return await this.acceptResale(order, house.id, settings, true);
    } catch (error) {
      // Not ready (identity, payout account, strikes, terms): it waits for the supplier like any order.
      if (error instanceof ApiError) return null;
      throw error;
    }
  }

  /**
   * The reseller's store cancels a resale order before it is shipped or handed over: the buyer's money is unlocked, or
   * refunded in full once paid. It counts towards the reseller's strikes.
   */
  async cancelForStore(orderId: string, resellerId: string, reason: string | null) {
    const order = await this.reload(orderId);
    if (order.kind !== 'resale' || order.resellerId !== resellerId) throw notFound();
    const why = reason ? cleanMessage(reason).slice(0, 300) : null;
    if (order.status === 'locked') {
      await this.unlock(order, { status: 'cancelled', endedBy: 'reseller', reason: why });
    } else if (order.status === 'paid') {
      await this.settle(order, { kind: 'refund', endedBy: 'reseller', reason: why }, ['paid']);
      const ended = await this.reload(order.id);
      await this.noteInChat(ended, 'The store cancelled the order: the buyer is refunded in full.');
      await this.tell(ended, 'seller', 'customer.classifieds.order_cancelled', `SP-${ended.number} was cancelled`, `The store cancelled the order for "${ended.listing.title}" and the buyer was refunded. Do not hand it over or ship it.`);
    } else {
      throw this.wrongStatus(order, 'cancelled');
    }
    return this.reload(order.id);
  }

  async reloadOrder(id: string) {
    return this.reload(id);
  }

  // ---- Either side ----

  /** Either side cancels before the hand-over: before payment nothing moves; once paid the buyer is refunded in full. */
  async cancel(customer: CustomerWithStore, id: string, reason?: string) {
    const order = await this.forParty(customer, id);
    const side = this.sideOf(order, customer.id)!;
    const why = reason ? cleanMessage(reason).slice(0, 300) : null;
    if (order.status === 'locked') {
      // Before the supplier accepts: the buyer's money is unlocked (a supplier's cancel is a decline).
      await this.unlock(order, { status: side === 'buyer' ? 'cancelled' : 'declined', endedBy: side, reason: why });
      return this.present(await this.reload(order.id), side);
    }
    if (['requested', 'awaiting_payment'].includes(order.status)) {
      const claimed = await this.claim(order, { status: order.status }, { status: 'cancelled', closedAt: new Date(), endedBy: side, endReason: why });
      if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    } else if (order.status === 'paid') {
      await this.settle(order, { kind: 'refund', endedBy: side, reason: why }, ['paid']);
    } else if (order.status === 'sent' && side === 'buyer') {
      throw conflict('order_handed_over', 'It has been sent: confirm it arrived, or open a dispute if there is a problem.');
    } else {
      throw this.wrongStatus(order, 'cancelled');
    }
    const ended = await this.reload(order.id);
    if (side === 'seller' && ended.acceptedAt) await this.guards.afterStrike(ended.seller, ended.country);
    const money = ended.status === 'refunded' ? ' The buyer is refunded in full.' : '';
    const who = ended.kind === 'resale' && side === 'seller' ? 'store' : side;
    await this.noteInChat(ended, `The order was cancelled by the ${side === 'seller' && ended.kind === 'resale' ? 'supplier' : side}.${money}`);
    await this.tell(ended, side === 'buyer' ? 'seller' : 'buyer', 'customer.classifieds.order_cancelled', `SP-${ended.number} was cancelled`, `The ${who} cancelled the order for "${ended.listing.title}".${side === 'seller' ? money.replace('The buyer is', 'You are') : ''}`);
    await this.tellReseller(ended, `SP-${ended.number} was cancelled`, `The ${side === 'seller' ? 'supplier' : 'buyer'} cancelled it.${money}`);
    return this.present(ended, side);
  }

  async list(customer: CustomerWithStore, filter: { role?: 'buying' | 'selling'; kind?: 'direct' | 'resale'; limit?: number; offset?: number }) {
    await this.listings.sellerCountry(customer);
    const mine: Prisma.ClassifiedOrderWhereInput = filter.role === 'buying' ? { buyerId: customer.id } : filter.role === 'selling' ? { sellerId: customer.id } : { OR: [{ buyerId: customer.id }, { sellerId: customer.id }] };
    const where: Prisma.ClassifiedOrderWhereInput = { ...mine, ...(filter.kind ? { kind: filter.kind } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: filter.limit ?? 30, skip: filter.offset ?? 0 }),
      this.prisma.classifiedOrder.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.present(row, this.sideOf(row, customer.id)!)), total };
  }

  async get(customer: CustomerWithStore, id: string) {
    const order = await this.forParty(customer, id);
    const side = this.sideOf(order, customer.id)!;
    const details = side === 'seller' && order.kind === 'resale' ? await this.buyerDetails(order, { viewer: 'supplier', viewerId: customer.id }) : null;
    return this.present(order, side, details);
  }

  // ---- A resale buyer's details ----

  /** Whether a resale order's buyer details are open: from acceptance, while it is open and for 30 days after it ends. */
  detailsOpen(order: { kind: string; acceptedAt: Date | null; releasedAt: Date | null; refundedAt: Date | null; closedAt: Date | null }) {
    if (order.kind !== 'resale' || !order.acceptedAt) return false;
    const ended = order.releasedAt ?? order.refundedAt ?? order.closedAt;
    return !ended || Date.now() - ended.getTime() <= buyerDetailsDays * dayMs;
  }

  /** The buyer's name, confirmed phone, email and delivery address for the supplier, the reseller or BitoCard; each view is logged. */
  async buyerDetails(order: OrderRow, view: { viewer: 'supplier' | 'reseller' | 'admin'; viewerId: string | null }) {
    if (!this.detailsOpen(order)) return null;
    await this.prisma.resaleBuyerDetailView.create({ data: { orderId: order.id, viewer: view.viewer, viewerId: view.viewerId } });
    const open = (sealed: string | null) => (sealed ? this.encryption().decrypt(sealed) : null);
    return { name: order.buyer.name, email: order.buyer.email, phone: open(order.buyerPhone), address: open(order.deliveryAddress) };
  }

  // ---- Disputes ----

  async disputeThread(customer: CustomerWithStore, id: string) {
    const order = await this.forParty(customer, id);
    if (!order.dispute) throw notFound('dispute');
    const side = this.sideOf(order, customer.id)!;
    const messages = await this.prisma.classifiedDisputeMessage.findMany({ where: { disputeId: order.dispute.id }, orderBy: { createdAt: 'asc' } });
    return { ...this.presentDispute(order.dispute), order_id: order.id, messages: messages.map(message => this.presentDisputeMessage(message, order, side)) };
  }

  /** Either side adds to the dispute while it is open (text, or a photo with a caption). */
  async disputeMessage(customer: CustomerWithStore, id: string, body: string, file?: MediaUpload) {
    const order = await this.forParty(customer, id);
    if (!order.dispute || order.dispute.status !== 'open') throw conflict('dispute_closed', 'This dispute is not open.');
    const side = this.sideOf(order, customer.id)!;
    const text = cleanMessage(body ?? '');
    if (!text && !file) throw invalid('parameter_missing', 'Write a message.', 'body');
    const photo = file ? await this.storeDisputePhoto(order.dispute.id, file) : {};
    const message = await this.prisma.classifiedDisputeMessage.create({ data: { disputeId: order.dispute.id, author: side, authorId: customer.id, body: text, ...photo } });
    await this.tell(order, side === 'buyer' ? 'seller' : 'buyer', 'customer.classifieds.dispute_message', `New message on the dispute for SP-${order.number}`, text.slice(0, 140) || 'A photo');
    await this.tellReseller(order, `New message on the dispute for SP-${order.number}`, `From the ${side === 'buyer' ? 'buyer' : 'supplier'}: ${text.slice(0, 140) || 'a photo'}`);
    await this.inbox.admins('admin.classifieds.dispute_message', { subject: message.id, title: `New message on the dispute for SP-${order.number}`, body: `From the ${side}.`, link: `/classifieds/disputes/${order.dispute.id}` });
    return this.presentDisputeMessage(message, order, side);
  }

  async disputePhoto(customer: CustomerWithStore, id: string, messageId: string) {
    const order = await this.forParty(customer, id);
    if (!order.dispute) throw notFound('dispute');
    return this.readDisputePhoto(order.dispute.id, messageId);
  }

  private async storeDisputePhoto(disputeId: string, file: MediaUpload) {
    if (!this.storage.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Photos cannot be added yet. Describe it in words instead.');
    if (file.size > maxDocumentBytes) throw invalid('file_too_large', 'Photos can be at most 4 MB.', 'file');
    const checked = checkDocument(file.buffer, file.mimetype, false);
    if ('problem' in checked) throw invalid('file_invalid', checked.problem, 'file');
    if ((await this.prisma.classifiedDisputeMessage.count({ where: { disputeId, objectKey: { not: null } } })) >= maxDisputePhotos) throw conflict('too_many_files', `A dispute can hold ${maxDisputePhotos} photos.`);
    const objectKey = `${this.storage.shopChatKey(`dispute-${disputeId}`, randomUUID())}`;
    await this.storage.put(objectKey, checked.bytes);
    return { objectKey, contentType: checked.contentType, size: checked.bytes.length, width: checked.width, height: checked.height };
  }

  private async readDisputePhoto(disputeId: string, messageId: string) {
    const message = await this.prisma.classifiedDisputeMessage.findFirst({ where: { id: messageId, disputeId } });
    if (!message?.objectKey) throw notFound('photo');
    const bytes = await this.storage.get(message.objectKey);
    if (!bytes) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'file_gone', 'This photo is no longer kept.');
    return { contentType: message.contentType ?? 'image/jpeg', bytes, name: `photo.${message.contentType === 'image/png' ? 'png' : 'jpg'}` };
  }

  // ---- BitoCard ----

  async adminList(filter: { status?: string; country?: string; q?: string; payout_review?: string; kind?: string; limit?: number; offset?: number }) {
    const number = filter.q ? /^(?:SP-)?(\d{6,})$/i.exec(filter.q.trim())?.[1] : undefined;
    const where: Prisma.ClassifiedOrderWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.country ? { country: filter.country } : {}),
      ...(filter.payout_review ? { payoutReview: filter.payout_review } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.q ? (number ? { number: BigInt(number) } : { OR: [{ buyer: { email: { contains: filter.q, mode: 'insensitive' } } }, { seller: { email: { contains: filter.q, mode: 'insensitive' } } }] }) : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedOrder.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, take: filter.limit ?? 50, skip: filter.offset ?? 0 }),
      this.prisma.classifiedOrder.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.present(row, 'admin')), total };
  }

  async adminGet(id: string, actorId: string | null = null) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw notFound();
    const messages = order.dispute ? await this.prisma.classifiedDisputeMessage.findMany({ where: { disputeId: order.dispute.id }, orderBy: { createdAt: 'asc' } }) : [];
    const details = order.kind === 'resale' ? await this.buyerDetails(order, { viewer: 'admin', viewerId: actorId }) : null;
    return { ...this.present(order, 'admin', details), dispute: order.dispute ? { ...this.presentDispute(order.dispute), messages: messages.map(message => this.presentDisputeMessage(message, order, 'admin')) } : null };
  }

  async adminDisputes(filter: { status?: string; limit?: number; offset?: number }) {
    const rows = await this.prisma.classifiedDispute.findMany({ where: { status: filter.status ?? 'open' }, include: { order: { include: orderInclude } }, orderBy: { createdAt: 'asc' }, take: filter.limit ?? 50, skip: filter.offset ?? 0 });
    return { object: 'list' as const, data: rows.map(row => ({ ...this.presentDispute(row), order: this.present(row.order, 'admin') })) };
  }

  async adminDisputePhoto(actorId: string | null, orderId: string, messageId: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, include: { dispute: true } });
    if (!order?.dispute) throw notFound('dispute');
    await this.audit.record({ actorId, action: 'classifieds.dispute_photo_viewed', targetType: 'classified_order', targetId: order.id, before: null, after: { message_id: messageId } });
    return this.readDisputePhoto(order.dispute.id, messageId);
  }

  /** BitoCard writes on a dispute (both sides see it). */
  async adminDisputeMessage(actorId: string | null, orderId: string, body: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order?.dispute || order.dispute.status !== 'open') throw conflict('dispute_closed', 'This dispute is not open.');
    const text = body.trim().slice(0, 2000);
    if (!text) throw invalid('parameter_missing', 'Write a message.', 'body');
    const message = await this.prisma.classifiedDisputeMessage.create({ data: { disputeId: order.dispute.id, author: 'bitocard', authorId: actorId, body: text } });
    for (const side of ['buyer', 'seller'] as const) await this.tell(order, side, 'customer.classifieds.dispute_message', `BitoCard wrote on the dispute for SP-${order.number}`, text.slice(0, 140));
    await this.tellReseller(order, `BitoCard wrote on the dispute for SP-${order.number}`, text.slice(0, 140));
    return this.presentDisputeMessage(message, order, 'admin');
  }

  // ---- A resale order's dispute, for its reseller ----

  /** The dispute of one of the reseller's resale orders: every message, as the reseller reads it. */
  async resellerDisputeThread(resellerId: string, id: string, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    if (!order.dispute) throw notFound('dispute');
    const messages = await this.prisma.classifiedDisputeMessage.findMany({ where: { disputeId: order.dispute.id }, orderBy: { createdAt: 'asc' } });
    return { ...this.presentDispute(order.dispute), order_id: order.id, messages: messages.map(message => this.presentDisputeMessage(message, order, 'reseller')) };
  }

  /** The reseller adds their side to an open dispute (what their store told the buyer, evidence they hold). */
  async resellerDisputeMessage(resellerId: string, userId: string | null, id: string, body: string, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    if (!order.dispute || order.dispute.status !== 'open') throw conflict('dispute_closed', 'This dispute is not open.');
    const text = cleanMessage(body ?? '');
    if (!text) throw invalid('parameter_missing', 'Write a message.', 'body');
    const message = await this.prisma.classifiedDisputeMessage.create({ data: { disputeId: order.dispute.id, author: 'reseller', authorId: userId, body: text } });
    for (const side of ['buyer', 'seller'] as const) await this.tell(order, side, 'customer.classifieds.dispute_message', `New message on the dispute for SP-${order.number}`, text.slice(0, 140));
    await this.inbox.admins('admin.classifieds.dispute_message', { subject: message.id, title: `New message on the dispute for SP-${order.number}`, body: 'From the reseller.', link: `/classifieds/disputes/${order.dispute.id}` });
    return this.presentDisputeMessage(message, order, 'reseller');
  }

  async resellerDisputePhoto(resellerId: string, id: string, messageId: string, scope?: string) {
    const order = await this.resellerOrder(resellerId, id, scope);
    if (!order.dispute) throw notFound('dispute');
    return this.readDisputePhoto(order.dispute.id, messageId);
  }

  private async resellerOrder(resellerId: string, id: string, scope?: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || order.kind !== 'resale' || order.resellerId !== resellerId || (scope && order.storeId !== scope)) throw notFound();
    return order;
  }

  /**
   * BitoCard decides an open dispute: `refund` (the price and the buyer's fee back), `partial` (part of the price back,
   * the rest to the seller less their fee on it, the buyer's fee kept) or `release` (to the seller, both fees kept).
   * Refunds need finance. `fault` says whose strike an upheld dispute is: the supplier's (the default), the reseller's
   * (on a resale order: the store's note or claims misled the buyer) or nobody's; a release is nobody's.
   */
  async decide(actorId: string | null, roles: string[], orderId: string, input: { decision: DisputeDecision; refund?: number; note: string; fault?: DisputeFault }) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order?.dispute) throw notFound('dispute');
    if (order.dispute.status !== 'open' || order.status !== 'disputed') throw conflict('dispute_closed', 'This dispute was already decided.');
    if (input.decision !== 'release' && !roles.some(role => role === 'finance' || role === 'super_admin')) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'finance_required', 'Refunds are decided by finance.');
    }
    if (input.fault === 'reseller' && order.kind !== 'resale') throw invalid('parameter_invalid', 'Only a resale order has a reseller to blame.', 'fault');
    const fault: DisputeFault = input.decision === 'release' ? 'none' : (input.fault ?? 'supplier');
    let decision: { kind: 'release' } | { kind: 'refund'; endedBy: string; reason: string } | { kind: 'partial'; refund: bigint };
    if (input.decision === 'partial') {
      const refund = BigInt(input.refund ?? 0);
      // A part refund is of the item's price; the delivery charge stays with the seller (it was delivered).
      if (refund <= 0n || refund >= order.priceMinor) throw invalid('parameter_invalid', `A part refund is more than nothing and less than the price (${priceText(order.priceMinor, order.currency)}).`, 'refund');
      decision = { kind: 'partial', refund };
    } else {
      decision = input.decision === 'refund' ? { kind: 'refund', endedBy: 'bitocard', reason: 'dispute' } : { kind: 'release' };
    }
    await this.settle(order, decision, ['disputed'], async tx => {
      const claimed = await tx.classifiedDispute.updateMany({ where: { id: order.dispute!.id, status: 'open' }, data: { status: 'decided', decision: input.decision, fault, refundMinor: decision.kind === 'partial' ? decision.refund : null, note: input.note, decidedById: actorId, decidedAt: new Date() } });
      if (!claimed.count) throw conflict('dispute_closed', 'This dispute was already decided.');
    });
    await this.audit.record({ actorId, action: 'classifieds.dispute_decided', targetType: 'classified_order', targetId: order.id, before: { status: 'disputed' }, after: { decision: input.decision, fault, refund: decision.kind === 'partial' ? Number(decision.refund) : null, note: input.note } });
    const decided = await this.reload(order.id);
    if (fault === 'supplier') await this.guards.afterStrike(decided.seller, decided.country);
    if (fault === 'reseller' && decided.resellerId) await this.resellerStrike?.(decided.resellerId, decided.country);
    const outcome = { release: 'the money was released to the seller', refund: 'the buyer was refunded in full', partial: `${priceText(decision.kind === 'partial' ? decision.refund : 0n, order.currency)} was refunded to the buyer and the rest released to the seller` }[input.decision];
    for (const side of ['buyer', 'seller'] as const) await this.tell(decided, side, 'customer.classifieds.dispute_decided', `The dispute on SP-${decided.number} is decided`, `BitoCard decided: ${outcome}. ${input.note}`.slice(0, 280));
    await this.tellReseller(decided, `The dispute on SP-${decided.number} is decided`, `BitoCard decided: ${outcome}.`);
    return this.adminGet(order.id, actorId);
  }

  /** Finance approves a held payout (the seller can withdraw it after the payout hold) or keeps it held. */
  async decidePayoutReview(actorId: string | null, id: string, input: { decision: 'approve' | 'reject'; note: string }) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw notFound();
    if (order.payoutReview !== 'pending' && !(order.payoutReview === 'rejected' && input.decision === 'approve')) throw conflict('no_payout_review', 'This payout is not waiting for review.');
    const outcome = input.decision === 'approve' ? 'approved' : 'rejected';
    const claimed = await this.prisma.classifiedOrder.updateMany({ where: { id, payoutReview: order.payoutReview }, data: { payoutReview: outcome, payoutReviewedAt: new Date(), payoutReviewedById: actorId, payoutReviewNote: input.note } });
    if (!claimed.count) throw conflict('order_changed', 'This order changed: refresh and try again.');
    await this.audit.record({ actorId, action: 'classifieds.payout_review_decided', targetType: 'classified_order', targetId: id, before: { payout_review: order.payoutReview }, after: { payout_review: outcome, note: input.note } });
    if (outcome === 'approved') {
      await this.tell(order, 'seller', 'customer.classifieds.order_released', `Your payment for SP-${order.number} is checked`, `${priceText(order.sellerPayoutMinor ?? 0n, order.currency)} can be withdrawn once the payout hold ends.`);
    }
    return this.adminGet(id);
  }

  /** A seller's Safe pay strikes and whether they are limited. */
  async sellerStanding(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, country: true } });
    if (!customer?.country) throw notFound('seller');
    return { object: 'classified_safe_pay_standing' as const, customer_id: customer.id, ...(await this.guards.standing(customer.id, customer.country)) };
  }

  /** Lifts a seller's limit: strikes before now no longer count. */
  async clearStrikes(actorId: string | null, customerId: string, reason: string) {
    const before = await this.sellerStanding(customerId);
    const now = new Date();
    await this.prisma.classifiedSeller.upsert({ where: { customerId }, create: { customerId, safePayClearedAt: now }, update: { safePayClearedAt: now } });
    await this.audit.record({ actorId, action: 'classifieds.safe_pay_limit_cleared', targetType: 'customer', targetId: customerId, before: { strikes: before.strikes, limited: before.limited }, after: { reason } });
    return this.sellerStanding(customerId);
  }

  async adminSettings(country: string) {
    const row = await this.prisma.classifiedSafePaySettings.findUnique({ where: { country } });
    if (!row) throw notFound('country');
    return presentSettings(row);
  }

  async updateSettings(actorId: string | null, country: string, input: Partial<{ buyer_fee_bps: number; buyer_fee_cap: number; seller_fee_bps: number; seller_fee_cap: number; new_seller_order_limit: number | null; accept_hours: number; pay_hours: number; handover_days: number; confirm_days: number; strike_limit: number; transit_days: number; couriers: { name: string; tracking_url: string | null }[] }>) {
    const before = await this.adminSettings(country);
    const data: Prisma.ClassifiedSafePaySettingsUpdateInput = {
      ...(input.buyer_fee_bps !== undefined ? { buyerFeeBps: input.buyer_fee_bps } : {}),
      ...(input.buyer_fee_cap !== undefined ? { buyerFeeCapMinor: BigInt(input.buyer_fee_cap) } : {}),
      ...(input.seller_fee_bps !== undefined ? { sellerFeeBps: input.seller_fee_bps } : {}),
      ...(input.seller_fee_cap !== undefined ? { sellerFeeCapMinor: BigInt(input.seller_fee_cap) } : {}),
      ...(input.new_seller_order_limit !== undefined ? { newSellerOrderLimitMinor: input.new_seller_order_limit === null ? null : BigInt(input.new_seller_order_limit) } : {}),
      ...(input.accept_hours !== undefined ? { acceptHours: input.accept_hours } : {}),
      ...(input.pay_hours !== undefined ? { payHours: input.pay_hours } : {}),
      ...(input.handover_days !== undefined ? { handoverDays: input.handover_days } : {}),
      ...(input.confirm_days !== undefined ? { confirmDays: input.confirm_days } : {}),
      ...(input.strike_limit !== undefined ? { strikeLimit: input.strike_limit } : {}),
      ...(input.transit_days !== undefined ? { transitDays: input.transit_days } : {}),
      ...(input.couriers !== undefined ? { couriers: checkCouriers(input.couriers) } : {}),
    };
    const after = presentSettings(await this.prisma.classifiedSafePaySettings.update({ where: { country }, data }));
    await this.audit.record({ actorId, action: 'classifieds.safe_pay_settings_changed', targetType: 'country', targetId: country, before, after });
    return after;
  }

  // ---- The job ----

  /**
   * Requests not accepted, or not paid, in time lapse; paid orders not handed over in time are refunded in full; sent
   * orders not confirmed or disputed in time are released.
   */
  async runDue(now = new Date()) {
    let lapsed = 0;
    let refunded = 0;
    let released = 0;
    // Resale orders the supplier did not accept in time: the buyer's money is unlocked, and it is a strike.
    for (const order of await this.prisma.classifiedOrder.findMany({ where: { status: 'locked', acceptBy: { lte: now } }, include: orderInclude, take: 200 })) {
      try {
        await this.unlock(order, { status: 'lapsed', endedBy: 'seller', reason: 'not_accepted_in_time' });
        lapsed += 1;
        await this.guards.afterStrike(order.seller, order.country);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    for (const order of await this.prisma.classifiedOrder.findMany({ where: { OR: [{ status: 'requested', acceptBy: { lte: now } }, { status: 'awaiting_payment', payBy: { lte: now } }] }, include: orderInclude, take: 200 })) {
      const unaccepted = order.status === 'requested';
      const claimed = await this.prisma.classifiedOrder.updateMany({ where: { id: order.id, status: order.status }, data: { status: 'lapsed', closedAt: now, endedBy: unaccepted ? 'seller' : 'buyer', endReason: unaccepted ? 'not_accepted_in_time' : 'not_paid_in_time' } });
      if (!claimed.count) continue;
      lapsed += 1;
      if (unaccepted) await this.tell(order, 'buyer', 'customer.classifieds.order_lapsed', `Safe pay request for "${order.listing.title}" ended`, 'The seller did not answer in time. You can still chat with them.');
      else await this.tell(order, 'seller', 'customer.classifieds.order_lapsed', `SP-${order.number} ended`, 'The buyer did not pay in time.');
    }
    for (const order of await this.prisma.classifiedOrder.findMany({ where: { status: 'paid', handoverBy: { lte: now } }, include: orderInclude, take: 100 })) {
      try {
        await this.settle(order, { kind: 'refund', endedBy: 'bitocard', reason: 'not_handed_over' }, ['paid']);
        refunded += 1;
        const ended = await this.reload(order.id);
        await this.tell(ended, 'seller', 'customer.classifieds.order_cancelled', `SP-${ended.number} was cancelled`, 'It was not handed over in time, so the buyer was refunded.');
        await this.tellReseller(ended, `SP-${ended.number} was cancelled`, 'The supplier did not hand it over in time, so the buyer was refunded.');
        await this.guards.afterStrike(ended.seller, ended.country);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    for (const order of await this.prisma.classifiedOrder.findMany({ where: { status: 'sent', confirmBy: { lte: now } }, include: orderInclude, take: 100 })) {
      try {
        await this.settle(order, { kind: 'release' }, ['sent']);
        released += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    return { lapsed, refunded, released };
  }

  // ---- Money ----

  /**
   * Moves the escrowed money, once: claims the order from one of `from` and posts the entry in the same transaction.
   * Release: the price less the seller's fee to the seller's withdrawable money, both fees to revenue. Refund: the price
   * and the buyer's fee back to their wallet. Partial: part of the price back, the rest to the seller less their fee
   * on it, both fees to revenue.
   */
  private async settle(order: OrderRow, decision: { kind: 'release' } | { kind: 'refund'; endedBy: string; reason: string | null } | { kind: 'partial'; refund: bigint }, from: string[], extra?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const total = totalOf(order);
    const escrow = { kind: 'classified_escrow' as const, currency: order.currency };
    const buyerWallet = { kind: 'customer_wallet' as const, currency: order.currency, customerId: order.buyerId };
    const sellerMoney = { kind: 'customer_withdrawable' as const, currency: order.currency, customerId: order.sellerId };
    const revenue = { kind: 'classifieds_revenue' as const, currency: order.currency };
    const lines: Line[] = [{ account: escrow, debit: total }];
    const credit = (account: Line['account'], amount: bigint) => amount > 0n && lines.push({ account, credit: amount });
    const split = splitRelease(order, decision.kind === 'refund' ? null : decision.kind === 'partial' ? decision.refund : 0n);
    let status: string;
    let type: string;
    let refund: bigint | null = null;
    if (decision.kind === 'refund') {
      credit(buyerWallet, total);
      refund = total;
      [status, type] = ['refunded', 'classified_refund'];
    } else {
      if (decision.kind === 'partial') credit(buyerWallet, decision.refund);
      credit(sellerMoney, split!.sellerPayout);
      if (order.resellerId && split!.resellerPayout > 0n) credit({ kind: 'reseller_earnings_held', currency: order.currency, resellerId: order.resellerId }, split!.resellerPayout);
      credit(revenue, order.buyerFeeMinor + split!.sellerFee + split!.resellerFee);
      refund = decision.kind === 'partial' ? decision.refund : null;
      [status, type] = decision.kind === 'partial' ? ['partly_refunded', 'classified_partial'] : ['released', 'classified_release'];
    }
    const sellerPayout = split?.sellerPayout ?? null;
    const review = sellerPayout !== null && sellerPayout > 0n && (await this.guards.reversibleFunds(order.buyerId, order.mode));
    const entry = await this.ledger.prepare({
      mode: order.mode,
      type,
      reference: `classified_order:${order.id}:${status}`,
      description: `Safe pay SP-${order.number} ${status.replace('_', ' ')}`,
      metadata: { order: Number(order.number) },
      resellerId: order.resellerId,
      lines,
    });
    // The reseller's share is an earnings lot, released to withdrawable earnings after the country's payout hold.
    const hold = order.resellerId && split && split.resellerPayout > 0n ? ((await this.prisma.country.findUnique({ where: { code: order.country }, select: { payoutHoldDays: true } }))?.payoutHoldDays ?? 15) : null;
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedOrder.updateMany({
        where: { id: order.id, status: { in: from } },
        data: {
          status,
          ...(status === 'refunded' ? { refundedAt: now } : { releasedAt: now }),
          ...(status === 'partly_refunded' ? { refundedAt: now } : {}),
          sellerFeeMinor: split?.sellerFee ?? null,
          refundMinor: refund,
          sellerPayoutMinor: sellerPayout,
          ...(order.kind === 'resale' ? { resellerFeeMinor: split?.resellerFee ?? null, resellerPayoutMinor: split?.resellerPayout ?? null } : {}),
          ...(review ? { payoutReview: 'pending' } : {}),
          ...(decision.kind === 'refund' ? { endedBy: decision.endedBy, endReason: decision.reason } : {}),
        },
      });
      if (!claimed.count) throw conflict('order_changed', 'This order changed: refresh and try again.');
      await extra?.(tx);
      await this.ledger.write(tx, entry);
      if (hold !== null) {
        await tx.earningsLot.create({ data: { resellerId: order.resellerId!, mode: order.mode, currency: order.currency, amountMinor: split!.resellerPayout, reference: `classified_order:${order.id}`, releaseAt: new Date(now.getTime() + hold * dayMs) } });
      }
      // Released (wholly or in part): its units are sold; with none left, the listing is.
      if (status !== 'refunded') {
        await tx.$executeRaw`
          UPDATE "classified_listings" SET
            "stock" = GREATEST("stock" - ${order.quantity}, 0),
            "status" = CASE WHEN "stock" <= ${order.quantity} AND "status" = 'active' THEN 'sold' ELSE "status" END,
            "sold_at" = CASE WHEN "stock" <= ${order.quantity} AND "status" = 'active' THEN ${now} ELSE "sold_at" END,
            "updated_at" = ${now}
          WHERE "id" = ${order.listingId}::uuid`;
      }
      if (order.kind === 'resale') await this.resaleEvents?.changed(tx, order.id);
    });
    if (order.kind === 'resale') this.resaleEvents?.committed();
    const done = await this.reload(order.id);
    if (done.kind === 'resale') {
      const words = status === 'released' ? 'was completed' : status === 'refunded' ? 'was refunded' : 'was partly refunded';
      await this.tellReseller(done, `SP-${done.number} ${words}`, split && split.resellerPayout > 0n ? `${priceText(split.resellerPayout, done.currency)} was added to your earnings, withdrawable after the payout hold.` : 'Nothing was added to your earnings.');
    }
    if (status !== 'refunded') {
      await this.tell(
        done,
        'seller',
        'customer.classifieds.order_released',
        `You were paid for SP-${done.number}`,
        review
          ? `${priceText(sellerPayout!, order.currency)} is in your Shop money. BitoCard checks this payment before it can be withdrawn; you will be told when it is ready.`
          : `${priceText(sellerPayout!, order.currency)} is in your Shop money, ready to withdraw once the payout hold ends.`,
      );
      if (review) await this.inbox.admins('admin.classifieds.payout_review', { subject: done.id, title: `Check the payout of SP-${done.number}`, body: `The buyer topped up by card or mobile money in the last 60 days. Approve the seller's ${priceText(sellerPayout!, order.currency)} for withdrawal, or keep it held.`, link: `/classifieds/orders/${done.id}` });
      await this.noteInChat(done, 'Safe pay released the money to the seller.');
    }
    if (refund !== null) await this.tell(done, 'buyer', 'customer.classifieds.order_refunded', `SP-${done.number} was refunded`, `${priceText(refund, order.currency)} is back in your wallet.`);
  }

  // ---- Helpers ----

  /** Units of a listing held by orders (locked, or paid and not yet released or refunded). */
  private held(listingId: string) {
    return heldUnits(this.prisma, listingId);
  }

  /**
   * An order for one of its parties. bitocard.com accounts pass BitoCard Shop's own gate; a store customer is a party
   * only as the buyer of a resale order (they bought on a reseller's Resale shop). Anything else is not found.
   */
  private async forParty(customer: CustomerWithStore, id: string, side?: Side) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    const actual = order ? this.sideOf(order, customer.id) : null;
    if (!order || !actual) throw notFound();
    if (customer.store.reseller.house) await this.listings.sellerCountry(customer);
    else if (!(order.kind === 'resale' && actual === 'buyer' && order.storeId === customer.storeId)) throw notFound();
    if (side && actual !== side) throw notYours(side === 'seller' ? 'Only the seller can do this.' : 'Only the buyer can do this.');
    return order;
  }

  private reserved(stock: number) {
    return conflict('listing_reserved', stock === 1 ? 'Someone has already paid for this with Safe pay.' : 'Every one of these is already paid for with Safe pay.');
  }

  private walletLow(short: bigint, currency: string) {
    return new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Add ${priceText(short, currency)} to your wallet to pay.`, 'amount');
  }

  private wrongStatus(order: OrderRow, verb: string) {
    return conflict('order_changed', `This order is ${order.status.replace('_', ' ')}, so it cannot be ${verb} now.`);
  }

  private sideOf(order: { buyerId: string; sellerId: string }, customerId: string): Side | null {
    return order.buyerId === customerId ? 'buyer' : order.sellerId === customerId ? 'seller' : null;
  }

  private async reload(id: string) {
    return this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
  }

  private async party(customer: CustomerWithStore, id: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order || !this.sideOf(order, customer.id)) throw notFound();
    return order;
  }

  private async mine(customer: CustomerWithStore, id: string, side: Side) {
    const order = await this.party(customer, id);
    if (this.sideOf(order, customer.id) !== side) throw notYours(side === 'seller' ? 'Only the seller can do this.' : 'Only the buyer can do this.');
    return order;
  }

  /**
   * Tells the buyer or the seller. A resale order's buyer hears from the store they bought on (their order page in its
   * account app), whatever type the call names; its supplier sees it in the Shop tab like any order.
   */
  private async tell(order: OrderRow, to: Side, type: Parameters<InboxService['customer']>[1], title: string, body: string) {
    const recipient = to === 'buyer' ? order.buyer : order.seller;
    const resaleBuyer = order.kind === 'resale' && to === 'buyer';
    await this.inbox.customer({ customerId: recipient.id, storeId: recipient.storeId }, resaleBuyer && !type.startsWith('customer.purchase.') ? 'customer.purchase.updated' : type, {
      subject: `${order.id}:${type}:${Date.now()}`,
      title,
      body,
      link: resaleBuyer ? `/account/purchases/${order.id}` : `/shop/orders/${order.id}`,
      mode: order.mode,
    });
  }

  /** Tells a resale order's reseller (nothing for a direct order). */
  private async tellReseller(order: OrderRow, title: string, body: string) {
    if (order.kind !== 'resale' || !order.resellerId) return;
    await this.inbox.reseller(order.resellerId, 'resale.order_updated', { subject: `${order.id}:${title}`, title, body, link: `/resale/orders/${order.id}`, mode: order.mode });
  }

  /** A line from BitoCard in the order's conversation: a resale order's order chat, else the buyer's chat with the seller. */
  private async noteInChat(order: OrderRow, body: string) {
    if (order.kind === 'resale') {
      await this.prisma.resaleOrderMessage.create({ data: { orderId: order.id, thread: 'order', author: 'bitocard', body } });
      return;
    }
    const chat = await this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId: order.listingId, buyerId: order.buyerId } }, select: { id: true } });
    if (!chat) return;
    const now = new Date();
    await this.prisma.$transaction([this.prisma.classifiedMessage.create({ data: { conversationId: chat.id, kind: 'system', body, createdAt: now } }), this.prisma.classifiedConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now } })]);
  }

  private presentDispute(dispute: NonNullable<OrderRow['dispute']>) {
    return { object: 'classified_dispute' as const, id: dispute.id, reason: dispute.reason, status: dispute.status, decision: dispute.decision, fault: dispute.fault, refund: dispute.refundMinor === null ? null : Number(dispute.refundMinor), note: dispute.note, decided_at: dispute.decidedAt?.toISOString() ?? null, created_at: dispute.createdAt.toISOString() };
  }

  /**
   * A dispute message for one reader: `from` is `me`, `them` (the other side), `bitocard`, or the author for BitoCard;
   * `name` says who wrote it. A resale order's buyer reads the supplier's and the reseller's messages as the store's.
   */
  private presentDisputeMessage(message: { id: string; author: string; body: string; objectKey: string | null; contentType: string | null; size: number | null; width: number | null; height: number | null; createdAt: Date }, order: OrderRow, viewer: Side | 'admin' | 'reseller') {
    const base = viewer === 'admin' ? `/v1/admin/classifieds/orders/${order.id}/dispute/photos/${message.id}` : viewer === 'reseller' ? `/v1/resale/orders/${order.id}/dispute/photos/${message.id}` : `/v1/classifieds/orders/${order.id}/dispute/photos/${message.id}`;
    const store = order.store?.name ?? 'The store';
    const name =
      message.author === 'bitocard'
        ? 'BitoCard'
        : message.author === 'buyer'
          ? publicName(order.buyer.name)
          : order.kind === 'resale' && viewer === 'buyer'
            ? store
            : message.author === 'reseller'
              ? store
              : order.kind === 'resale'
                ? `${publicName(order.seller.name)} (supplier)`
                : publicName(order.seller.name);
    return {
      object: 'classified_dispute_message' as const,
      id: message.id,
      from: viewer === 'admin' || message.author === 'bitocard' ? message.author : message.author === viewer ? 'me' : 'them',
      name,
      body: message.body,
      photo: message.objectKey ? { url: base, content_type: message.contentType, size: message.size, width: message.width, height: message.height } : null,
      created_at: message.createdAt.toISOString(),
    };
  }

  /**
   * Each side sees its own money only: the buyer their fee and total, the seller their fee and payout. On a resale
   * order the buyer sees the store as who they bought from (and the supplier named as the seller), the supplier their
   * price, discount and net but not the store's price, and the reseller their margin; `details` are the buyer's
   * details for the supplier, the reseller and BitoCard once accepted (`buyerDetails`, which logs the view).
   */
  present(order: OrderRow, viewer: Viewer, details: Awaited<ReturnType<SafePayService['buyerDetails']>> = null) {
    const split = splitRelease(order, order.status === 'refunded' ? null : order.status === 'partly_refunded' ? (order.refundMinor ?? 0n) : 0n);
    const projectedSellerFee = order.sellerFeeMinor ?? split?.sellerFee ?? 0n;
    const showAddress = (viewer === 'seller' || viewer === 'admin') && order.kind === 'direct' && order.deliveryAddress && order.paidAt;
    const them = viewer === 'buyer' ? order.seller : order.buyer;
    const resale = order.kind === 'resale';
    const sellerPrice = resale ? order.supplierPriceMinor! : order.priceMinor;
    const photoBase = viewer === 'admin' ? `/v1/admin/classifieds/orders/${order.id}/dispatch-photos` : viewer === 'reseller' ? `/v1/resale/orders/${order.id}/dispatch-photos` : resale && viewer === 'buyer' ? `/v1/store/resale/orders/${order.id}/dispatch-photos` : `/v1/classifieds/orders/${order.id}/dispatch-photos`;
    return {
      object: 'classified_order' as const,
      id: order.id,
      number: `SP-${order.number}`,
      role: viewer,
      status: order.status,
      listing: { id: order.listing.id, ref: Number(order.listing.ref), title: order.listing.title, slug: order.listing.slug, cover_url: order.listing.media[0]?.url ?? null },
      kind: order.kind,
      quantity: order.quantity,
      ...(viewer === 'admin'
        ? {
            buyer: { id: order.buyer.id, name: order.buyer.name, email: order.buyer.email },
            seller: { id: order.seller.id, name: order.seller.name, email: order.seller.email },
            mode: order.mode,
            country: order.country,
            rates: { buyer_fee_bps: order.buyerFeeBps, buyer_fee_cap: Number(order.buyerFeeCapMinor), seller_fee_bps: order.sellerFeeBps, seller_fee_cap: Number(order.sellerFeeCapMinor), ...(resale ? { reseller_fee_bps: order.resellerFeeBps, reseller_fee_cap: Number(order.resellerFeeCapMinor) } : {}) },
          }
        : { with: { name: resale && viewer === 'buyer' ? (order.store?.name ?? '') : viewer === 'reseller' ? publicName(order.buyer.name) : publicName(them.name) } }),
      store: resale && order.store ? { id: order.store.id, name: order.store.name, subdomain: order.store.subdomain, logo_url: order.store.logoUrl } : null,
      supplier: resale && viewer !== 'seller' ? { name: publicName(order.seller.name) } : null,
      fulfilment: order.fulfilment,
      currency: order.currency,
      price: Number(viewer === 'seller' ? sellerPrice : order.priceMinor),
      delivery_fee: Number(order.deliveryFeeMinor),
      ...(viewer !== 'seller' ? { buyer_fee: Number(order.buyerFeeMinor), total: Number(totalOf(order)) } : {}),
      ...(viewer === 'seller' || viewer === 'admin' ? { seller_fee: Number(projectedSellerFee), payout: Number(order.sellerPayoutMinor ?? (split ? split.sellerPayout : 0n)) } : {}),
      resale:
        resale && viewer !== 'buyer'
          ? {
              supplier_price: Number(order.supplierPriceMinor),
              discount_bps: order.discountBps,
              supplier_net: Number(order.supplierNetMinor),
              deal_id: order.dealId,
              ...(viewer !== 'seller'
                ? { margin: Number(order.resellerMarginMinor), reseller_fee: Number(order.resellerFeeMinor ?? split?.resellerFee ?? 0n), earnings: Number(order.resellerPayoutMinor ?? split?.resellerPayout ?? 0n) }
                : {}),
            }
          : null,
      refund: order.refundMinor === null || viewer === 'seller' ? null : Number(order.refundMinor),
      delivery_address: showAddress ? this.encryption().decrypt(order.deliveryAddress!) : null,
      buyer_details: details,
      tracking_note: order.trackingNote,
      shipment:
        order.fulfilment === 'delivery'
          ? {
              courier: order.courier,
              tracking_number: order.trackingNumber,
              tracking_url: order.trackingUrl,
              delivered_at: order.deliveredAt?.toISOString() ?? null,
              events: order.shipmentEvents.map(event => ({ status: event.status, note: event.note, reported_by: event.reportedBy, at: event.createdAt.toISOString() })),
              dispatch_photos: order.dispatchPhotos.map(photo => ({ id: photo.id, url: `${photoBase}/${photo.id}`, content_type: photo.contentType, width: photo.width, height: photo.height })),
            }
          : null,
      release_tries_left: order.fulfilment === 'meet_up' && viewer !== 'buyer' ? releaseCodeTries - order.releaseAttempts : null,
      deadlines: { accept_by: order.acceptBy.toISOString(), pay_by: order.payBy?.toISOString() ?? null, handover_by: order.handoverBy?.toISOString() ?? null, confirm_by: order.confirmBy?.toISOString() ?? null },
      timeline: {
        requested_at: order.createdAt.toISOString(),
        locked_at: order.lockedAt?.toISOString() ?? null,
        accepted_at: order.acceptedAt?.toISOString() ?? null,
        paid_at: order.paidAt?.toISOString() ?? null,
        sent_at: order.sentAt?.toISOString() ?? null,
        released_at: order.releasedAt?.toISOString() ?? null,
        refunded_at: order.refundedAt?.toISOString() ?? null,
        closed_at: order.closedAt?.toISOString() ?? null,
      },
      ended_by: order.endedBy,
      end_reason: order.endReason,
      payout_review: viewer === 'seller' || viewer === 'admin' ? order.payoutReview : null,
      dispute: order.dispute ? { id: order.dispute.id, status: order.dispute.status, reason: order.dispute.reason, decision: order.dispute.decision } : null,
    };
  }
}

/**
 * Who gets what when an order's money is released, after `refund` of the item's price goes back to the buyer (null: all
 * of it refunded, nothing released). A direct order's seller gets the rest less their fee; a resale order's rest is
 * split between the supplier and the reseller in proportion to their shares of the price (the supplier's rounded
 * down), each paying their fee on what they receive. The delivery charge goes to the seller in full.
 */
export function splitRelease(order: { kind: string; priceMinor: bigint; deliveryFeeMinor: bigint; sellerFeeBps: number; sellerFeeCapMinor: bigint; supplierNetMinor: bigint | null; resellerFeeBps: number | null; resellerFeeCapMinor: bigint | null }, refund: bigint | null) {
  if (refund === null) return null;
  const rest = order.priceMinor - refund;
  const sellerShare = order.kind === 'resale' && order.priceMinor > 0n ? (rest * order.supplierNetMinor!) / order.priceMinor : rest;
  const resellerShare = rest - sellerShare;
  const sellerFee = safePayFee(sellerShare, order.sellerFeeBps, order.sellerFeeCapMinor);
  const resellerFee = order.kind === 'resale' && order.resellerFeeBps !== null && order.resellerFeeCapMinor !== null ? safePayFee(resellerShare, order.resellerFeeBps, order.resellerFeeCapMinor) : 0n;
  return { sellerFee, sellerPayout: sellerShare - sellerFee + order.deliveryFeeMinor, resellerFee, resellerPayout: resellerShare - resellerFee };
}

/** How a listing can reach the buyer: met in person, delivered, or either. */
export function fulfilmentOf(listing: { pickup: boolean; delivery: string }) {
  return [...(listing.pickup ? ['meet_up' as const] : []), ...(listing.delivery !== 'none' ? ['delivery' as const] : [])];
}

/** A listing's delivery charges: within the seller's state, and elsewhere (null where it does not deliver). */
export function deliveryOptions(listing: { delivery: string; stateId: string | null; deliveryFeeStateMinor: bigint; deliveryFeeNationwideMinor: bigint }) {
  if (listing.delivery === 'none') return null;
  return { state_id: listing.stateId, within_state: Number(listing.deliveryFeeStateMinor), nationwide: listing.delivery === 'nationwide' ? Number(listing.deliveryFeeNationwideMinor) : null };
}

/** The couriers an admin offers in a country: named once each, with an https tracking link holding `{tracking}` if any. */
function checkCouriers(couriers: { name: string; tracking_url: string | null }[]) {
  if (couriers.length > 30) throw invalid('parameter_invalid', 'Offer at most 30 couriers.', 'couriers');
  const seen = new Set<string>();
  return couriers.map((courier, index) => {
    const name = (courier.name ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60 || seen.has(name.toLowerCase())) throw invalid('parameter_invalid', 'Each courier needs its own name (2 to 60 characters).', `couriers[${index}].name`);
    seen.add(name.toLowerCase());
    const link = courier.tracking_url?.trim() || null;
    if (link) {
      let ok = false;
      try {
        ok = new URL(link.replace('{tracking}', 'x')).protocol === 'https:' && link.includes('{tracking}') && link.length <= 300;
      } catch {
        ok = false;
      }
      if (!ok) throw invalid('parameter_invalid', 'A tracking link is an https address with {tracking} where the number goes.', `couriers[${index}].tracking_url`);
    }
    return { name, tracking_url: link };
  });
}

function presentSettings(row: { country: string; buyerFeeBps: number | null; buyerFeeCapMinor: bigint | null; sellerFeeBps: number | null; sellerFeeCapMinor: bigint | null; newSellerOrderLimitMinor: bigint | null; acceptHours: number; payHours: number; handoverDays: number; confirmDays: number; strikeLimit: number; transitDays: number; couriers: unknown }) {
  const num = (value: bigint | null) => (value === null ? null : Number(value));
  return {
    object: 'classified_safe_pay_settings' as const,
    country: row.country,
    buyer_fee_bps: row.buyerFeeBps,
    buyer_fee_cap: num(row.buyerFeeCapMinor),
    seller_fee_bps: row.sellerFeeBps,
    seller_fee_cap: num(row.sellerFeeCapMinor),
    new_seller_order_limit: num(row.newSellerOrderLimitMinor),
    accept_hours: row.acceptHours,
    pay_hours: row.payHours,
    handover_days: row.handoverDays,
    confirm_days: row.confirmDays,
    strike_limit: row.strikeLimit,
    transit_days: row.transitDays,
    couriers: Array.isArray(row.couriers) ? (row.couriers as { name: string; tracking_url: string | null }[]) : [],
    ready: row.buyerFeeBps !== null && row.buyerFeeCapMinor !== null && row.sellerFeeBps !== null && row.sellerFeeCapMinor !== null,
  };
}
