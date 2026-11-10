import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { SettingsService } from '../settings/settings.service.js';
import { ConnectAuctionsService, nextBid } from './connect-auctions.service.js';
import { ListingsService } from './listings.service.js';
import { ModerationService } from './moderation.service.js';
import { SafePayService } from './safe-pay.service.js';

const dayMs = 86_400_000;
const hourMs = 3_600_000;
/** How long an auction listing runs, in days. */
export const auctionLengths = [1, 3, 5, 7, 10] as const;
const openStatuses = ['scheduled', 'live', 'awaiting_payment'];
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');

const lotInclude = {
  bids: { orderBy: [{ amountMinor: 'desc' as const }, { createdAt: 'asc' as const }], include: { bidder: { select: { id: true, name: true, firstName: true, lastName: true } } } },
  listing: { select: { id: true, ref: true, slug: true, title: true, country: true, customerId: true, customer: { select: { id: true, storeId: true } } } },
} satisfies Prisma.ConnectAuctionInclude;
type LotRow = Prisma.ConnectAuctionGetPayload<{ include: typeof lotInclude }>;
type Bid = LotRow['bids'][number];

/** A bidder as everyone sees them: first name and initial, never their account. */
const publicName = (bidder: { firstName: string | null; lastName: string | null; name: string }) => (bidder.firstName ? `${bidder.firstName}${bidder.lastName ? ` ${bidder.lastName[0]}.` : ''}` : bidder.name.split(' ')[0]);
/** Where the listing's page is, for notices. */
const pagePath = (listing: { country: string; ref: number | bigint }) => `/${listing.country.toLowerCase()}/l/${listing.ref}`;

/**
 * Selling by auction (docs/UDOZO_AUCTIONS_PLAN.md): a seller's listing with `sale_method: auction` (one item, a starting
 * price, an optional hidden reserve, 1 to 10 days) gets its lot (`connect_auctions`, kind `listing`) as it goes live.
 * Signed-in accounts with a confirmed mobile bid on its page in the market's steps, a late bid extending the end. At the
 * end the highest bid at or above the reserve is offered the item: the winner asks for it with UdozoPay (`SafePayService
 * .request`, already accepted, at their bid, within the market's time to pay); unpaid, it goes to the next bidder at or
 * above the reserve; with none, the lot is unsold and the listing expires (`auction_unsold`), renewing it starting anew.
 */
@Injectable()
export class ListingAuctionsService implements OnModuleInit {
  private readonly logger = new Logger(ListingAuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
    private readonly lots: ConnectAuctionsService,
    private readonly listings: ListingsService,
    private readonly moderation: ModerationService,
    private readonly safePay: SafePayService,
  ) {}

  onModuleInit() {
    this.listings.useAuctions({ beforeSubmit: (customer, listing) => this.beforeSubmit(customer, listing), live: id => this.start(id), running: id => this.running(id) });
    this.moderation.useAuctions({ live: id => this.start(id) });
    this.safePay.useAuctions({ winner: (customer, listingId) => this.winnerOf(customer, listingId), paid: (tx, orderId) => this.paid(tx, orderId) });
  }

  /** Whether sellers may post auctions in a market (`classifieds_auctions`). */
  open(country: string) {
    return this.settings.isOnForCountry('classifieds_auctions', country).catch(() => false);
  }

  /** Before an auction listing is submitted: auctions open in the market, and the seller ready to be paid with UdozoPay. */
  private async beforeSubmit(customer: CustomerWithStore, listing: { saleMethod: string; country: string }) {
    if (listing.saleMethod !== 'auction') return;
    if (!(await this.open(listing.country))) throw conflict('auctions_unavailable', 'Auctions are not open in this country yet: sell it at a fixed price.', 'sale_method');
    const ready = await this.safePay.readiness(customer);
    if (!ready.ready) throw conflict('seller_not_ready', 'The winner pays you with UdozoPay: add your payout account (and pass the identity check where asked) to sell by auction.', 'safe_pay');
  }

  /** The lot a listing is running, if any (a sold one too, until the listing is sold). */
  private running(listingId: string) {
    return this.prisma.connectAuction.findFirst({ where: { listingId, status: { in: openStatuses } }, include: { bids: { select: { id: true } } } });
  }

  /** A live auction listing without a running lot gets one, opening now. Safe to call twice (one open lot per listing). */
  async start(listingId: string, now = new Date()) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'active' || listing.saleMethod !== 'auction' || !listing.auctionDays || listing.priceMinor === null) return null;
    if (await this.prisma.connectAuction.findFirst({ where: { listingId, status: { in: [...openStatuses, 'sold'] } }, select: { id: true } })) return null;
    try {
      return await this.prisma.connectAuction.create({
        data: {
          kind: 'listing',
          listingId,
          sellerId: listing.customerId,
          country: listing.country,
          currency: listing.currency,
          title: listing.title ?? 'A listing',
          description: '',
          startPriceMinor: listing.priceMinor,
          reserveMinor: listing.auctionReserveMinor,
          owedMinor: 0n,
          startsAt: now,
          endsAt: new Date(now.getTime() + listing.auctionDays * dayMs),
          status: 'live',
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    }
  }

  /** The listing's latest lot, as everyone sees it on its page and cards. */
  private async latest(listingId: string) {
    return this.prisma.connectAuction.findFirst({ where: { listingId, kind: 'listing' }, orderBy: { createdAt: 'desc' }, include: lotInclude });
  }

  private top(row: LotRow): Bid | null {
    return row.bids.find(bid => bid.status === 'active' || bid.status === 'offered' || bid.status === 'won') ?? null;
  }

  /** A listing's auction as its page shows it; a signed-in viewer also sees their own bid and whether it is theirs to pay. */
  async view(listingId: string, viewer?: string | null) {
    const row = await this.latest(listingId);
    if (!row) return null;
    const rules = await this.lots.rules(row.country);
    const top = this.top(row);
    const mine = viewer ? row.bids.find(bid => bid.bidderId === viewer) : undefined;
    const offered = row.offeredBidId ? row.bids.find(bid => bid.id === row.offeredBidId) : undefined;
    return {
      object: 'listing_auction' as const,
      number: `AU-${String(row.number).padStart(6, '0')}`,
      status: row.status as 'live' | 'awaiting_payment' | 'sold' | 'unsold' | 'cancelled',
      start_price: Number(row.startPriceMinor),
      current_price: top ? Number(top.amountMinor) : null,
      next_bid: row.status === 'live' ? Number(nextBid(row.startPriceMinor, top?.amountMinor ?? null, rules)) : null,
      bids: row.bids.length,
      /** Whether a hidden reserve is met: null when the seller set none. */
      reserve_met: row.reserveMinor === null ? null : Boolean(top && top.amountMinor >= row.reserveMinor),
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt.toISOString(),
      rules: { step_pct: rules.stepBps / 100, step_min: Number(rules.stepMin), extend_minutes: rules.extendMinutes, pay_hours: rules.payHours },
      recent_bids: row.bids.slice(0, 10).map(bid => ({ name: publicName(bid.bidder), amount: Number(bid.amountMinor), at: bid.createdAt.toISOString() })),
      ...(viewer
        ? {
            viewer: {
              highest: mine ? Number(mine.amountMinor) : null,
              leading: Boolean(top && top.bidderId === viewer && row.status === 'live'),
              to_pay: offered?.bidderId === viewer && row.status === 'awaiting_payment' ? { amount: Number(offered.amountMinor), pay_by: row.payBy?.toISOString() ?? null, order_id: row.saleOrderId } : null,
              won: row.status === 'sold' && row.buyerId === viewer,
              seller: row.sellerId === viewer,
            },
          }
        : {}),
    };
  }

  /** What cards show of each auction listing: the price to beat and when it ends. */
  async cards(listingIds: string[]) {
    if (!listingIds.length) return new Map<string, { current_price: number | null; bids: number; ends_at: string; status: string }>();
    const rows = await this.prisma.connectAuction.findMany({ where: { listingId: { in: listingIds }, kind: 'listing' }, orderBy: { createdAt: 'desc' }, include: { bids: { select: { amountMinor: true, status: true } } } });
    const out = new Map<string, { current_price: number | null; bids: number; ends_at: string; status: string }>();
    for (const row of rows) {
      if (!row.listingId || out.has(row.listingId)) continue;
      const top = row.bids.filter(bid => bid.status !== 'lapsed').reduce<bigint | null>((max, bid) => (max === null || bid.amountMinor > max ? bid.amountMinor : max), null);
      out.set(row.listingId, { current_price: top === null ? null : Number(top), bids: row.bids.length, ends_at: row.endsAt.toISOString(), status: row.status });
    }
    return out;
  }

  /** A bid on a listing's running lot: a confirmed mobile, never the seller, at least the next step. */
  async bid(customer: CustomerWithStore, listingId: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid('parameter_invalid', 'Give your bid in minor units.', 'amount');
    const lot = await this.prisma.connectAuction.findFirst({ where: { listingId, kind: 'listing', status: { in: openStatuses } }, include: lotInclude });
    if (!lot) throw conflict('auction_not_live', 'Bidding on this listing has ended.');
    if (!customer.phoneVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'phone_required', 'Confirm your mobile number to bid.');
    if (lot.sellerId === customer.id) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'own_item', 'You cannot bid on your own listing.');
    const rules = await this.lots.rules(lot.country);
    const now = new Date();
    const previous = this.top(lot);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM connect_auctions WHERE id = ${lot.id}::uuid FOR UPDATE`;
      const fresh = await tx.connectAuction.findUniqueOrThrow({ where: { id: lot.id } });
      if (fresh.status !== 'live' || fresh.endsAt <= now) throw conflict('auction_not_live', 'Bidding on this listing has ended.');
      const top = await tx.connectAuctionBid.findFirst({ where: { auctionId: lot.id }, orderBy: { amountMinor: 'desc' } });
      const least = nextBid(fresh.startPriceMinor, top?.amountMinor ?? null, rules);
      if (BigInt(amount) < least) throw invalid('bid_too_low', `Bid at least ${formatMoney(least, fresh.currency)}.`, 'amount');
      await tx.connectAuctionBid.create({ data: { auctionId: lot.id, bidderId: customer.id, amountMinor: BigInt(amount) } });
      const window = rules.extendMinutes * 60_000;
      if (window && fresh.endsAt.getTime() - now.getTime() < window) await tx.connectAuction.update({ where: { id: lot.id }, data: { endsAt: new Date(now.getTime() + window) } });
    });
    if (previous && previous.bidderId !== customer.id && lot.listing) {
      await this.tell(previous.bidderId, `auction_outbid:${lot.id}:${amount}`, `You were outbid on "${lot.title}"`, `The bid is now ${formatMoney(BigInt(amount), lot.currency)}.`, pagePath(lot.listing));
    }
    if (!previous && lot.listing) await this.tell(lot.listing.customerId, `auction_first_bid:${lot.id}`, `"${lot.title}" has its first bid`, `${formatMoney(BigInt(amount), lot.currency)}. Its price and length are now fixed.`, pagePath(lot.listing));
    return this.view(listingId, customer.id);
  }

  /** For UdozoPay: the bid a buyer won and may now ask for (the price, and the lot to link the order to). */
  private async winnerOf(customer: CustomerWithStore, listingId: string) {
    const lot = await this.prisma.connectAuction.findFirst({ where: { listingId, kind: 'listing', status: 'awaiting_payment' }, include: { bids: true } });
    const offered = lot?.bids.find(bid => bid.id === lot.offeredBidId);
    if (!lot || !offered || offered.bidderId !== customer.id || !lot.payBy || lot.payBy <= new Date()) {
      throw conflict('auction_not_won', 'This listing is sold by auction: bid on it, and pay with UdozoPay if your bid wins.', 'listing_id');
    }
    return { lotId: lot.id, price: offered.amountMinor, payBy: lot.payBy };
  }

  /** Inside UdozoPay's payment: the lot behind the order is sold, and its bid won. */
  private async paid(tx: Prisma.TransactionClient, orderId: string) {
    const lot = await tx.connectAuction.findFirst({ where: { saleOrderId: orderId, status: 'awaiting_payment' } });
    if (!lot) return;
    const order = await tx.classifiedOrder.findUniqueOrThrow({ where: { id: orderId }, select: { buyerId: true, priceMinor: true } });
    await tx.connectAuction.update({ where: { id: lot.id }, data: { status: 'sold', buyerId: order.buyerId, saleMinor: order.priceMinor, paidAt: new Date() } });
    if (lot.offeredBidId) await tx.connectAuctionBid.update({ where: { id: lot.offeredBidId }, data: { status: 'won' } });
  }

  // ---- The job ----

  /** Lots for live auction listings, ended lots offered, unpaid offers passed to the next bidder, and unsold listings expired. */
  async runDue(now = new Date()) {
    const result = { started: 0, ended: 0, offered: 0, lapsed: 0, unsold: 0 };
    // A listing that went live without its lot (its hook missed) gets one now.
    const waiting = await this.prisma.classifiedListing.findMany({ where: { status: 'active', saleMethod: 'auction', auctions: { none: { status: { in: [...openStatuses, 'sold'] } } } }, select: { id: true }, take: 200 });
    for (const row of waiting) if (await this.start(row.id, now)) result.started += 1;
    const ended = await this.prisma.connectAuction.findMany({ where: { kind: 'listing', status: 'live', endsAt: { lte: now } }, take: 200, include: lotInclude });
    for (const lot of ended) {
      result.ended += 1;
      if (await this.offerNext(lot, now)) result.offered += 1;
      else result.unsold += 1;
    }
    const lapsed = await this.prisma.connectAuction.findMany({ where: { kind: 'listing', status: 'awaiting_payment', payBy: { lt: now } }, take: 200, include: lotInclude });
    for (const lot of lapsed) {
      const offered = lot.bids.find(bid => bid.id === lot.offeredBidId);
      // An order still waiting for the payment ends with the offer.
      if (lot.saleOrderId) await this.prisma.classifiedOrder.updateMany({ where: { id: lot.saleOrderId, status: 'awaiting_payment' }, data: { status: 'lapsed', closedAt: now, endedBy: 'buyer', endReason: 'not_paid_in_time' } });
      if (offered) {
        await this.prisma.connectAuctionBid.updateMany({ where: { id: offered.id, status: 'offered' }, data: { status: 'lapsed' } });
        if (lot.listing) await this.tell(offered.bidderId, `auction_lapsed:${lot.id}:${offered.id}`, `Your time to pay for "${lot.title}" ran out`, 'It is offered to the next bidder.', pagePath(lot.listing));
      }
      result.lapsed += 1;
      const fresh = await this.prisma.connectAuction.findUniqueOrThrow({ where: { id: lot.id }, include: lotInclude });
      if (await this.offerNext(fresh, now, offered?.bidderId)) result.offered += 1;
      else result.unsold += 1;
    }
    if (result.started || result.ended || result.lapsed) this.logger.log(result, 'Listing auctions');
    return result;
  }

  /** Offers a lot to its highest bidder at or above the reserve still in the running, else ends it unsold. */
  private async offerNext(lot: LotRow, now: Date, skip?: string) {
    const lapsedBidders = new Set(lot.bids.filter(bid => bid.status === 'lapsed').map(bid => bid.bidderId));
    if (skip) lapsedBidders.add(skip);
    const next = lot.bids.find(bid => bid.status === 'active' && !lapsedBidders.has(bid.bidderId) && (lot.reserveMinor === null || bid.amountMinor >= lot.reserveMinor));
    const from = lot.status;
    if (!next) {
      const done = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, status: from, offeredBidId: lot.offeredBidId }, data: { status: 'unsold', offeredBidId: null, payBy: null } });
      if (!done.count || !lot.listingId) return false;
      // Unsold: the listing leaves the market until its seller renews it, which starts a new lot.
      await this.prisma.classifiedListing.updateMany({ where: { id: lot.listingId, status: 'active' }, data: { status: 'expired', expiredReason: 'auction_unsold' } });
      if (lot.listing) {
        const why = lot.bids.length ? (lot.reserveMinor !== null && !lot.bids.some(bid => bid.amountMinor >= lot.reserveMinor!) ? 'No bid reached your reserve.' : 'No bidder paid.') : 'Nobody bid.';
        await this.tell(lot.listing.customerId, `auction_unsold:${lot.id}`, `"${lot.title}" did not sell at auction`, `${why} Renew it from My listings to auction it again, or sell it at a fixed price.`, `/account/listings/${lot.listing.id}`);
      }
      return false;
    }
    const rules = await this.lots.rules(lot.country);
    const payBy = new Date(now.getTime() + rules.payHours * hourMs);
    const done = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, status: from, offeredBidId: lot.offeredBidId }, data: { status: 'awaiting_payment', offeredBidId: next.id, payBy, saleOrderId: null } });
    if (!done.count) return false;
    await this.prisma.connectAuctionBid.update({ where: { id: next.id }, data: { status: 'offered' } });
    if (lot.listing) {
      const path = `${pagePath(lot.listing)}/buy`;
      await this.tell(next.bidderId, `auction_won:${lot.id}:${next.id}`, `You won "${lot.title}"`, `Pay ${formatMoney(next.amountMinor, lot.currency)} with UdozoPay within ${rules.payHours} hours, or it goes to the next bidder.`, path);
      await this.tell(lot.listing.customerId, `auction_ended:${lot.id}:${next.id}`, `"${lot.title}" sold at auction for ${formatMoney(next.amountMinor, lot.currency)}`, `The winner has ${rules.payHours} hours to pay with UdozoPay. We will tell you once they have.`, `/account/listings/${lot.listing.id}`);
    }
    return true;
  }

  private async tell(customerId: string, subject: string, title: string, body: string, link: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, storeId: true } });
    if (customer) await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.classifieds.auction', { subject, title, body, link }).catch(() => undefined);
  }

  /** For presenters needing a listing's lot without a viewer. */
  async forListing(listingId: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { saleMethod: true } });
    if (!listing) throw notFound();
    return listing.saleMethod === 'auction' ? this.view(listingId) : null;
  }
}
