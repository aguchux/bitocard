import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { WatermarkService } from '../../watermarks/watermarks.service.js';
import { cleanNote, ContactRequestsService, listingPath } from '../contact.service.js';
import { safetyNote } from '../conversations.service.js';
import { DiscoveryRecorder } from '../discovery/recorder.service.js';
import { addLead } from '../leads.service.js';
import { ListingsService } from '../listings.service.js';
import { heldUnits, invalid, isOnShop, maxPriceMinor, priceText } from '../rules.js';
import { SafePayGuardsService } from '../safe-pay-guards.service.js';
import { publicName } from '../search.service.js';
import { ShopEmails } from '../shop-emails.service.js';
import { ShopTermsService } from '../terms.service.js';
import { recordPurchase } from '../reviews/purchases.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import {
  actionsFor,
  autoCompleteMs,
  type BuyOrderAction,
  type BuyOrderSide,
  buyOrderNumber,
  type BuyOrderStatus,
  buyOrderStatuses,
  keepBuyOrdersMs,
  maxBuyNote,
  openBuyOrderStatuses,
  sideOf,
  summary,
  voidPauseMs,
  voidsBeforePause,
  voidUntil,
  voidWindowCountMs,
} from './present.js';
import { outOfStockNotice, takeStock } from '../stock.js';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

const notFound = (what = 'buy order') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const forbidden = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message);
const tooMany = (message: string) => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'buy_limit_reached', message);

const listingSelect = {
  id: true,
  ref: true,
  slug: true,
  title: true,
  country: true,
  currency: true,
  status: true,
  onShop: true,
  contact: true,
  customerId: true,
  priceKind: true,
  priceMinor: true,
  stock: true,
  media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1, select: { id: true, url: true } },
} satisfies Prisma.ClassifiedListingSelect;

const person = { select: { id: true, name: true, email: true, storeId: true } } satisfies Prisma.CustomerDefaultArgs;
const orderInclude = { listing: { select: listingSelect }, buyer: person, seller: person } satisfies Prisma.ClassifiedBuyOrderInclude;
type OrderRow = Prisma.ClassifiedBuyOrderGetPayload<{ include: typeof orderInclude }>;

type NoticeType = Parameters<InboxService['customer']>[1];

export type BuyOrderInput = { price: number; quantity?: number; note?: string; meet_note?: string };
export type BuyOrderActionInput = { price?: number; reason?: string };

/**
 * Udozo's buy orders (docs/UDOZO_RATINGS_PLAN.md phase 0): the one place a purchase starts. The buyer asks to buy a
 * listing at a price; the seller accepts (its units held for the buyer), offers another price, or declines, within the
 * market's hours; once accepted they meet within the market's days and pay each other in person, off Udozo; the seller
 * marks it sold, or the buyer says they bought it (completing by itself after 3 days without a word from the seller).
 * The buyer may say they did not buy it within 7 days of the seller marking it sold, and three of those in 90 days
 * pause the seller's buy orders for 30 days. Every step is claimed in one conditional update, so a step done twice, or
 * by the job and a person at once, happens once. Each step is a card in the listing's chat and an inbox notice.
 */
@Injectable()
export class BuyOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
    private readonly guards: SafePayGuardsService,
    private readonly contacts: ContactRequestsService,
    private readonly terms: ShopTermsService,
    private readonly audit: AuditService,
    private readonly discovery: DiscoveryRecorder,
    private readonly watermarks: WatermarkService,
    private readonly reviews: ReviewsService,
  ) {}

  /** Whether buy orders are open in a market (the `classifieds_buy_orders` switch). */
  async enabled(country: string) {
    return this.settings.isOnForCountry('classifieds_buy_orders', country);
  }

  private async open(country: string) {
    if (!(await this.enabled(country))) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'buy_orders_unavailable', 'Buy orders are not open in this country yet. Chat with the seller to agree the sale.');
  }

  // ---- The buyer asks ----

  async create(customer: CustomerWithStore, listingId: string, input: BuyOrderInput) {
    const country = await this.listings.sellerCountry(customer);
    await this.open(country);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: listingSelect });
    if (!listing || !isOnShop(listing) || listing.country !== country) throw notFound('listing');
    if (listing.customerId === customer.id) throw invalid('own_listing', 'This is your own listing.', 'listing_id');
    if (!customer.phone || !customer.phoneVerifiedAt) throw conflict('phone_required', 'Confirm your mobile number on your profile first: the seller needs to know they can reach you.', 'phone');
    if (await this.contacts.blocked(listing.customerId, customer.id)) throw forbidden('seller_unavailable', 'You cannot buy from this seller.');
    await this.requireNotPaused(listing.customerId);
    if (listing.stock === 0) throw conflict('out_of_stock', 'This is out of stock: the seller has none to sell right now.', 'quantity');
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(listing.stock, 100)) throw invalid('parameter_invalid', listing.stock === 1 ? 'There is one of these.' : `Choose 1 to ${Math.min(listing.stock, 100)}.`, 'quantity');
    const price = this.checkPrice(input.price);
    await this.terms.require(customer.id);
    await this.requireDifferentPeople(customer.id, listing.customerId);
    const rules = await this.listings.marketSettings(country);
    const [open, today] = await Promise.all([
      this.prisma.classifiedBuyOrder.count({ where: { buyerId: customer.id, status: { in: openBuyOrderStatuses } } }),
      this.prisma.classifiedBuyOrder.count({ where: { buyerId: customer.id, createdAt: { gt: new Date(Date.now() - dayMs) } } }),
    ]);
    if (open >= rules.buyOpenPerBuyer) throw tooMany(`You have ${open} buy orders waiting. Finish or cancel some before asking again.`);
    if (today >= rules.buyRequestsPerDay) throw tooMany('You have sent a lot of buy orders today. Try again tomorrow.');
    if ((await heldUnits(this.prisma, listing.id)) + quantity > listing.stock) throw conflict('out_of_stock', listing.stock === 1 ? 'The seller is already holding this for another buyer.' : 'The seller is holding the rest of these for other buyers.', 'quantity');

    const now = new Date();
    let id: string;
    try {
      id = await this.prisma.$transaction(async tx => {
        const chatId = await this.chatFor(tx, listing, customer.id, now);
        const order = await tx.classifiedBuyOrder.create({
          data: {
            listingId: listing.id,
            conversationId: chatId,
            buyerId: customer.id,
            sellerId: listing.customerId,
            country,
            currency: listing.currency,
            priceMinor: price,
            quantity,
            note: input.note?.trim() ? cleanNote(input.note).slice(0, maxBuyNote) : null,
            meetNote: input.meet_note?.trim() ? cleanNote(input.meet_note).slice(0, maxBuyNote) : null,
            respondBy: new Date(now.getTime() + rules.buyRequestHours * hourMs),
            createdAt: now,
          },
        });
        await this.card(tx, { id: order.id, conversationId: chatId }, customer.id, `Asked to buy ${quantity > 1 ? `${quantity} for ` : 'for '}${priceText(price, listing.currency)}.`, now);
        return order.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('buy_order_open', 'You already have a buy order for this listing. Open it from your buy orders.');
      throw error;
    }
    await this.discovery.record(customer.id, country, 'order', listing.id);
    const order = await this.reload(id);
    const title = `${publicName(customer.name)} wants to buy “${listing.title ?? 'your listing'}”`;
    const body = `For ${priceText(price, listing.currency)}. Accept, offer another price or decline within ${rules.buyRequestHours} hours.`;
    await this.tell(order, 'seller', 'customer.classifieds.buy_request', title, body, true);
    return this.present(order, customer.id);
  }

  // ---- Reading ----

  async list(customer: CustomerWithStore, query: { role?: 'buying' | 'selling'; status?: string; limit?: number; offset?: number }) {
    await this.listings.sellerCountry(customer);
    const status = query.status && (buyOrderStatuses as readonly string[]).includes(query.status) ? query.status : query.status === 'open' ? { in: openBuyOrderStatuses } : undefined;
    const where: Prisma.ClassifiedBuyOrderWhereInput = {
      ...(query.role === 'selling' ? { sellerId: customer.id } : query.role === 'buying' ? { buyerId: customer.id } : { OR: [{ buyerId: customer.id }, { sellerId: customer.id }] }),
      ...(status ? { status } : {}),
    };
    const rows = await this.prisma.classifiedBuyOrder.findMany({ where, include: orderInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: Math.min(query.limit ?? 30, 100), skip: query.offset ?? 0 });
    return { object: 'list' as const, data: rows.map(row => this.present(row, customer.id)), waiting: await this.waiting(customer.id) };
  }

  /** Buy orders waiting on this customer: requests to answer and sales to confirm (seller), prices to answer (buyer). */
  async waiting(customerId: string) {
    return this.prisma.classifiedBuyOrder.count({
      where: { OR: [{ sellerId: customerId, status: 'requested' }, { sellerId: customerId, status: 'accepted', boughtAt: { not: null } }, { buyerId: customerId, status: 'countered' }] },
    });
  }

  async get(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    return this.present(await this.party(customer.id, id), customer.id);
  }

  /** The buyer's open buy order for a listing, else their latest completed one (the listing page's viewer). */
  async forViewer(customerId: string, listingId: string) {
    const row =
      (await this.prisma.classifiedBuyOrder.findFirst({ where: { buyerId: customerId, listingId, status: { in: openBuyOrderStatuses } }, include: orderInclude })) ??
      (await this.prisma.classifiedBuyOrder.findFirst({ where: { buyerId: customerId, listingId, status: 'completed' }, include: orderInclude, orderBy: { completedAt: 'desc' } }));
    return row ? summary(row, customerId) : null;
  }

  /** A seller's accepted buy orders for one of their listings (Mark sold offers them first). */
  async acceptedFor(customer: CustomerWithStore, listingId: string) {
    await this.listings.sellerCountry(customer);
    const rows = await this.prisma.classifiedBuyOrder.findMany({ where: { listingId, sellerId: customer.id, status: 'accepted' }, include: orderInclude, orderBy: { acceptedAt: 'asc' }, take: 50 });
    return { object: 'list' as const, data: rows.map(row => this.present(row, customer.id)), waiting: 0 };
  }

  // ---- Steps ----

  async act(customer: CustomerWithStore, id: string, action: BuyOrderAction, input: BuyOrderActionInput = {}) {
    await this.listings.sellerCountry(customer);
    const order = await this.party(customer.id, id);
    const side = sideOf(order, customer.id)!;
    const allowed = actionsFor(order, side);
    if (!allowed.includes(action)) throw this.refusal(order, side, action);
    const reason = input.reason?.trim() ? cleanNote(input.reason).slice(0, maxBuyNote) : null;
    const name = publicName(customer.name);
    const title = order.listing.title ?? 'the listing';
    switch (action) {
      case 'accept':
        return this.accept(customer, order, 'requested', order.priceMinor);
      case 'accept_counter':
        return this.accept(customer, order, 'countered', order.counterMinor!);
      case 'counter': {
        const price = this.checkPrice(input.price);
        if (price === order.priceMinor) throw invalid('parameter_invalid', 'Offer a different price, or accept theirs.', 'price');
        const rules = await this.listings.marketSettings(order.country);
        const now = new Date();
        await this.step(order, ['requested'], { status: 'countered', counterMinor: price, respondBy: new Date(now.getTime() + rules.buyRequestHours * hourMs) }, customer.id, `Offered ${priceText(price, order.currency)} instead.`);
        const done = await this.reload(id);
        await this.tell(done, 'buyer', 'customer.classifieds.buy_countered', `${name} offered ${priceText(price, order.currency)}`, `For “${title}”. Accept it or cancel within ${rules.buyRequestHours} hours.`);
        return this.present(done, customer.id);
      }
      case 'decline':
        return this.end(customer, order, side, ['requested'], 'declined', reason, `Declined${reason ? `: ${reason}` : '.'}`, 'customer.classifieds.buy_declined', `${name} declined your buy order`, `For “${title}”. You can still chat with them, or find another.`);
      case 'cancel':
        return this.end(customer, order, side, openBuyOrderStatuses, 'cancelled', reason, `Cancelled the buy order${reason ? `: ${reason}` : '.'}`, 'customer.classifieds.buy_cancelled', `${name} cancelled the buy order`, `For “${title}”${reason ? `: ${reason}` : '.'}`);
      case 'no_show':
        return this.end(customer, order, side, ['accepted'], 'no_show', reason, `Said the sale did not happen${reason ? `: ${reason}` : '.'}`, 'customer.classifieds.buy_cancelled', `${name} says the sale did not happen`, `For “${title}”. The buy order has ended.`);
      case 'extend': {
        const rules = await this.listings.marketSettings(order.country);
        const meetBy = new Date((order.meetBy ?? new Date()).getTime() + rules.buyMeetDays * dayMs);
        await this.step(order, ['accepted'], { meetBy, meetExtended: true, meetRemindedAt: null }, customer.id, `Gave ${rules.buyMeetDays} more days to meet.`, { meetExtended: false });
        const done = await this.reload(id);
        await this.tell(done, 'buyer', 'customer.classifieds.buy_updated', `${name} gave you more time`, `To meet and buy “${title}”, until ${dateText(meetBy)}.`);
        return this.present(done, customer.id);
      }
      case 'bought': {
        await this.step(order, ['accepted'], { boughtAt: new Date() }, customer.id, 'Said they bought it. The seller confirms the sale.', { boughtAt: null });
        const done = await this.reload(id);
        await this.tell(done, 'seller', 'customer.classifieds.buy_bought', `${name} says they bought “${title}”`, 'Mark it sold to confirm. If you say nothing, it is recorded as sold in 3 days.');
        return this.present(done, customer.id);
      }
      case 'complete':
        await this.requireDifferentPeople(order.buyerId, order.sellerId);
        await this.complete(order, order.boughtAt ? 'buyer' : 'seller', customer.id);
        return this.present(await this.reload(id), customer.id);
      case 'void':
        return this.void(customer, order, reason);
      case 'confirm': {
        // Yes, I bought it: the sale stands (no longer to confirm in Reviews); they can still say otherwise within 7 days.
        const claimed = await this.prisma.classifiedBuyOrder.updateMany({ where: { id: order.id, status: 'completed', buyerConfirmedAt: null }, data: { buyerConfirmedAt: new Date() } });
        if (!claimed.count) throw conflict('buy_order_changed', 'This buy order has changed. Refresh to see where it stands.');
        return this.present(await this.reload(id), customer.id);
      }
    }
  }

  /** The seller accepts the buyer's price, or the buyer the seller's: the units are held while they meet. */
  private async accept(customer: CustomerWithStore, order: OrderRow, from: 'requested' | 'countered', price: bigint) {
    const rules = await this.listings.marketSettings(order.country);
    const now = new Date();
    const meetBy = new Date(now.getTime() + rules.buyMeetDays * dayMs);
    await this.prisma.$transaction(async tx => {
      // Locked against a Safe pay payment or another acceptance taking the same units.
      const [listing] = await tx.$queryRaw<{ stock: number; status: string; on_shop: boolean }[]>`SELECT "stock", "status", "on_shop" FROM "classified_listings" WHERE "id" = ${order.listingId}::uuid FOR UPDATE`;
      if (!listing || listing.status !== 'active' || !listing.on_shop) throw conflict('listing_unavailable', 'This listing is no longer live.');
      if (listing.stock === 0) throw conflict('out_of_stock', 'This is out of stock: add stock to the listing before accepting.');
      if ((await heldUnits(tx, order.listingId, order.id)) + order.quantity > listing.stock) throw conflict('out_of_stock', 'Every one of these is already held for other buyers.');
      const claimed = await tx.classifiedBuyOrder.updateMany({ where: { id: order.id, status: from }, data: { status: 'accepted', priceMinor: price, counterMinor: null, respondBy: null, acceptedAt: now, meetBy } });
      if (!claimed.count) throw this.changed();
      await this.card(tx, order, customer.id, from === 'requested' ? `Accepted ${priceText(price, order.currency)}. Meet by ${dateText(meetBy)}.` : `Accepted ${priceText(price, order.currency)}. Meet by ${dateText(meetBy)}.`, now);
    });
    const done = await this.reload(order.id);
    const title = order.listing.title ?? 'the listing';
    const name = publicName(customer.name);
    if (from === 'requested') {
      await this.tell(done, 'buyer', 'customer.classifieds.buy_accepted', `${name} accepted your buy order`, `For “${title}” at ${priceText(price, order.currency)}. Agree where to meet in the chat, inspect it, then pay. Meet by ${dateText(meetBy)}.`, true);
    } else {
      await this.tell(done, 'seller', 'customer.classifieds.buy_accepted', `${name} accepted your price`, `For “${title}” at ${priceText(price, order.currency)}. It is held for them until ${dateText(meetBy)}. Mark it sold once they have bought it.`, true);
    }
    return this.present(done, customer.id);
  }

  /** Ends an open order: declined, cancelled or no-show; the units go back and the other side is told. */
  private async end(customer: CustomerWithStore, order: OrderRow, side: BuyOrderSide, from: BuyOrderStatus[], status: BuyOrderStatus, reason: string | null, card: string, type: NoticeType, title: string, body: string) {
    await this.step(order, from, { status, endedBy: side, endReason: reason, closedAt: new Date(), respondBy: null }, customer.id, card);
    const done = await this.reload(order.id);
    await this.tell(done, side === 'buyer' ? 'seller' : 'buyer', type, title, body);
    return this.present(done, customer.id);
  }

  /**
   * Completes an accepted order, once: its units are sold (with none left, the listing is out of stock and its seller
   * told), and the buyer is told. The
   * record of who bought what that reviews read.
   */
  private async complete(order: OrderRow, by: 'seller' | 'buyer' | 'auto', actorId: string | null) {
    const now = new Date();
    let ranOut = false;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedBuyOrder.updateMany({
        where: { id: order.id, status: 'accepted', ...(by === 'auto' ? { boughtAt: { lte: new Date(now.getTime() - autoCompleteMs) } } : {}) },
        data: { status: 'completed', completedAt: now, completedBy: by, closedAt: now, ...(order.boughtAt ? { buyerConfirmedAt: order.boughtAt } : {}) },
      });
      if (!claimed.count) throw this.changed();
      // Its units are sold; with none left, the listing is out of stock (live 90 days, never marked sold by this).
      ranOut = (await takeStock(tx, order.listingId, order.quantity, now)).ranOut;
      // The record of who bought what: the buyer's right to review the seller.
      await recordPurchase(tx, { source: 'buy_order', buyOrderId: order.id, listingId: order.listingId, sellerId: order.sellerId, buyerId: order.buyerId, country: order.country, completedAt: now });
      await this.card(tx, order, actorId, by === 'auto' ? 'Recorded as sold: the buyer said they bought it and the seller did not answer.' : 'Marked sold. Thank you for trading on Udozo.', now);
    });
    const done = await this.reload(order.id);
    if (ranOut) await this.inbox.customer({ customerId: order.seller.id, storeId: order.seller.storeId }, 'customer.classifieds.out_of_stock', outOfStockNotice({ id: order.listingId, title: order.listing.title }, now));
    const title = order.listing.title ?? 'the listing';
    const seller = publicName(order.seller.name);
    if (by === 'seller') {
      await this.tell(done, 'buyer', 'customer.classifieds.buy_completed', `You bought “${title}” from ${seller}`, 'The sale is recorded on Udozo. If you did not buy it, say so within 7 days from your buy order.');
    } else {
      await this.tell(done, 'buyer', 'customer.classifieds.buy_completed', `Your purchase of “${title}” is recorded`, `${seller}'s sale to you is on Udozo now.`);
      if (by === 'auto') await this.tell(done, 'seller', 'customer.classifieds.buy_completed', `“${title}” was recorded as sold`, `${publicName(order.buyer.name)} said they bought it and you did not answer within 3 days.`);
    }
    const purchase = await this.prisma.classifiedPurchase.findUnique({ where: { buyOrderId: order.id }, select: { id: true, productLabel: true } });
    if (purchase) await this.reviews.invite({ id: order.buyer.id, storeId: order.buyer.storeId }, { country: order.country, sellerName: order.seller.name, productLabel: purchase.productLabel, subject: purchase.id });
    return done;
  }

  /** The buyer says they did not buy it (within 7 days of the seller marking it sold); three in 90 days pause the seller. */
  private async void(customer: CustomerWithStore, order: OrderRow, reason: string | null) {
    const until = voidUntil(order);
    if (!until || until <= new Date()) throw conflict('void_closed', 'It is more than 7 days since this was marked sold. Contact Udozo if something is wrong.');
    if (!reason) throw invalid('parameter_missing', 'Say what happened.', 'reason');
    await this.step(order, ['completed'], { status: 'voided', voidedAt: new Date(), voidReason: reason }, customer.id, `Said they did not buy it: ${reason}`, { completedBy: 'seller' });
    // No purchase, so no review of it.
    await this.prisma.classifiedPurchase.deleteMany({ where: { buyOrderId: order.id } });
    const done = await this.reload(order.id);
    await this.tell(done, 'seller', 'customer.classifieds.buy_voided', `${publicName(customer.name)} said they did not buy “${order.listing.title ?? 'your listing'}”`, 'Only mark a buy order sold once the buyer has bought it. Repeated reports pause your buy orders.');
    const voids = await this.prisma.classifiedBuyOrder.count({ where: { sellerId: order.sellerId, status: 'voided', voidedAt: { gt: new Date(Date.now() - voidWindowCountMs) } } });
    if (voids >= voidsBeforePause) {
      const pausedUntil = new Date(Date.now() + voidPauseMs);
      const why = `${voids} buyers said they did not buy in 90 days`;
      await this.prisma.classifiedSeller.upsert({ where: { customerId: order.sellerId }, create: { customerId: order.sellerId, buyOrdersPausedUntil: pausedUntil, buyOrdersPausedReason: why }, update: { buyOrdersPausedUntil: pausedUntil, buyOrdersPausedReason: why } });
      await this.audit.record({ actorId: null, action: 'classifieds.buy_orders_paused', targetType: 'customer', targetId: order.sellerId, before: null, after: { until: pausedUntil.toISOString(), reason: why } });
      await this.inbox.admins('admin.classifieds.buy_orders_paused', { subject: `${order.sellerId}:${pausedUntil.toISOString().slice(0, 10)}`, title: 'A seller’s buy orders were paused', body: `${why}. New buy orders on their listings are refused until ${dateText(pausedUntil)}.`, link: `/classifieds/sellers/${order.sellerId}` });
      await this.tellPaused(order.sellerId, pausedUntil, `${voids} buyers said they did not buy from you in 90 days.`);
    }
    return this.present(done, customer.id);
  }

  // ---- The job ----

  /**
   * Every 15 minutes: requests and counters past their time lapse; open orders on listings that left the market are
   * cancelled; accepted orders the buyer said they bought complete after 3 days; accepted orders are reminded a day
   * before their meeting deadline and end at it. Each step is claimed, so a run twice changes nothing more.
   */
  async job(now = new Date()) {
    const result = { lapsed: 0, closed: 0, completed: 0, reminded: 0, expired: 0 };
    const take = 200;
    for (const row of await this.prisma.classifiedBuyOrder.findMany({ where: { status: { in: ['requested', 'countered'] }, respondBy: { lte: now } }, include: orderInclude, take })) {
      const waitingOn: BuyOrderSide = row.status === 'requested' ? 'seller' : 'buyer';
      const claimed = await this.claim(row, [row.status as BuyOrderStatus], { status: 'lapsed', endedBy: waitingOn, closedAt: now, respondBy: null }, null, waitingOn === 'seller' ? 'The seller did not answer in time, so this buy order ended.' : 'The buyer did not answer the price in time, so this buy order ended.', now, { respondBy: { lte: now } });
      if (!claimed) continue;
      result.lapsed += 1;
      const done = await this.reload(row.id);
      const title = row.listing.title ?? 'the listing';
      await this.tell(done, 'buyer', 'customer.classifieds.buy_lapsed', waitingOn === 'seller' ? 'The seller did not answer your buy order' : 'Your buy order ended', `For “${title}”. You can ask again or chat with the seller.`);
      await this.tell(done, 'seller', 'customer.classifieds.buy_lapsed', waitingOn === 'seller' ? 'A buy order ended without your answer' : 'The buyer did not answer your price', `For “${title}”.`);
    }
    const gone = await this.prisma.classifiedBuyOrder.findMany({
      where: { OR: [{ status: { in: ['requested', 'countered'] }, listing: { status: { not: 'active' } } }, { status: 'accepted', listing: { status: { in: ['sold', 'deleted', 'removed', 'rejected'] } } }] },
      include: orderInclude,
      take,
    });
    for (const row of gone) {
      const claimed = await this.claim(row, [row.status as BuyOrderStatus], { status: 'cancelled', endedBy: 'udozo', endReason: 'listing_closed', closedAt: now, respondBy: null }, null, 'The listing is no longer for sale, so this buy order ended.', now);
      if (!claimed) continue;
      result.closed += 1;
      await this.tell(await this.reload(row.id), 'buyer', 'customer.classifieds.buy_cancelled', 'A buy order ended', `“${row.listing.title ?? 'The listing'}” is no longer for sale.`);
    }
    // Requests waiting on a listing that is out of stock end too (accepted ones hold units, so they are never here).
    const soldOut = await this.prisma.classifiedBuyOrder.findMany({ where: { status: { in: ['requested', 'countered'] }, listing: { status: 'active', stock: 0 } }, include: orderInclude, take });
    for (const row of soldOut) {
      const claimed = await this.claim(row, [row.status as BuyOrderStatus], { status: 'cancelled', endedBy: 'udozo', endReason: 'out_of_stock', closedAt: now, respondBy: null }, null, 'The listing is out of stock, so this buy order ended.', now);
      if (!claimed) continue;
      result.closed += 1;
      await this.tell(await this.reload(row.id), 'buyer', 'customer.classifieds.buy_cancelled', 'A buy order ended', `“${row.listing.title ?? 'The listing'}” is out of stock. You can ask again once the seller restocks it.`);
    }
    for (const row of await this.prisma.classifiedBuyOrder.findMany({ where: { status: 'accepted', boughtAt: { lte: new Date(now.getTime() - autoCompleteMs) } }, include: orderInclude, take })) {
      try {
        await this.complete(row, 'auto', null);
        result.completed += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    for (const row of await this.prisma.classifiedBuyOrder.findMany({ where: { status: 'accepted', boughtAt: null, meetRemindedAt: null, meetBy: { lte: new Date(now.getTime() + dayMs), gt: now } }, include: orderInclude, take })) {
      const claimed = await this.prisma.classifiedBuyOrder.updateMany({ where: { id: row.id, status: 'accepted', meetRemindedAt: null }, data: { meetRemindedAt: now } });
      if (!claimed.count) continue;
      result.reminded += 1;
      const title = row.listing.title ?? 'the listing';
      await this.tell(row, 'buyer', 'customer.classifieds.buy_meet_reminder', 'Your buy order ends tomorrow', `Meet the seller and buy “${title}” by ${dateText(row.meetBy!)}, or cancel it.`);
      await this.tell(row, 'seller', 'customer.classifieds.buy_meet_reminder', 'A buy order ends tomorrow', `Mark “${title}” sold once the buyer has bought it, or give them more time.`);
    }
    for (const row of await this.prisma.classifiedBuyOrder.findMany({ where: { status: 'accepted', boughtAt: null, meetBy: { lte: now } }, include: orderInclude, take })) {
      const claimed = await this.claim(row, ['accepted'], { status: 'expired', endedBy: 'udozo', closedAt: now }, null, 'Not completed in time, so this buy order ended and the item is no longer held.', now, { boughtAt: null, meetBy: { lte: now } });
      if (!claimed) continue;
      result.expired += 1;
      const done = await this.reload(row.id);
      const title = row.listing.title ?? 'the listing';
      await this.tell(done, 'buyer', 'customer.classifieds.buy_lapsed', 'Your buy order ended', `“${title}” was not marked sold in time, so it is no longer held for you.`);
      await this.tell(done, 'seller', 'customer.classifieds.buy_lapsed', 'A buy order ended', `“${title}” was not marked sold in time, so it is no longer held.`);
    }
    return result;
  }

  /** Buy orders that ended two years ago are deleted (the privacy notice's retention). */
  async purgeOld(now = new Date()) {
    const { count } = await this.prisma.classifiedBuyOrder.deleteMany({ where: { status: { notIn: openBuyOrderStatuses }, closedAt: { lt: new Date(now.getTime() - keepBuyOrdersMs) } } });
    return count;
  }

  // ---- Admins ----

  async adminList(filter: { status?: string; country?: string; seller?: string; buyer?: string; limit?: number; offset?: number }) {
    const where: Prisma.ClassifiedBuyOrderWhereInput = {
      ...(filter.status === 'open' ? { status: { in: openBuyOrderStatuses } } : filter.status ? { status: filter.status } : {}),
      ...(filter.country ? { country: filter.country } : {}),
      ...(filter.seller ? { sellerId: filter.seller } : {}),
      ...(filter.buyer ? { buyerId: filter.buyer } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedBuyOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.min(filter.limit ?? 50, 100), skip: filter.offset ?? 0 }),
      this.prisma.classifiedBuyOrder.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.presentAdmin(row)), total };
  }

  async adminGet(id: string) {
    const row = await this.prisma.classifiedBuyOrder.findUnique({ where: { id }, include: orderInclude });
    if (!row) throw notFound();
    // Udozo's own cards for this order's steps, never the chat's other messages.
    const steps = await this.prisma.classifiedMessage.findMany({ where: { buyOrderId: id, kind: 'buy_order' }, orderBy: { seq: 'asc' }, take: 100 });
    return {
      ...this.presentAdmin(row),
      steps: steps.map(step => ({ by: step.senderId === null ? 'udozo' : step.senderId === row.buyerId ? 'buyer' : 'seller', text: step.body, at: step.createdAt.toISOString() })),
    };
  }

  /** Pauses or unpauses new buy orders on a seller's listings (operations; audited). */
  async pause(actorId: string | null, sellerId: string, paused: boolean, reason: string, days = 30) {
    const before = await this.prisma.classifiedSeller.findUnique({ where: { customerId: sellerId }, select: { buyOrdersPausedUntil: true, buyOrdersPausedReason: true } });
    const until = paused ? new Date(Date.now() + days * dayMs) : null;
    const data = { buyOrdersPausedUntil: until, buyOrdersPausedReason: paused ? reason : null };
    await this.prisma.classifiedSeller.upsert({ where: { customerId: sellerId }, create: { customerId: sellerId, ...data }, update: data });
    await this.audit.record({
      actorId,
      action: paused ? 'classifieds.buy_orders_paused' : 'classifieds.buy_orders_unpaused',
      targetType: 'customer',
      targetId: sellerId,
      before: { until: before?.buyOrdersPausedUntil?.toISOString() ?? null, reason: before?.buyOrdersPausedReason ?? null },
      after: { until: until?.toISOString() ?? null, reason },
    });
    await this.tellPaused(sellerId, until, reason);
    return { paused_until: until?.toISOString() ?? null, reason: paused ? reason : null };
  }

  /** Tells the seller their buy orders were paused (until a date, with why) or can be taken again. */
  private async tellPaused(sellerId: string, until: Date | null, why: string) {
    const seller = await this.prisma.customer.findUnique({ where: { id: sellerId }, select: { id: true, storeId: true } });
    if (!seller) return;
    await this.inbox.customer({ customerId: seller.id, storeId: seller.storeId }, 'customer.classifieds.buy_orders_paused', until
      ? { subject: `paused:${until.toISOString()}`, title: 'Buy orders on your listings are paused', body: `Buyers cannot send you buy orders until ${dateText(until)}. ${why} They can still chat with you.`, link: '/account/buy-orders' }
      : { subject: `unpaused:${Date.now()}`, title: 'You can take buy orders again', body: 'Buyers can send you buy orders on your listings again.', link: '/account/buy-orders' });
  }

  presentAdmin(row: OrderRow) {
    return {
      object: 'classified_admin_buy_order' as const,
      id: row.id,
      number: buyOrderNumber(row.number),
      status: row.status as BuyOrderStatus,
      country: row.country,
      currency: row.currency,
      price: Number(row.priceMinor),
      counter: row.counterMinor === null ? null : Number(row.counterMinor),
      quantity: row.quantity,
      note: row.note,
      meet_note: row.meetNote,
      listing: { id: row.listing.id, ref: Number(row.listing.ref), title: row.listing.title, path: listingPath(row.listing), status: row.listing.status },
      buyer: { id: row.buyer.id, name: row.buyer.name, email: row.buyer.email },
      seller: { id: row.seller.id, name: row.seller.name, email: row.seller.email },
      respond_by: row.respondBy?.toISOString() ?? null,
      meet_by: row.meetBy?.toISOString() ?? null,
      accepted_at: row.acceptedAt?.toISOString() ?? null,
      bought_at: row.boughtAt?.toISOString() ?? null,
      completed_at: row.completedAt?.toISOString() ?? null,
      completed_by: row.completedBy,
      voided_at: row.voidedAt?.toISOString() ?? null,
      void_reason: row.voidReason,
      ended_by: row.endedBy,
      end_reason: row.endReason,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  // ---- Helpers ----

  /** The order as one side reads it: the other person by their public name only. */
  present(row: OrderRow, viewerId: string) {
    const side = sideOf(row, viewerId)!;
    const until = voidUntil(row);
    return {
      ...summary(row, viewerId)!,
      listing: {
        id: row.listing.id,
        ref: Number(row.listing.ref),
        title: row.listing.title,
        path: listingPath(row.listing),
        status: row.listing.status,
        cover_url: row.listing.media[0] ? this.watermarks.url(row.listing.media[0], 480) : null,
        price: { kind: row.listing.priceKind, amount: row.listing.priceMinor === null ? null : Number(row.listing.priceMinor), currency: row.listing.currency },
      },
      with: { name: publicName(side === 'buyer' ? row.seller.name : row.buyer.name) },
      note: row.note,
      meet_note: row.meetNote,
      conversation_id: row.conversationId,
      respond_by: row.respondBy?.toISOString() ?? null,
      meet_by: row.meetBy?.toISOString() ?? null,
      meet_extended: row.meetExtended,
      accepted_at: row.acceptedAt?.toISOString() ?? null,
      bought_at: row.boughtAt?.toISOString() ?? null,
      completes_at: row.status === 'accepted' && row.boughtAt ? new Date(row.boughtAt.getTime() + autoCompleteMs).toISOString() : null,
      completed_at: row.completedAt?.toISOString() ?? null,
      completed_by: (row.completedBy as 'seller' | 'buyer' | 'auto' | null) ?? null,
      void_until: until && until > new Date() ? until.toISOString() : null,
      ended_by: (row.endedBy as 'buyer' | 'seller' | 'udozo' | null) ?? null,
      end_reason: row.endReason,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private checkPrice(value: number | undefined) {
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0 || value > Number(maxPriceMinor)) throw invalid('parameter_invalid', 'Give a price above zero.', 'price');
    return BigInt(value);
  }

  private async requireNotPaused(sellerId: string) {
    const seller = await this.prisma.classifiedSeller.findUnique({ where: { customerId: sellerId }, select: { buyOrdersPausedUntil: true, suspendedAt: true } });
    if (seller?.suspendedAt) throw notFound('listing');
    if (seller?.buyOrdersPausedUntil && seller.buyOrdersPausedUntil > new Date()) throw conflict('buy_orders_paused', 'This seller is not taking buy orders just now. Chat with them instead.');
  }

  private async requireDifferentPeople(buyerId: string, sellerId: string) {
    const reason = await this.guards.samePerson(buyerId, sellerId);
    if (!reason) return;
    const [first, second] = [buyerId, sellerId].sort();
    await this.inbox.admins('admin.classifieds.same_person', { subject: `buy:${first}:${second}`, title: 'Buy order refused: one person on both sides', body: `A buyer and seller on Udozo matched by ${reason.replace(/_/g, ' ')}. Their buy order was refused; check both accounts.`, link: `/customers/${buyerId}` });
    throw forbidden('same_person', 'A buy order is between two different people, so it cannot be used here.');
  }

  /** The listing's chat with this buyer, made (with Udozo's safety note) where the seller takes chats; else none. */
  private async chatFor(tx: Prisma.TransactionClient, listing: { id: string; customerId: string; country: string; contact: string }, buyerId: string, now: Date) {
    const existing = await tx.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId: listing.id, buyerId } }, select: { id: true } });
    if (existing) return existing.id;
    if (listing.contact === 'phone') return null;
    const chat = await tx.classifiedConversation.create({ data: { listingId: listing.id, buyerId, sellerId: listing.customerId, country: listing.country, lastMessageAt: now, buyerReadAt: now } });
    await tx.classifiedMessage.create({ data: { conversationId: chat.id, kind: 'system', body: safetyNote, createdAt: now } });
    await addLead(tx, listing.id, buyerId, 'chat');
    return chat.id;
  }

  /** A step's card in the chat, from whoever took it (null: Udozo), keeping the chat's order. */
  private async card(tx: Prisma.TransactionClient, order: { id: string; conversationId: string | null }, senderId: string | null, body: string, now: Date) {
    if (!order.conversationId) return;
    await tx.classifiedMessage.create({ data: { conversationId: order.conversationId, senderId, kind: 'buy_order', buyOrderId: order.id, body, createdAt: new Date(now.getTime() + 1) } });
    await tx.classifiedConversation.update({ where: { id: order.conversationId }, data: { lastMessageAt: now } });
  }

  /** Claims a step from one of `from` (plus any extra condition) and writes its card; false when another got there first. */
  private async claim(order: OrderRow, from: BuyOrderStatus[], data: Prisma.ClassifiedBuyOrderUpdateManyMutationInput, actorId: string | null, card: string, now = new Date(), extra: Prisma.ClassifiedBuyOrderWhereInput = {}) {
    return this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedBuyOrder.updateMany({ where: { id: order.id, status: { in: from }, ...extra }, data });
      if (!claimed.count) return false;
      await this.card(tx, order, actorId, card, now);
      return true;
    });
  }

  private async step(order: OrderRow, from: BuyOrderStatus[], data: Prisma.ClassifiedBuyOrderUpdateManyMutationInput, actorId: string, card: string, extra: Prisma.ClassifiedBuyOrderWhereInput = {}) {
    if (!(await this.claim(order, from, data, actorId, card, new Date(), extra))) throw this.changed();
  }

  private changed() {
    return conflict('buy_order_changed', 'This buy order changed: refresh and try again.');
  }

  private refusal(order: OrderRow, side: BuyOrderSide, action: BuyOrderAction) {
    if (!openBuyOrderStatuses.includes(order.status as BuyOrderStatus) && !((action === 'void' || action === 'confirm') && order.status === 'completed')) return conflict('buy_order_closed', 'This buy order has ended.');
    const theirs: Record<BuyOrderAction, BuyOrderSide | 'either'> = { accept: 'seller', counter: 'seller', decline: 'seller', complete: 'seller', extend: 'seller', accept_counter: 'buyer', bought: 'buyer', void: 'buyer', confirm: 'buyer', cancel: 'either', no_show: 'either' };
    const owner = theirs[action];
    if (owner !== 'either' && owner !== side) return forbidden('buy_order_not_yours', owner === 'seller' ? 'Only the seller can do this.' : 'Only the buyer can do this.');
    if (action === 'confirm' && order.buyerConfirmedAt) return conflict('buy_order_confirmed', 'You already said you bought it.');
    if (action === 'void' || action === 'confirm') return conflict('void_closed', 'You can only say you did not buy it within 7 days of the seller marking it sold.');
    return conflict('buy_order_not_pending', `This buy order is ${order.status.replace('_', ' ')}, so that cannot be done now.`);
  }

  private async party(customerId: string, id: string) {
    const row = await this.prisma.classifiedBuyOrder.findUnique({ where: { id }, include: orderInclude });
    if (!row || !sideOf(row, customerId)) throw notFound();
    return row;
  }

  private reload(id: string) {
    return this.prisma.classifiedBuyOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
  }

  /** Tells one side in the app (and by email for a new request or an acceptance), linking to the order. */
  private async tell(order: OrderRow, to: BuyOrderSide, type: NoticeType, title: string, body: string, email = false) {
    const recipient = to === 'buyer' ? order.buyer : order.seller;
    const path = `/account/buy-orders/${order.id}`;
    await this.inbox.customer({ customerId: recipient.id, storeId: recipient.storeId }, type, { subject: `${order.id}:${type}:${Date.now()}`, title, body, link: path });
    if (email) this.emails.customer(recipient.id, { title, body, path, action: 'Open the buy order' });
  }
}

const dateText = (date: Date) => date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' });
