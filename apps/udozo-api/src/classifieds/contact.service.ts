import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { cleanMessage } from './conversations.service.js';
import { addLead } from './leads.service.js';
import { ListingsService } from './listings.service.js';
import { invalid, isOnShop } from './rules.js';
import { publicName } from './search.service.js';
import { ShopEmails } from './shop-emails.service.js';

/** A buyer asks at most this many sellers for their contact details an hour. */
export const contactRequestsPerHour = 10;
/** A buyer asks for at most this many call backs an hour. */
export const callbacksPerHour = 5;
/** After a seller declines, the buyer may ask them again after this long. */
export const askAgainAfterMs = 7 * 86_400_000;
/** Answered and cancelled requests are kept this long. */
export const keepRequestsMs = 365 * 86_400_000;
/** A buyer's note on a request. */
export const maxNote = 300;

/** A note as kept: links, codes and card numbers hidden as in chats, and phone numbers too (the details stay private). */
export const cleanNote = (raw: string) => cleanMessage(raw).replace(/\+?\d[\d\s().-]{5,}\d/g, '[number hidden]').slice(0, maxNote);

export type ContactKind = 'contact' | 'callback';

const notFound = (what = 'listing') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

const listingSelect = { id: true, ref: true, slug: true, title: true, country: true, status: true, onShop: true, contact: true, customerId: true } satisfies Prisma.ClassifiedListingSelect;
type ListingRow = Prisma.ClassifiedListingGetPayload<{ select: typeof listingSelect }>;

/** A listing's address on udozo.com. */
export const listingPath = (listing: Pick<ListingRow, 'country' | 'ref' | 'slug'>) => `/${listing.country.toLowerCase()}/l/${listing.ref}${listing.slug ? `-${listing.slug}` : ''}`;

const requestInclude = {
  listing: { select: listingSelect },
  buyer: { select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true } },
  seller: { select: { id: true, name: true } },
} satisfies Prisma.ClassifiedContactRequestInclude;
type RequestRow = Prisma.ClassifiedContactRequestGetPayload<{ include: typeof requestInclude }>;

/**
 * Getting in touch without anyone's details shown on the page. **Request contact**: the buyer asks; once the seller
 * accepts, the buyer sees the seller's confirmed phone and email on every listing of theirs, until the seller stops
 * sharing. **Request a call back**: the seller is given the buyer's name, confirmed mobile and email with the listing.
 * Nothing about either side is in an email or a notice: the details are read signed in.
 */
@Injectable()
export class ContactRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
  ) {}

  /** A live listing in the buyer's own market that is not theirs, whose seller has not blocked them. */
  async contactable(customer: CustomerWithStore, listingId: string) {
    const country = await this.listings.sellerCountry(customer);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: listingSelect });
    if (!listing || !isOnShop(listing) || listing.country !== country) throw notFound();
    if (listing.customerId === customer.id) throw invalid('parameter_invalid', 'This is your own listing.', 'listing_id');
    if (await this.blocked(listing.customerId, customer.id)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'seller_unavailable', 'You cannot contact this seller.');
    }
    return listing;
  }

  /** Whether the seller blocked the buyer in any of their chats. */
  async blocked(sellerId: string, buyerId: string) {
    return Boolean(await this.prisma.classifiedConversation.findFirst({ where: { sellerId, buyerId, sellerBlockedAt: { not: null } }, select: { id: true } }));
  }

  /** What the buyer has with the seller of a listing: their shared details, an open or declined request, a call back. */
  async forViewer(customer: CustomerWithStore, listing: { id: string; customerId: string; contact: string }) {
    const sellerId = listing.customerId;
    const [share, request, callback] = await Promise.all([
      this.prisma.classifiedContactShare.findUnique({ where: { sellerId_buyerId: { sellerId, buyerId: customer.id } }, include: { seller: { select: { email: true, phone: true, phoneVerifiedAt: true } } } }),
      this.prisma.classifiedContactRequest.findFirst({ where: { sellerId, buyerId: customer.id, kind: 'contact' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.classifiedContactRequest.findFirst({ where: { listingId: listing.id, buyerId: customer.id, kind: 'callback' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const offered = listing.contact !== 'chat';
    return {
      contact: {
        available: offered,
        shared: share ? { phone: share.seller.phoneVerifiedAt ? share.seller.phone : null, email: share.seller.email } : null,
        request: request && !share ? { id: request.id, status: request.status, ask_again_at: this.askAgainAt(request)?.toISOString() ?? null } : null,
      },
      callback: { available: offered, request: callback ? { id: callback.id, status: callback.status, created_at: callback.createdAt.toISOString() } : null },
    };
  }

  /** The buyer asks the seller for their contact details (or is shown their open or answered request). */
  async requestContact(customer: CustomerWithStore, listingId: string, note?: string) {
    const listing = await this.contactable(customer, listingId);
    if (listing.contact === 'chat') throw conflict('contact_not_offered', 'This seller takes messages only: chat with them here.');
    const shared = await this.prisma.classifiedContactShare.findUnique({ where: { sellerId_buyerId: { sellerId: listing.customerId, buyerId: customer.id } } });
    const last = await this.prisma.classifiedContactRequest.findFirst({ where: { sellerId: listing.customerId, buyerId: customer.id, kind: 'contact' }, orderBy: { createdAt: 'desc' }, include: requestInclude });
    if (shared && last) return this.present(last, 'buyer');
    if (last?.status === 'pending') return this.present(last, 'buyer');
    const again = last ? this.askAgainAt(last) : null;
    if (again && again > new Date()) {
      throw conflict('contact_declined', `The seller declined. You can ask again from ${again.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, or chat with them here.`);
    }
    await this.limit(customer.id, 'contact', contactRequestsPerHour, `You can ask ${contactRequestsPerHour} sellers for their details an hour. Try again later, or chat with the seller here.`);
    const request = await this.create(customer, listing, 'contact', note);
    const name = publicName(customer.name);
    await this.tellSeller(request, 'customer.classifieds.contact_request', `${name} asked for your contact details`, `${name} asked for your phone number and email about “${listing.title ?? 'your listing'}”. Accept or decline in Requests.`);
    return this.present(request, 'buyer');
  }

  /** The buyer asks the seller to phone them: their name, confirmed mobile and email go to the seller with the listing. */
  async requestCallback(customer: CustomerWithStore, listingId: string, note?: string) {
    const listing = await this.contactable(customer, listingId);
    if (listing.contact === 'chat') throw conflict('callback_not_offered', 'This seller takes messages only: chat with them here.');
    if (!customer.phone || !customer.phoneVerifiedAt) throw conflict('phone_required', 'Confirm your mobile number on your profile first: the seller calls you on it.');
    const open = await this.prisma.classifiedContactRequest.findFirst({ where: { listingId, buyerId: customer.id, kind: 'callback', status: 'pending' }, include: requestInclude });
    if (open) return this.present(open, 'buyer');
    await this.limit(customer.id, 'callback', callbacksPerHour, `You can ask for ${callbacksPerHour} call backs an hour. Try again later, or chat with the seller here.`);
    const request = await this.create(customer, listing, 'callback', note);
    const name = publicName(customer.name);
    await this.tellSeller(request, 'customer.classifieds.callback_request', `${name} asked you to call them back`, `${name} would like a call about “${listing.title ?? 'your listing'}”. Their number is in Requests.`);
    return this.present(request, 'buyer');
  }

  /** The seller's requests: contact requests waiting first, then call backs, newest first (`status` to filter). */
  async incoming(customer: CustomerWithStore, query: { kind?: ContactKind; status?: string; limit?: number }) {
    await this.listings.sellerCountry(customer);
    const where: Prisma.ClassifiedContactRequestWhereInput = { sellerId: customer.id, ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : { status: { not: 'cancelled' } }) };
    const rows = await this.prisma.classifiedContactRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }], take: Math.min(query.limit ?? 50, 100) });
    const pending = await this.prisma.classifiedContactRequest.count({ where: { sellerId: customer.id, status: 'pending' } });
    return { object: 'list' as const, pending, data: rows.map(row => this.present(row, 'seller')) };
  }

  /** How many requests wait on the seller (the account's Requests badge). */
  async pendingCount(sellerId: string) {
    return this.prisma.classifiedContactRequest.count({ where: { sellerId, status: 'pending' } });
  }

  /**
   * The seller answers: a contact request is accepted (their details shared with the buyer on all their listings) or
   * declined; a call back is marked done or dismissed. The buyer may cancel their own while it waits.
   */
  async answer(customer: CustomerWithStore, id: string, action: 'accept' | 'decline' | 'done' | 'dismiss' | 'cancel') {
    await this.listings.sellerCountry(customer);
    const request = await this.prisma.classifiedContactRequest.findUnique({ where: { id }, include: requestInclude });
    const side = request?.sellerId === customer.id ? 'seller' : request?.buyerId === customer.id ? 'buyer' : null;
    if (!request || !side) throw notFound('request');
    const allowed = side === 'buyer' ? action === 'cancel' : request.kind === 'contact' ? action === 'accept' || action === 'decline' : action === 'done' || action === 'dismiss';
    if (!allowed) throw invalid('parameter_invalid', side === 'buyer' ? 'You can only cancel your own request.' : request.kind === 'contact' ? 'Accept or decline a contact request.' : 'Mark a call back done or dismiss it.', 'action');
    const status = { accept: 'accepted', decline: 'declined', done: 'done', dismiss: 'dismissed', cancel: 'cancelled' }[action];
    const now = new Date();
    const changed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedContactRequest.updateMany({ where: { id, status: 'pending' }, data: { status, answeredAt: now } });
      if (!claimed.count) return false;
      if (action === 'accept') {
        await tx.classifiedContactShare.createMany({ data: [{ sellerId: request.sellerId, buyerId: request.buyerId }], skipDuplicates: true });
        await addLead(tx, request.listingId, request.buyerId, 'phone');
      }
      return true;
    });
    if (!changed) throw conflict('request_answered', 'This request was already answered.');
    const updated = await this.prisma.classifiedContactRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    if (action === 'accept' || action === 'decline') {
      const seller = publicName(request.seller.name);
      const title = request.listing.title ?? 'their listing';
      await this.tellBuyer(
        updated,
        action === 'accept' ? `${seller} shared their contact details` : `${seller} declined your contact request`,
        action === 'accept' ? `Their phone and email are on “${title}” and every listing of theirs.` : `You can still chat with them about “${title}”.`,
      );
    }
    return this.present(updated, side);
  }

  /** The buyers who can see the seller's details. */
  async shares(customer: CustomerWithStore) {
    await this.listings.sellerCountry(customer);
    const rows = await this.prisma.classifiedContactShare.findMany({ where: { sellerId: customer.id }, include: { buyer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { object: 'list' as const, data: rows.map(row => ({ object: 'classified_contact_share' as const, buyer: { id: row.buyerId, name: publicName(row.buyer.name) }, since: row.createdAt.toISOString() })) };
  }

  /** The seller stops showing their details to a buyer (who may ask again). */
  async stopSharing(customer: CustomerWithStore, buyerId: string) {
    await this.listings.sellerCountry(customer);
    const removed = await this.prisma.classifiedContactShare.deleteMany({ where: { sellerId: customer.id, buyerId } });
    if (!removed.count) throw notFound('buyer');
    return { object: 'classified_contact_share' as const, buyer: { id: buyerId }, deleted: true };
  }

  /** Requests answered or cancelled 12 months ago are deleted (the privacy notice's retention). */
  async purgeOld() {
    const { count } = await this.prisma.classifiedContactRequest.deleteMany({ where: { status: { not: 'pending' }, answeredAt: { lt: new Date(Date.now() - keepRequestsMs) } } });
    return count;
  }

  private askAgainAt(request: { status: string; answeredAt: Date | null }) {
    return request.status === 'declined' && request.answeredAt ? new Date(request.answeredAt.getTime() + askAgainAfterMs) : null;
  }

  private async limit(buyerId: string, kind: ContactKind, perHour: number, message: string) {
    const recent = await this.prisma.classifiedContactRequest.count({ where: { buyerId, kind, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= perHour) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', kind === 'contact' ? 'contact_request_limit' : 'callback_limit', message);
  }

  private async create(customer: CustomerWithStore, listing: ListingRow, kind: ContactKind, note?: string) {
    const text = note?.trim() ? cleanNote(note) : null;
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.classifiedContactRequest.create({ data: { kind, listingId: listing.id, buyerId: customer.id, sellerId: listing.customerId, country: listing.country, note: text }, include: requestInclude });
        if (kind === 'callback') await addLead(tx, listing.id, customer.id, 'phone');
        return row;
      });
    } catch (error) {
      // A request sent twice at once: the open one wins.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const open = await this.prisma.classifiedContactRequest.findFirst({ where: { buyerId: customer.id, kind, status: 'pending', ...(kind === 'contact' ? { sellerId: listing.customerId } : { listingId: listing.id }) }, include: requestInclude });
        if (open) return open;
      }
      throw error;
    }
  }

  private async tellSeller(request: RequestRow, type: 'customer.classifieds.contact_request' | 'customer.classifieds.callback_request', title: string, body: string) {
    const seller = await this.prisma.customer.findUniqueOrThrow({ where: { id: request.sellerId }, select: { id: true, storeId: true } });
    await this.inbox.customer({ customerId: seller.id, storeId: seller.storeId }, type, { subject: request.id, title, body, link: '/account/requests' });
    this.emails.customer(seller.id, { title, body, path: '/account/requests', action: 'Open Requests' });
  }

  private async tellBuyer(request: RequestRow, title: string, body: string) {
    const buyer = await this.prisma.customer.findUniqueOrThrow({ where: { id: request.buyerId }, select: { id: true, storeId: true } });
    await this.inbox.customer({ customerId: buyer.id, storeId: buyer.storeId }, 'customer.classifieds.contact_answered', { subject: `${request.id}:${request.status}`, title, body, link: listingPath(request.listing) });
  }

  /**
   * A request as each side sees it. The seller sees a call back's requester in full (name, confirmed mobile, email: what
   * they asked to share); a contact request's only by their public name. The buyer sees the seller's public name.
   */
  present(row: RequestRow, side: 'buyer' | 'seller') {
    const callback = row.kind === 'callback';
    const live = callback && row.status === 'pending';
    return {
      object: 'classified_contact_request' as const,
      id: row.id,
      kind: row.kind as ContactKind,
      status: row.status,
      role: side,
      note: row.note,
      listing: { id: row.listing.id, title: row.listing.title, path: listingPath(row.listing) },
      with:
        side === 'seller'
          ? {
              name: callback ? row.buyer.name : publicName(row.buyer.name),
              // Only for a call back the buyer asked for, and only while it waits to be done.
              phone: live && row.buyer.phoneVerifiedAt ? row.buyer.phone : null,
              email: live ? row.buyer.email : null,
            }
          : { name: publicName(row.seller.name), phone: null, email: null },
      ask_again_at: side === 'buyer' ? (this.askAgainAt(row)?.toISOString() ?? null) : null,
      answered_at: row.answeredAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
