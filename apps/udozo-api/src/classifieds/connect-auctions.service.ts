import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerService, type Line } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { WatermarkService } from '../watermarks/watermarks.service.js';
import { houseStoreId } from '../checkout/house-ids.js';
import { ConnectChargesService } from './connect-charges.service.js';
import { ListingsService } from './listings.service.js';
import { slugify } from './rules.js';
import { SafePayService } from './safe-pay.service.js';

const dayMs = 86_400_000;
const hourMs = 3_600_000;
/** A lot opens for bids at least a day after it is listed, so its seller is told first. */
export const auctionNoticeMs = dayMs;
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such auction.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const lotNumber = (number: number) => `AU-${String(number).padStart(6, '0')}`;
const minor = (value: bigint | null | undefined) => (value === null || value === undefined ? null : Number(value));
const openStatuses = ['scheduled', 'live', 'awaiting_payment'];

type Rules = { stepBps: number; stepMin: bigint; extendMinutes: number; payHours: number; auctionAfterDays: number; claimDays: number };

/** The least the next bid may be: the start price, else the top bid plus the larger of its share step and the market's least step. */
export function nextBid(start: bigint, top: bigint | null, rules: Pick<Rules, 'stepBps' | 'stepMin'>) {
  if (top === null) return start;
  const share = (top * BigInt(rules.stepBps) + 9999n) / 10000n;
  return top + (share > rules.stepMin ? share : rules.stepMin);
}

const lotInclude = {
  warehouse: { select: { id: true, name: true, address: true, hours: true, phone: true, state: { select: { name: true } } } },
  bids: { orderBy: [{ amountMinor: 'desc' as const }, { createdAt: 'asc' as const }], include: { bidder: { select: { id: true, name: true, firstName: true, lastName: true, email: true } } } },
  order: { select: { id: true, number: true, sellerId: true, connectReturn: { select: { id: true, lossOfCareAt: true } } } },
  listing: { select: { id: true, ref: true, slug: true } },
} satisfies Prisma.ConnectAuctionInclude;
type LotRow = Prisma.ConnectAuctionGetPayload<{ include: typeof lotInclude }>;

/** A bidder as everyone sees them: first name and initial, never their account. */
const publicName = (bidder: { firstName: string | null; lastName: string | null; name: string }) => (bidder.firstName ? `${bidder.firstName}${bidder.lastName ? ` ${bidder.lastName[0]}.` : ''}` : bidder.name.split(' ')[0]);

/**
 * Udozo auctions (docs/UDOZO_CONNECT_PLAN.md, phase 7b): abandoned items at Udozo's warehouses, the market's
 * `auction_after_days` into Loss of care, sold by Udozo itself on udozo.com to cover the storage owed. Operations list a
 * lot (`AU-000123`) at a starting price of at least what is owed (no reserve), opening at least a day later so its
 * seller is told first and can still collect it until the first bid. Signed-in Udozo accounts with a confirmed mobile
 * bid in steps (each at least the market's `auction_step_bps`, 5%, and `auction_step_min_minor`, ₦500, above the last);
 * a bid in the last `auction_extend_minutes` (5) pushes the end to that long after it. When it ends the top bidder is
 * offered it for `auction_pay_hours` (48), then the next bidder, else it is unsold. Paying (from the Udozo wallet) pays
 * the seller's storage owed (shared as storage always is), then Udozo's costs, and holds what is left over for the
 * seller's claim (`connect_auction_held`, 7c); the buyer collects it at the warehouse with a collection code.
 */
@Injectable()
export class ConnectAuctionsService {
  private readonly logger = new Logger(ConnectAuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly charges: ConnectChargesService,
    private readonly safePay: SafePayService,
    private readonly watermarks: WatermarkService,
    private readonly listings: ListingsService,
  ) {}

  /**
   * Udozo's own seller account in a market, which sells abandoned items at auction (made the first time; it never signs
   * in: no password, and its address is Udozo's own).
   */
  async udozoSeller(country: string) {
    const email = `auctions-${country.toLowerCase()}@udozo.com`;
    const found = await this.prisma.customer.findFirst({ where: { storeId: houseStoreId, email } });
    if (found) return found;
    try {
      return await this.prisma.customer.create({ data: { storeId: houseStoreId, email, name: 'Udozo Auctions', firstName: 'Udozo', lastName: 'Auctions', nameConfirmedAt: new Date(), country, emailVerifiedAt: new Date() } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return this.prisma.customer.findFirstOrThrow({ where: { storeId: houseStoreId, email } });
      throw error;
    }
  }

  /** The listing behind a lot leaves the market: sold, not sold (until relisted) or withdrawn. */
  private async closeListing(listingId: string | null, how: 'sold' | 'unsold' | 'withdrawn') {
    if (!listingId) return;
    const now = new Date();
    const data = how === 'sold' ? { status: 'sold', soldAt: now } : how === 'unsold' ? { status: 'expired', expiredReason: 'auction_unsold' } : { status: 'deleted', closedAt: now };
    await this.prisma.classifiedListing.updateMany({ where: { id: listingId, status: 'active' }, data });
  }

  async rules(country: string): Promise<Rules> {
    const row = await this.prisma.connectSettings.findUnique({ where: { country } });
    return {
      stepBps: row?.auctionStepBps ?? 500,
      stepMin: row?.auctionStepMinMinor ?? 50000n,
      extendMinutes: row?.auctionExtendMinutes ?? 5,
      payHours: row?.auctionPayHours ?? 48,
      auctionAfterDays: row?.auctionAfterDays ?? 90,
      claimDays: row?.claimDays ?? 90,
    };
  }

  private top(row: LotRow) {
    return row.bids.find(bid => bid.status === 'active' || bid.status === 'offered' || bid.status === 'won') ?? null;
  }

  private async load(id: string) {
    const row = await this.prisma.connectAuction.findUnique({ where: { id, kind: 'abandoned' }, include: lotInclude });
    if (!row) throw notFound();
    return row;
  }

  private async byNumber(ref: string) {
    const number = Number(ref.replace(/^AU-?/i, ''));
    if (!Number.isSafeInteger(number) || number <= 0) throw notFound();
    const row = await this.prisma.connectAuction.findFirst({ where: { number, kind: 'abandoned' }, include: lotInclude });
    if (!row || row.status === 'cancelled') throw notFound();
    return row;
  }

  /** A lot as anyone sees it; a signed-in viewer also sees their own bid and whether it is theirs to pay. */
  async present(row: LotRow, viewer?: string) {
    const rules = await this.rules(row.country);
    const top = this.top(row);
    const mine = viewer ? row.bids.find(bid => bid.bidderId === viewer) : undefined;
    const offered = row.offeredBidId ? row.bids.find(bid => bid.id === row.offeredBidId) : undefined;
    return {
      object: 'connect_auction' as const,
      id: row.id,
      number: lotNumber(row.number),
      ref: String(row.number),
      status: row.status as 'scheduled' | 'live' | 'awaiting_payment' | 'sold' | 'unsold' | 'cancelled',
      country: row.country,
      currency: row.currency,
      title: row.title,
      description: row.description,
      photos: row.photos,
      /** The auction listing it is sold through on udozo.com (its page is where people bid). */
      listing: row.listing ? { ref: Number(row.listing.ref), slug: row.listing.slug } : null,
      warehouse: { name: row.warehouse!.name, state: row.warehouse!.state.name },
      start_price: Number(row.startPriceMinor),
      current_price: top ? Number(top.amountMinor) : null,
      next_bid: ['scheduled', 'live'].includes(row.status) ? Number(nextBid(row.startPriceMinor, top?.amountMinor ?? null, rules)) : null,
      bids: row.bids.length,
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt.toISOString(),
      rules: { step_pct: rules.stepBps / 100, step_min: Number(rules.stepMin), extend_minutes: rules.extendMinutes, pay_hours: rules.payHours },
      recent_bids: row.bids.slice(0, 10).map(bid => ({ name: publicName(bid.bidder), amount: Number(bid.amountMinor), at: bid.createdAt.toISOString() })),
      ...(viewer
        ? {
            viewer: {
              highest: mine ? Number(mine.amountMinor) : null,
              leading: Boolean(top && top.bidderId === viewer),
              to_pay: offered?.bidderId === viewer && row.status === 'awaiting_payment' ? { amount: Number(offered.amountMinor), pay_by: row.payBy?.toISOString() ?? null } : null,
              won: row.status === 'sold' && row.buyerId === viewer,
              seller: row.order!.sellerId === viewer,
            },
          }
        : {}),
    };
  }

  // ---- Public ----

  async publicList(country: string) {
    const rows = await this.prisma.connectAuction.findMany({ where: { kind: 'abandoned', country: country.toUpperCase(), status: { in: ['scheduled', 'live'] } }, orderBy: [{ status: 'asc' }, { endsAt: 'asc' }], take: 100, include: lotInclude });
    return { object: 'list' as const, data: await Promise.all(rows.map(row => this.present(row))) };
  }

  async publicGet(ref: string, viewer?: CustomerWithStore | null) {
    return this.present(await this.byNumber(ref), viewer?.id);
  }

  async bid(customer: CustomerWithStore, ref: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid('parameter_invalid', 'Give your bid in minor units.', 'amount');
    const lot = await this.byNumber(ref);
    if (!customer.phoneVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'phone_required', 'Confirm your mobile number to bid.');
    if (lot.order!.sellerId === customer.id) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'own_item', 'You cannot bid on your own item: collect it at the warehouse after paying what is owed instead.');
    const rules = await this.rules(lot.country);
    const now = new Date();
    const previous = this.top(lot);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM connect_auctions WHERE id = ${lot.id}::uuid FOR UPDATE`;
      const fresh = await tx.connectAuction.findUniqueOrThrow({ where: { id: lot.id } });
      if (fresh.status !== 'live' || fresh.endsAt <= now) throw conflict('auction_not_live', fresh.status === 'scheduled' ? 'Bidding has not opened yet.' : 'Bidding on this lot has ended.');
      const top = await tx.connectAuctionBid.findFirst({ where: { auctionId: lot.id }, orderBy: { amountMinor: 'desc' } });
      const least = nextBid(fresh.startPriceMinor, top?.amountMinor ?? null, rules);
      if (BigInt(amount) < least) throw invalid('bid_too_low', `Bid at least ${formatMoney(least, fresh.currency)}.`, 'amount');
      await tx.connectAuctionBid.create({ data: { auctionId: lot.id, bidderId: customer.id, amountMinor: BigInt(amount) } });
      const window = rules.extendMinutes * 60_000;
      if (window && fresh.endsAt.getTime() - now.getTime() < window) await tx.connectAuction.update({ where: { id: lot.id }, data: { endsAt: new Date(now.getTime() + window) } });
    });
    if (previous && previous.bidderId !== customer.id) {
      await this.tellCustomer(previous.bidderId, `auction_outbid:${lot.id}:${amount}`, `You were outbid on "${lot.title}"`, `The bid is now ${formatMoney(BigInt(amount), lot.currency)}.`, `/${lot.country.toLowerCase()}/auctions/${lot.number}`);
    }
    return this.publicGet(ref, customer);
  }

  async pay(customer: CustomerWithStore, ref: string) {
    const lot = await this.byNumber(ref);
    const offered = lot.offeredBidId ? lot.bids.find(bid => bid.id === lot.offeredBidId) : undefined;
    if (lot.status !== 'awaiting_payment' || !offered || offered.bidderId !== customer.id) throw conflict('not_yours_to_pay', 'This lot is not waiting for your payment.');
    if (lot.payBy && lot.payBy < new Date()) throw conflict('payment_window_closed', 'The time to pay for this lot has passed.');
    const sale = offered.amountMinor;
    const order = await this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id: lot.orderId! }, select: { mode: true } });
    const wallet = (await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', mode: order.mode, currency: lot.currency, customerId: customer.id } }))?.balanceMinor ?? 0n;
    if (wallet < sale) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Add ${formatMoney(sale - wallet, lot.currency)} to your Udozo wallet to pay.`);
    // What the sale pays: the seller's storage owed (oldest first, shared as storage always is), then Udozo's costs; the rest waits for the seller's claim.
    const cover = await this.charges.saleCover(lot.orderId!, sale);
    const costs = sale - cover.covered < lot.costsMinor ? sale - cover.covered : lot.costsMinor;
    const leftOver = sale - cover.covered - costs;
    const lines: Line[] = [
      { account: { kind: 'customer_wallet', currency: lot.currency, customerId: customer.id }, debit: sale },
      ...cover.lines,
      ...(costs > 0n ? [{ account: { kind: 'connect_revenue' as const, currency: lot.currency }, credit: costs }] : []),
      ...(leftOver > 0n ? [{ account: { kind: 'connect_auction_held' as const, currency: lot.currency }, credit: leftOver }] : []),
    ];
    const entry = await this.ledger.prepare({ mode: order.mode, type: 'connect_auction_sale', reference: `connect_auction:${lot.id}:sale`, description: `Udozo auction ${lotNumber(lot.number)}`, metadata: { auction: lot.number }, lines });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = new Date();
    const rules = await this.rules(lot.country);
    // What is left over waits for the seller's claim until then (7c).
    const claimBy = new Date(now.getTime() + rules.claimDays * dayMs);
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectAuction.updateMany({ where: { id: lot.id, status: 'awaiting_payment', offeredBidId: offered.id }, data: { status: 'sold', buyerId: customer.id, saleMinor: sale, paidAt: now, leftOverMinor: leftOver, claimBy, collectionCode: this.safePay.seal(code) } });
      if (!claimed.count) throw conflict('auction_changed', 'This lot changed: refresh and try again.');
      await this.ledger.write(tx, entry);
      await this.charges.settleFromRefund(tx, cover.ids);
      await tx.connectAuctionBid.update({ where: { id: offered.id }, data: { status: 'won' } });
      await tx.classifiedOrder.update({ where: { id: lot.orderId! }, data: { connectPlace: 'auctioned' } });
      if (lot.listingId) await tx.classifiedListing.updateMany({ where: { id: lot.listingId, status: 'active' }, data: { status: 'sold', soldAt: now } });
      // Sold: the return is over, so no more storage runs.
      if (lot.order!.connectReturn) await tx.connectReturnRequest.updateMany({ where: { id: lot.order!.connectReturn.id, status: 'accepted' }, data: { status: 'cancelled' } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: lot.orderId!, status: 'note', reportedBy: 'bitocard', note: `Sold at Udozo auction ${lotNumber(lot.number)}.` } });
    });
    const seller = await this.safePay.load(lot.orderId!);
    await this.safePay.tellParty(
      seller,
      'seller',
      'customer.connect.auction',
      `"${lot.title}" was sold at auction`,
      leftOver > 0n ? `It paid the storage owed. ${formatMoney(leftOver, lot.currency)} is left over for you: claim it on your order within ${rules.claimDays} days, or it becomes Udozo's.` : 'It paid what it could of the storage owed. Nothing is left over.',
    );
    await this.tellCustomer(customer.id, `auction_paid:${lot.id}`, `You bought "${lot.title}"`, `Collect it at ${lot.warehouse!.name}, ${lot.warehouse!.address} (${lot.warehouse!.hours}) with your collection code from the lot's page.`, `/${lot.country.toLowerCase()}/auctions/${lot.number}`);
    await this.inbox.admins('admin.connect.alert', { subject: `auction_sold:${lot.id}`, title: `${lotNumber(lot.number)} sold for ${formatMoney(sale, lot.currency)}`, body: `${formatMoney(leftOver, lot.currency)} left over for the seller's claim.`, link: `/connect/auctions/${lot.id}` });
    return this.publicGet(ref, customer);
  }

  /** The buyer's code to show at the warehouse. */
  async collectionCode(customer: CustomerWithStore, ref: string) {
    const lot = await this.byNumber(ref);
    if (lot.status !== 'sold' || lot.buyerId !== customer.id || !lot.collectionCode) throw conflict('not_yours_to_collect', 'Only its buyer collects this lot.');
    return { object: 'connect_collection_code' as const, code: lot.collectedAt ? null : this.safePay.unseal(lot.collectionCode), collected_at: lot.collectedAt?.toISOString() ?? null };
  }

  // ---- The job ----

  async runDue(now = new Date()) {
    const result = { opened: 0, ended: 0, offered: 0, lapsed: 0, unsold: 0 };
    result.opened = (await this.prisma.connectAuction.updateMany({ where: { kind: 'abandoned', status: 'scheduled', startsAt: { lte: now } }, data: { status: 'live' } })).count;
    const ended = await this.prisma.connectAuction.findMany({ where: { kind: 'abandoned', status: 'live', endsAt: { lte: now } }, take: 200, include: lotInclude });
    for (const lot of ended) {
      result.ended += 1;
      if (await this.offerNext(lot, now)) result.offered += 1;
      else result.unsold += 1;
    }
    const lapsed = await this.prisma.connectAuction.findMany({ where: { kind: 'abandoned', status: 'awaiting_payment', payBy: { lt: now } }, take: 200, include: lotInclude });
    for (const lot of lapsed) {
      const offered = lot.bids.find(bid => bid.id === lot.offeredBidId);
      if (offered) {
        await this.prisma.connectAuctionBid.updateMany({ where: { id: offered.id, status: 'offered' }, data: { status: 'lapsed' } });
        await this.tellCustomer(offered.bidderId, `auction_lapsed:${lot.id}`, `Your time to pay for "${lot.title}" ran out`, 'It is offered to the next bidder.', `/${lot.country.toLowerCase()}/auctions/${lot.number}`);
      }
      result.lapsed += 1;
      const fresh = await this.load(lot.id);
      if (await this.offerNext(fresh, now, offered?.bidderId)) result.offered += 1;
      else result.unsold += 1;
    }
    if (result.ended || result.lapsed) this.logger.log(result, 'Udozo auctions');
    return result;
  }

  /** Offers a lot to its highest bidder still in the running (never one who let it lapse), else marks it unsold. */
  private async offerNext(lot: LotRow, now: Date, skip?: string) {
    const lapsedBidders = new Set(lot.bids.filter(bid => bid.status === 'lapsed').map(bid => bid.bidderId));
    if (skip) lapsedBidders.add(skip);
    const next = lot.bids.find(bid => bid.status === 'active' && !lapsedBidders.has(bid.bidderId));
    const from = lot.status;
    if (!next) {
      const done = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, status: from, offeredBidId: lot.offeredBidId }, data: { status: 'unsold', offeredBidId: null, payBy: null } });
      if (done.count) await this.closeListing(lot.listingId, 'unsold');
      if (done.count) await this.inbox.admins('admin.connect.alert', { subject: `auction_unsold:${lot.id}`, title: `${lotNumber(lot.number)} did not sell`, body: lot.bids.length ? 'No bidder paid.' : 'Nobody bid.', link: `/connect/auctions/${lot.id}` });
      return false;
    }
    const rules = await this.rules(lot.country);
    const payBy = new Date(now.getTime() + rules.payHours * hourMs);
    const done = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, status: from, offeredBidId: lot.offeredBidId }, data: { status: 'awaiting_payment', offeredBidId: next.id, payBy } });
    if (!done.count) return false;
    await this.prisma.connectAuctionBid.update({ where: { id: next.id }, data: { status: 'offered' } });
    await this.tellCustomer(next.bidderId, `auction_offered:${lot.id}:${next.id}`, `"${lot.title}" is yours to pay for`, `Pay ${formatMoney(next.amountMinor, lot.currency)} from your Udozo wallet within ${rules.payHours} hours, or it goes to the next bidder.`, `/${lot.country.toLowerCase()}/auctions/${lot.number}`);
    return true;
  }

  private async tellCustomer(customerId: string, subject: string, title: string, body: string, link: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, storeId: true } });
    if (customer) await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.connect.auction', { subject, title, body, link }).catch(() => undefined);
  }

  // ---- Udozo's team ----

  /** Items at the warehouses the market's days into Loss of care with no open lot, and what each owes. */
  async eligible(country?: string, now = new Date()) {
    const rows = await this.prisma.classifiedOrder.findMany({
      where: { connectPlace: 'udozo_warehouse', ...(country ? { country: country.toUpperCase() } : {}), connectReturn: { is: { status: 'accepted', lossOfCareAt: { not: null } } }, connectAuctions: { none: { status: { in: [...openStatuses, 'sold'] } } } },
      take: 500,
      select: { id: true, number: true, country: true, currency: true, priceMinor: true, listing: { select: { title: true } }, connectReturn: { select: { lossOfCareAt: true } }, connectWarehouse: { select: { id: true, name: true } } },
    });
    const out = [];
    for (const row of rows) {
      const rules = await this.rules(row.country);
      const due = new Date(row.connectReturn!.lossOfCareAt!.getTime() + rules.auctionAfterDays * dayMs);
      out.push({ order_id: row.id, number: `SP-${row.number}`, title: row.listing.title, price: Number(row.priceMinor), currency: row.currency, warehouse: row.connectWarehouse, owed: Number((await this.charges.owed(row.id, 'seller')).total), auction_from: due.toISOString(), due: due <= now });
    }
    return { object: 'list' as const, data: out };
  }

  async create(adminId: string | null, input: { order_id: string; start_price: number; ends_at: string; starts_at?: string; costs?: number; title?: string; description?: string; below_owed?: boolean }) {
    if (!adminId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'admin_session_required', 'Sign in as an admin to list a lot.');
    const order = await this.prisma.classifiedOrder.findUnique({
      where: { id: input.order_id },
      include: { listing: { select: { title: true, description: true, categoryId: true, areaId: true, stateId: true, media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 8 } } }, connectReturn: true, connectWarehouse: { select: { stateId: true } } },
    });
    if (!order || order.connectPlace !== 'udozo_warehouse' || !order.connectWarehouseId || order.connectReturn?.status !== 'accepted' || !order.connectReturn.lossOfCareAt) throw conflict('not_auctionable', 'Only an abandoned item at a Udozo warehouse can be auctioned.');
    const rules = await this.rules(order.country);
    const now = new Date();
    if (order.connectReturn.lossOfCareAt.getTime() + rules.auctionAfterDays * dayMs > now.getTime()) throw conflict('auction_not_due', `It can be auctioned ${rules.auctionAfterDays} days into Loss of care.`);
    if (await this.prisma.connectAuction.findFirst({ where: { orderId: order.id, status: { in: [...openStatuses, 'sold'] } } })) throw conflict('auction_exists', 'This item is already listed.');
    const owed = (await this.charges.owed(order.id, 'seller')).total;
    const costs = BigInt(input.costs ?? 0);
    const start = BigInt(input.start_price);
    if (start <= 0n) throw invalid('parameter_invalid', 'Give the starting price in minor units.', 'start_price');
    if (start < owed + costs && !input.below_owed) throw invalid('start_below_owed', `Start at least at what is owed and the costs, ${formatMoney(owed + costs, order.currency)}, or say it may start below.`, 'start_price');
    const startsAt = input.starts_at ? new Date(input.starts_at) : new Date(now.getTime() + auctionNoticeMs);
    const endsAt = new Date(input.ends_at);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now.getTime() + auctionNoticeMs - 60_000) throw invalid('auction_too_soon', 'Open bidding at least a day from now, so the seller is told first.', 'starts_at');
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() < startsAt.getTime() + hourMs) throw invalid('parameter_invalid', 'End it at least an hour after it opens.', 'ends_at');
    const title = input.title?.trim() || order.listing.title || 'An item';
    const description = input.description?.trim() || `Sold as seen, from an abandoned shipment: its seller did not collect it. ${order.listing.description ?? ''}`.trim();
    const photos = order.listing.media.map(media => this.watermarks.url(media, 960)).filter((url): url is string => Boolean(url));
    // Sold through an ordinary auction listing of Udozo's in the market, placed where the warehouse is.
    const seller = await this.udozoSeller(order.country);
    const warehouseState = order.connectWarehouse?.stateId ?? order.listing.stateId;
    const area =
      order.listing.stateId === warehouseState && order.listing.areaId
        ? { id: order.listing.areaId, parentId: warehouseState }
        : await this.prisma.classifiedArea.findFirst({ where: { parentId: warehouseState, kind: 'area', enabled: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, parentId: true } });
    if (!area || !order.listing.categoryId) throw conflict('not_auctionable', 'Its listing has no category, or the warehouse no area to show it in.');
    const row = await this.prisma.$transaction(async tx => {
      const listing = await tx.classifiedListing.create({
        data: {
          customerId: seller.id,
          country: order.country,
          currency: order.currency,
          title: title.slice(0, 140),
          slug: slugify(title.slice(0, 140)),
          description: description.slice(0, 3000),
          priceKind: 'fixed',
          priceMinor: start,
          saleMethod: 'auction',
          condition: 'used',
          categoryId: order.listing.categoryId,
          areaId: area.id,
          stateId: area.parentId,
          delivery: 'none',
          pickup: true,
          contact: 'chat',
          stock: 1,
          status: 'active',
          submittedAt: now,
          publishedAt: now,
          expiresAt: new Date(endsAt.getTime() + 30 * dayMs),
        },
      });
      // Its photos are the abandoned listing's own (the same stored files).
      if (order.listing.media.length) {
        await tx.classifiedMedia.createMany({ data: order.listing.media.map(media => ({ listingId: listing.id, kind: 'photo', position: media.position, url: media.url, storageKey: media.storageKey, width: media.width, height: media.height, contentHash: media.contentHash, status: 'ready', privateAt: media.privateAt })) });
      }
      return tx.connectAuction.create({
        data: { orderId: order.id, listingId: listing.id, sellerId: seller.id, country: order.country, currency: order.currency, title: title.slice(0, 140), description: description.slice(0, 3000), photos, warehouseId: order.connectWarehouseId!, startPriceMinor: start, owedMinor: owed, costsMinor: costs, startsAt, endsAt, createdById: adminId },
        include: lotInclude,
      });
    });
    await this.listings.indexForSearch(row.listingId!);
    await this.audit.record({ actorId: adminId, action: 'connect_auction.listed', targetType: 'connect_auction', targetId: row.id, before: null, after: { order: order.id, start_price: input.start_price, owed: Number(owed) } });
    const original = await this.safePay.load(order.id);
    await this.safePay.tellParty(original, 'seller', 'customer.connect.auction', `"${title}" will be auctioned`, `Bidding opens ${startsAt.toUTCString()}. Until the first bid you can still collect it at the warehouse after paying what is owed.`);
    return this.adminPresent(row);
  }

  async cancel(adminId: string | null, id: string, reason: string) {
    const row = await this.load(id);
    if (!['scheduled', 'live'].includes(row.status) || row.bids.length) throw conflict('auction_has_bids', 'Only a lot nobody has bid on can be cancelled.');
    const done = await this.prisma.connectAuction.updateMany({ where: { id, status: row.status }, data: { status: 'cancelled', cancelReason: reason.trim().slice(0, 300) } });
    if (!done.count) throw conflict('auction_changed', 'This lot changed: refresh and try again.');
    await this.closeListing(row.listingId, 'withdrawn');
    await this.audit.record({ actorId: adminId, action: 'connect_auction.cancelled', targetType: 'connect_auction', targetId: id, before: { status: row.status }, after: { status: 'cancelled', reason } });
    return this.adminPresent(await this.load(id));
  }

  /** The buyer collects the lot at the warehouse, against their collection code. */
  async handOver(adminId: string | null, id: string, code: string) {
    const row = await this.load(id);
    if (row.status !== 'sold' || !row.collectionCode || row.collectedAt) throw conflict('auction_not_collectable', 'This lot is not waiting to be collected.');
    const expected = Buffer.from(this.safePay.unseal(row.collectionCode));
    const given = Buffer.from(code.replace(/\s/g, ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid('collection_code_wrong', 'That is not the buyer’s collection code.', 'code');
    const done = await this.prisma.connectAuction.updateMany({ where: { id, status: 'sold', collectedAt: null }, data: { collectedAt: new Date() } });
    if (!done.count) throw conflict('auction_changed', 'This lot changed: refresh and try again.');
    await this.prisma.classifiedOrder.update({ where: { id: row.orderId! }, data: { connectWarehouseId: null } });
    await this.audit.record({ actorId: adminId, action: 'connect_auction.collected', targetType: 'connect_auction', targetId: id, before: null, after: { collected: true } });
    return this.adminPresent(await this.load(id));
  }

  async adminList(filter: { status?: string; country?: string }) {
    const rows = await this.prisma.connectAuction.findMany({ where: { kind: 'abandoned', ...(filter.status ? { status: filter.status } : {}), ...(filter.country ? { country: filter.country.toUpperCase() } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, include: lotInclude });
    return { object: 'list' as const, data: rows.map(row => this.adminPresent(row)) };
  }

  async adminGet(id: string) {
    return this.adminPresent(await this.load(id));
  }

  /** A lot as Udozo's team sees it: every bidder, and what the sale paid off and left over for the seller. */
  adminPresent(row: LotRow) {
    const top = this.top(row);
    return {
      object: 'connect_auction' as const,
      id: row.id,
      number: lotNumber(row.number),
      ref: String(row.number),
      status: row.status,
      country: row.country,
      currency: row.currency,
      title: row.title,
      order: { id: row.order!.id, number: `SP-${row.order!.number}` },
      warehouse: { id: row.warehouse!.id, name: row.warehouse!.name },
      /** Its auction listing on udozo.com, where people bid. */
      listing: row.listing ? { ref: Number(row.listing.ref), slug: row.listing.slug } : null,
      start_price: Number(row.startPriceMinor),
      current_price: top ? Number(top.amountMinor) : null,
      owed: Number(row.owedMinor),
      costs: Number(row.costsMinor),
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt.toISOString(),
      pay_by: row.payBy?.toISOString() ?? null,
      sale: minor(row.saleMinor),
      left_over: minor(row.leftOverMinor),
      paid_at: row.paidAt?.toISOString() ?? null,
      collected_at: row.collectedAt?.toISOString() ?? null,
      cancel_reason: row.cancelReason,
      bids: row.bids.map(bid => ({ id: bid.id, amount: Number(bid.amountMinor), status: bid.status, at: bid.createdAt.toISOString(), bidder: { id: bid.bidder.id, name: bid.bidder.name, email: bid.bidder.email } })),
    };
  }

  /** A seller may collect an item listed at auction only until its first bid. */
  async assertCollectable(orderId: string) {
    const open = await this.prisma.connectAuction.findFirst({ where: { orderId, status: { in: [...openStatuses, 'sold'] } }, include: { bids: { select: { id: true } } } });
    if (open && (open.status === 'sold' || open.status === 'awaiting_payment' || open.bids.length)) throw conflict('auction_has_bids', 'This item has bids at auction: it can no longer be collected.');
  }

  /** Once its seller collected it, a lot nobody bid on is cancelled. */
  async cancelForCollection(orderId: string) {
    const lots = await this.prisma.connectAuction.findMany({ where: { orderId, status: { in: ['scheduled', 'live'] }, bids: { none: {} } }, select: { id: true, listingId: true } });
    for (const lot of lots) {
      const done = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, status: { in: ['scheduled', 'live'] } }, data: { status: 'cancelled', cancelReason: 'Collected by its seller before any bid.' } });
      if (done.count) await this.closeListing(lot.listingId, 'withdrawn');
    }
  }
}
