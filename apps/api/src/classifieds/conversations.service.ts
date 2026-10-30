import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { checkDocument, maxDocumentBytes } from '../kyc/files.js';
import { KycStorage } from '../kyc/storage.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { shopMessagesEmail } from '../notifications/templates.js';
import { redact } from '../support/redact.js';
import { addLead } from './leads.service.js';
import { ListingsService } from './listings.service.js';
import { type ReportReason } from './moderation.service.js';
import { invalid, isOnShop, maxPriceMinor, priceText } from './rules.js';
import { publicName } from './search.service.js';
import type { MediaUpload } from './media.service.js';

const minuteMs = 60_000;
const dayMs = 86_400_000;
/** A message is at most this long. */
export const maxMessage = 2000;
/** Messages one side may send in one chat in a minute. */
export const messagesPerMinute = 20;
/** New chats a buyer may start in an hour (spam). */
export const newChatsPerHour = 20;
/** Photos one chat can hold. */
export const maxChatPhotos = 30;
/** An offer stays open this long. */
export const offerMs = 48 * 60 * minuteMs;
/** Each side gets at most one in-app notice per chat in this time. */
export const alertEveryMs = 10 * minuteMs;
/** Messages left unread this long are emailed (once per batch). */
export const emailAfterMs = 10 * minuteMs;
/** Chats with no message for this long are deleted, unless reported. */
export const keepChatsMs = 365 * dayMs;
/** Every chat opens with this, from BitoCard. */
export const safetyNote = 'Stay safe: keep the chat on Udozo, meet in a busy public place, inspect before paying and never pay in advance. Udozo never asks for codes or passwords.';

type Side = 'buyer' | 'seller';

const notFound = (what = 'chat') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const tooFast = (code: string, message: string) => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', code, message);

/** Web addresses are masked in chats (scammers send people to look-alike pages); email addresses are left alone. */
const links = /\b(?:https?:\/\/|www\.)\S+|(?<![@\w.-])\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ng|gh|ke|io|co|me|app|link|xyz|info|biz|shop|online|site|store|live|top|click)\b(?:\/\S*)?/gi;

/** A message as it is kept and shown: trimmed, at most 2,000 characters, card numbers, codes and links masked. */
export function cleanMessage(raw: string) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxMessage);
  return redact(text).replace(links, '[link hidden]');
}

const listingSummary = {
  select: {
    id: true,
    ref: true,
    title: true,
    slug: true,
    status: true,
    onShop: true,
    country: true,
    currency: true,
    priceKind: true,
    priceMinor: true,
    customerId: true,
    media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
  },
} satisfies Prisma.ClassifiedListingDefaultArgs;

const person = { select: { id: true, name: true, email: true, storeId: true, emailVerifiedAt: true } } satisfies Prisma.CustomerDefaultArgs;

const chatInclude = {
  listing: listingSummary,
  buyer: person,
  seller: person,
  offers: { where: { status: 'open' }, take: 1 },
  messages: { orderBy: { seq: 'desc' }, take: 1 },
} satisfies Prisma.ClassifiedConversationInclude;

type ChatRow = Prisma.ClassifiedConversationGetPayload<{ include: typeof chatInclude }>;
type MessageRow = Prisma.ClassifiedMessageGetPayload<{ include: { offer: true } }>;
type OfferRow = Prisma.ClassifiedOfferGetPayload<object>;

/**
 * BitoCard Shop's chats: one per listing and buyer, between the buyer and the seller. Text (card numbers, codes and
 * links masked) and photos (checked from their bytes, metadata removed, sealed in the private bucket), price offers from
 * either side for the other to accept or decline, blocking and reporting. Each side is told in the app (at most every
 * 10 minutes per chat) and by email when messages wait unread. Moderators read a chat only once it has been reported.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly storage: KycStorage,
    private readonly inbox: InboxService,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Reading ----

  /** The customer's chats, buying, selling or both, most recent first, with what is unread. */
  async list(customer: CustomerWithStore, filter: { role?: 'buying' | 'selling'; limit?: number; offset?: number }) {
    await this.listings.sellerCountry(customer);
    const where: Prisma.ClassifiedConversationWhereInput =
      filter.role === 'buying' ? { buyerId: customer.id } : filter.role === 'selling' ? { sellerId: customer.id } : { OR: [{ buyerId: customer.id }, { sellerId: customer.id }] };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedConversation.findMany({ where, include: chatInclude, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: filter.limit ?? 30, skip: filter.offset ?? 0 }),
      this.prisma.classifiedConversation.count({ where }),
    ]);
    const unread = await this.unreadIn(customer.id, rows.map(row => row.id));
    return { object: 'list' as const, data: rows.map(row => this.present(row, customer.id, unread.get(row.id) ?? 0)), total };
  }

  /** How many messages wait unread across the customer's chats (the badge). */
  async unreadCount(customer: CustomerWithStore) {
    await this.listings.sellerCountry(customer);
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "classified_messages" m JOIN "classified_conversations" c ON c."id" = m."conversation_id"
      WHERE (c."buyer_id" = ${customer.id}::uuid AND m."sender_id" = c."seller_id" AND m."created_at" > coalesce(c."buyer_read_at", 'epoch'))
         OR (c."seller_id" = ${customer.id}::uuid AND m."sender_id" = c."buyer_id" AND m."created_at" > coalesce(c."seller_read_at", 'epoch'))`;
    // B2B reselling: the resellers carrying this supplier's listings (My Resellers), and what waits for them there.
    const [resale] = await this.prisma.$queryRaw<{ resellers: bigint; waiting: bigint }[]>`
      SELECT (SELECT count(*) FROM "resale_relationships" r WHERE r."supplier_id" = ${customer.id}::uuid) AS resellers,
        (SELECT count(*) FROM "resale_messages" m JOIN "resale_relationships" r ON r."id" = m."relationship_id"
          WHERE r."supplier_id" = ${customer.id}::uuid AND m."author" <> 'supplier' AND m."created_at" > coalesce(r."supplier_read_at", 'epoch'))
        + (SELECT count(*) FROM "resale_listings" l JOIN "resale_relationships" r ON r."id" = l."relationship_id"
          WHERE r."supplier_id" = ${customer.id}::uuid AND l."note_status" = 'pending' AND l."status" <> 'removed') AS waiting`;
    return { object: 'classified_unread' as const, unread: Number(row?.n ?? 0), resellers: Number(resale?.resellers ?? 0), resellers_waiting: Number(resale?.waiting ?? 0) };
  }

  /**
   * One chat with its messages: the latest 50 (older with `before`), or those after `after` (polling). Reading the latest
   * marks the chat read.
   */
  async get(customer: CustomerWithStore, id: string, page: { after?: string; before?: string; limit?: number } = {}) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const limit = page.limit ?? 50;
    let messages: MessageRow[];
    let hasMore = false;
    if (page.after) {
      const from = await this.seqOf(chat.id, page.after, 'after');
      messages = await this.prisma.classifiedMessage.findMany({ where: { conversationId: chat.id, seq: { gt: from } }, include: { offer: true }, orderBy: { seq: 'asc' }, take: limit + 1 });
      hasMore = messages.length > limit;
      messages = messages.slice(0, limit);
    } else {
      const to = page.before ? await this.seqOf(chat.id, page.before, 'before') : undefined;
      messages = await this.prisma.classifiedMessage.findMany({ where: { conversationId: chat.id, ...(to !== undefined ? { seq: { lt: to } } : {}) }, include: { offer: true }, orderBy: { seq: 'desc' }, take: limit + 1 });
      hasMore = messages.length > limit;
      messages = messages.slice(0, limit).reverse();
    }
    const side = this.sideOf(chat, customer.id)!;
    if (!page.before) {
      await this.prisma.classifiedConversation.update({ where: { id: chat.id }, data: side === 'buyer' ? { buyerReadAt: new Date() } : { sellerReadAt: new Date() } });
    }
    const unread = page.before ? (await this.unreadIn(customer.id, [chat.id])).get(chat.id) ?? 0 : 0;
    return { ...this.present(chat, customer.id, unread), messages: messages.map(message => this.presentMessage(message, customer.id)), has_more: hasMore };
  }

  /** A photo sent in the chat, for either side. */
  async photo(customer: CustomerWithStore, id: string, messageId: string) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    return this.readPhoto(chat.id, messageId);
  }

  // ---- Writing ----

  /**
   * The buyer's first message about a listing opens the chat (or continues the one they have): live listings only, in
   * their own country, never their own, and only where the seller takes chats.
   */
  async start(customer: CustomerWithStore, input: { listing_id: string; body: string }) {
    const country = await this.listings.sellerCountry(customer);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: input.listing_id } });
    if (!listing || !isOnShop(listing) || listing.country !== country) throw notFound('listing');
    if (listing.customerId === customer.id) throw invalid('parameter_invalid', 'This is your own listing.', 'listing_id');
    const existing = await this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId: listing.id, buyerId: customer.id } } });
    if (existing) {
      await this.send(customer, existing.id, input.body);
      return this.get(customer, existing.id);
    }
    if (listing.contact === 'phone') throw conflict('chat_not_offered', 'This seller takes calls only: use Show phone.');
    const text = cleanMessage(input.body);
    if (!text) throw invalid('parameter_missing', 'Write a message.', 'body');
    const started = await this.prisma.classifiedConversation.count({ where: { buyerId: customer.id, createdAt: { gt: new Date(Date.now() - 60 * minuteMs) } } });
    if (started >= newChatsPerHour) throw tooFast('chat_rate_limited', 'You have started a lot of chats in the last hour. Try again later.');

    const now = new Date();
    let id: string;
    try {
      id = await this.prisma.$transaction(async tx => {
        const chat = await tx.classifiedConversation.create({ data: { listingId: listing.id, buyerId: customer.id, sellerId: listing.customerId, country, lastMessageAt: now, buyerReadAt: now } });
        await tx.classifiedMessage.create({ data: { conversationId: chat.id, kind: 'system', body: safetyNote, createdAt: now } });
        await tx.classifiedMessage.create({ data: { conversationId: chat.id, senderId: customer.id, kind: 'text', body: text, createdAt: new Date(now.getTime() + 1) } });
        await addLead(tx, listing.id, customer.id, 'chat');
        return chat.id;
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      // Two first messages at once: the other created the chat, so this one joins it.
      const chat = await this.prisma.classifiedConversation.findUniqueOrThrow({ where: { listingId_buyerId: { listingId: listing.id, buyerId: customer.id } } });
      await this.send(customer, chat.id, input.body);
      return this.get(customer, chat.id);
    }
    const chat = await this.prisma.classifiedConversation.findUniqueOrThrow({ where: { id }, include: chatInclude });
    await this.alert(chat, 'seller', `${publicName(customer.name)} asked about "${chat.listing.title}"`, text);
    return this.get(customer, id);
  }

  /** A text message from either side. */
  async send(customer: CustomerWithStore, id: string, body: string) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const side = this.requireWritable(chat, customer.id);
    const text = cleanMessage(body);
    if (!text) throw invalid('parameter_missing', 'Write a message.', 'body');
    await this.requirePace(chat.id, customer.id);
    const message = await this.write(chat, side, { kind: 'text', body: text });
    await this.alert(chat, other(side), `${publicName(customer.name)} wrote about "${chat.listing.title}"`, text);
    return this.presentMessage(message, customer.id);
  }

  /** A photo from either side (JPEG or PNG, at most 4 MB), its metadata removed, with an optional caption. */
  async sendPhoto(customer: CustomerWithStore, id: string, file: MediaUpload | undefined, caption?: string) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const side = this.requireWritable(chat, customer.id);
    if (!file) throw invalid('parameter_missing', 'Choose a photo to send.', 'file');
    if (!this.storage.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Photos cannot be sent in chat yet. Write a message instead.');
    if (file.size > maxDocumentBytes) throw invalid('file_too_large', 'Photos can be at most 4 MB.', 'file');
    const checked = checkDocument(file.buffer, file.mimetype, false);
    if ('problem' in checked) throw invalid('file_invalid', checked.problem, 'file');
    if ((await this.prisma.classifiedMessage.count({ where: { conversationId: chat.id, kind: 'photo' } })) >= maxChatPhotos) {
      throw conflict('too_many_files', `A chat can hold ${maxChatPhotos} photos.`);
    }
    await this.requirePace(chat.id, customer.id);
    const objectKey = this.storage.shopChatKey(chat.id, randomUUID());
    await this.storage.put(objectKey, checked.bytes);
    const message = await this.write(chat, side, { kind: 'photo', body: caption ? cleanMessage(caption) : '', objectKey, contentType: checked.contentType, size: checked.bytes.length, width: checked.width, height: checked.height });
    await this.alert(chat, other(side), `${publicName(customer.name)} sent a photo about "${chat.listing.title}"`, message.body || 'A photo');
    return this.presentMessage(message, customer.id);
  }

  /** Blocks the other side in this chat: neither can write until it is unblocked. */
  async block(customer: CustomerWithStore, id: string, blocked: boolean) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const side = this.sideOf(chat, customer.id)!;
    const at = blocked ? new Date() : null;
    await this.prisma.classifiedConversation.update({ where: { id: chat.id }, data: side === 'buyer' ? { buyerBlockedAt: at } : { sellerBlockedAt: at } });
    if (blocked) await this.prisma.classifiedOffer.updateMany({ where: { conversationId: chat.id, status: 'open' }, data: { status: 'withdrawn', decidedAt: new Date() } });
    return this.get(customer, chat.id);
  }

  /** Reports the other person from the chat; moderators may then read it. */
  async report(customer: CustomerWithStore, id: string, input: { reason: ReportReason; details?: string }) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const side = this.sideOf(chat, customer.id)!;
    try {
      const report = await this.prisma.classifiedReport.create({
        data: { conversationId: chat.id, reportedCustomerId: side === 'buyer' ? chat.sellerId : chat.buyerId, reporterId: customer.id, reason: input.reason, details: input.details?.trim() || null },
      });
      return { object: 'classified_report' as const, id: report.id, status: report.status, reason: report.reason, created_at: report.createdAt.toISOString() };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('already_reported', 'You have already reported this chat. A moderator will look at it.');
      throw error;
    }
  }

  // ---- Offers ----

  /** A price offer from either side on a live listing; it replaces an open one and stays open 48 hours. */
  async makeOffer(customer: CustomerWithStore, id: string, price: number) {
    await this.listings.sellerCountry(customer);
    const chat = await this.chatFor(customer, id);
    const side = this.requireWritable(chat, customer.id);
    if (!isOnShop(chat.listing)) throw conflict('listing_unavailable', 'This listing is no longer live, so offers cannot be made.');
    if (!Number.isSafeInteger(price) || price <= 0 || price > Number(maxPriceMinor)) throw invalid('parameter_invalid', 'Offer a price above zero.', 'price');
    await this.requirePace(chat.id, customer.id);
    const now = new Date();
    let offer: OfferRow;
    try {
      offer = await this.prisma.$transaction(async tx => {
        await tx.classifiedOffer.updateMany({ where: { conversationId: chat.id, status: 'open' }, data: { status: 'replaced', decidedAt: now } });
        const created = await tx.classifiedOffer.create({
          data: { conversationId: chat.id, listingId: chat.listingId, madeById: customer.id, priceMinor: BigInt(price), currency: chat.listing.currency, expiresAt: new Date(now.getTime() + offerMs), createdAt: now },
        });
        await tx.classifiedMessage.create({ data: { conversationId: chat.id, senderId: customer.id, kind: 'offer', offerId: created.id, body: `Offered ${priceText(price, chat.listing.currency)}`, createdAt: now } });
        await tx.classifiedConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now, ...readNow(side, now), ...(side === 'seller' && !chat.sellerRepliedAt ? { sellerRepliedAt: now } : {}) } });
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('offer_changed', 'Another offer was just made in this chat. Refresh and try again.');
      throw error;
    }
    const recipient = side === 'buyer' ? chat.seller : chat.buyer;
    await this.inbox.customer({ customerId: recipient.id, storeId: recipient.storeId }, 'customer.classifieds.offer', {
      subject: offer.id,
      title: `${publicName(customer.name)} offered ${priceText(price, chat.listing.currency)}`,
      body: `For "${chat.listing.title}". Accept or decline it in the chat within 48 hours.`,
      link: `/account/messages/${chat.id}`,
    });
    return this.presentOffer(offer, customer.id);
  }

  /** The other side accepts an open offer: that is the agreed price (and what Safe pay starts from). */
  async acceptOffer(customer: CustomerWithStore, offerId: string) {
    return this.decide(customer, offerId, 'accepted');
  }

  async declineOffer(customer: CustomerWithStore, offerId: string) {
    return this.decide(customer, offerId, 'declined');
  }

  /** The side that made it takes it back. */
  async withdrawOffer(customer: CustomerWithStore, offerId: string) {
    return this.decide(customer, offerId, 'withdrawn');
  }

  private async decide(customer: CustomerWithStore, offerId: string, outcome: 'accepted' | 'declined' | 'withdrawn') {
    await this.listings.sellerCountry(customer);
    const offer = await this.prisma.classifiedOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw notFound('offer');
    const chat = await this.chatFor(customer, offer.conversationId).catch(() => {
      throw notFound('offer');
    });
    const side = this.sideOf(chat, customer.id)!;
    const mine = offer.madeById === customer.id;
    if (outcome === 'withdrawn' ? !mine : mine) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'offer_not_yours', outcome === 'withdrawn' ? 'Only the person who made an offer can withdraw it.' : 'The other person decides on this offer.');
    }
    if (outcome !== 'withdrawn') this.requireWritable(chat, customer.id);
    const now = new Date();
    if (offer.status !== 'open' || offer.expiresAt <= now) throw conflict('offer_closed', offer.status === 'open' || offer.status === 'expired' ? 'This offer has expired.' : `This offer was already ${offer.status}.`);
    if (outcome === 'accepted' && !isOnShop(chat.listing)) throw conflict('listing_unavailable', 'This listing is no longer live, so the offer cannot be accepted.');
    const verb = { accepted: 'accepted', declined: 'declined', withdrawn: 'withdrew' }[outcome];
    const amount = priceText(offer.priceMinor, offer.currency);
    const decided = await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedOffer.updateMany({ where: { id: offer.id, status: 'open', expiresAt: { gt: now } }, data: { status: outcome, decidedAt: now } });
      if (!claimed.count) return false;
      const note = outcome === 'withdrawn' ? `${publicName(customer.name)} withdrew the offer of ${amount}.` : `${publicName(customer.name)} ${verb} the offer of ${amount}.`;
      await tx.classifiedMessage.create({ data: { conversationId: chat.id, kind: 'system', offerId: offer.id, body: note, createdAt: now } });
      await tx.classifiedConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now, ...readNow(side, now), ...(side === 'seller' && !chat.sellerRepliedAt ? { sellerRepliedAt: now } : {}) } });
      return true;
    });
    if (!decided) throw conflict('offer_closed', 'This offer changed: refresh and try again.');
    if (outcome !== 'withdrawn') {
      const maker = side === 'buyer' ? chat.seller : chat.buyer;
      await this.inbox.customer({ customerId: maker.id, storeId: maker.storeId }, outcome === 'accepted' ? 'customer.classifieds.offer_accepted' : 'customer.classifieds.offer_declined', {
        subject: `${offer.id}:${outcome}`,
        title: `Your offer of ${amount} was ${outcome}`,
        body: outcome === 'accepted' ? `For "${chat.listing.title}". Agree how to pay and hand over in the chat, or use Safe pay.` : `For "${chat.listing.title}". You can make another offer in the chat.`,
        link: `/account/messages/${chat.id}`,
      });
    }
    return this.presentOffer(await this.prisma.classifiedOffer.findUniqueOrThrow({ where: { id: offer.id } }), customer.id);
  }

  // ---- The job ----

  /** Open offers past their time, or on listings no longer live, expire. */
  async expireOffers(now = new Date()) {
    const expired = await this.prisma.classifiedOffer.updateMany({ where: { status: 'open', OR: [{ expiresAt: { lte: now } }, { listing: { status: { not: 'active' } } }] }, data: { status: 'expired', decidedAt: now } });
    return { expired: expired.count };
  }

  /**
   * Emails each person whose messages have waited unread for 10 minutes, once per batch: a reply they have not read
   * since the last email does not send another.
   */
  async emailUnread(now = new Date()) {
    const cutoff = new Date(now.getTime() - emailAfterMs);
    const recent = new Date(now.getTime() - 7 * dayMs);
    const rows = await this.prisma.$queryRaw<{ id: string; side: Side; recipient_id: string; emailed_at: Date | null; unread: bigint }[]>`
      SELECT * FROM (
        SELECT c."id", 'buyer' AS side, c."buyer_id" AS recipient_id, c."buyer_emailed_at" AS emailed_at, min(m."created_at") AS first_unread, count(*) AS unread
        FROM "classified_conversations" c JOIN "classified_messages" m ON m."conversation_id" = c."id" AND m."sender_id" = c."seller_id"
        WHERE c."last_message_at" > ${recent} AND c."buyer_blocked_at" IS NULL AND m."created_at" > coalesce(c."buyer_read_at", 'epoch')
        GROUP BY c."id"
        UNION ALL
        SELECT c."id", 'seller', c."seller_id", c."seller_emailed_at", min(m."created_at"), count(*)
        FROM "classified_conversations" c JOIN "classified_messages" m ON m."conversation_id" = c."id" AND m."sender_id" = c."buyer_id"
        WHERE c."last_message_at" > ${recent} AND c."seller_blocked_at" IS NULL AND m."created_at" > coalesce(c."seller_read_at", 'epoch')
        GROUP BY c."id"
      ) x WHERE x.first_unread <= ${cutoff} AND (x.emailed_at IS NULL OR x.emailed_at < x.first_unread)
      ORDER BY x.first_unread LIMIT 500`;
    const byRecipient = new Map<string, { id: string; side: Side; unread: number }[]>();
    for (const row of rows) {
      const field = row.side === 'buyer' ? 'buyerEmailedAt' : 'sellerEmailedAt';
      const claimed = await this.prisma.classifiedConversation.updateMany({ where: { id: row.id, [field]: row.emailed_at }, data: { [field]: now } });
      if (!claimed.count) continue;
      byRecipient.set(row.recipient_id, [...(byRecipient.get(row.recipient_id) ?? []), { id: row.id, side: row.side, unread: Number(row.unread) }]);
    }
    let sent = 0;
    const link = `${this.integrations.config.STOREFRONT_URL.replace(/\/+$/, '')}/account/messages`;
    for (const [recipientId, chats] of byRecipient) {
      const recipient = await this.prisma.customer.findUnique({ where: { id: recipientId }, select: { email: true, name: true, emailVerifiedAt: true, status: true } });
      if (!recipient?.emailVerifiedAt || recipient.status !== 'active') continue;
      const details = await this.prisma.classifiedConversation.findMany({ where: { id: { in: chats.map(chat => chat.id) } }, select: { id: true, listing: { select: { title: true } }, buyer: { select: { name: true } }, seller: { select: { name: true } } } });
      const lines = chats.map(chat => {
        const row = details.find(item => item.id === chat.id)!;
        return { title: row.listing.title ?? 'your listing', from: publicName(chat.side === 'buyer' ? row.seller.name : row.buyer.name), unread: chat.unread };
      });
      try {
        await this.email.send(shopMessagesEmail(recipient.email, { name: recipient.name.split(/\s+/)[0], chats: lines, link }));
        sent += 1;
      } catch (error) {
        this.logger.warn({ err: error }, 'Could not email unread Udozo messages');
      }
    }
    return { emailed: sent };
  }

  /** Chats with no message for a year are deleted with their photos, unless a report keeps them. */
  async purgeOld(now = new Date()) {
    const old = await this.prisma.classifiedConversation.findMany({
      where: { lastMessageAt: { lt: new Date(now.getTime() - keepChatsMs) }, reports: { none: { status: 'open' } } },
      select: { id: true, messages: { where: { kind: 'photo' }, select: { objectKey: true } } },
      take: 100,
    });
    let deleted = 0;
    for (const chat of old) {
      try {
        for (const message of chat.messages) if (message.objectKey) await this.storage.remove(message.objectKey);
      } catch {
        continue;
      }
      await this.prisma.classifiedConversation.delete({ where: { id: chat.id } });
      deleted += 1;
    }
    return { deleted };
  }

  // ---- Moderators ----

  /** A reported chat in full, for a moderator: only chats someone has reported, and every read is audited. */
  async adminGet(actorId: string | null, id: string) {
    const chat = await this.reportedChat(id);
    const messages = await this.prisma.classifiedMessage.findMany({ where: { conversationId: chat.id }, include: { offer: true }, orderBy: { seq: 'asc' }, take: 1000 });
    await this.audit.record({ actorId, action: 'classifieds.conversation_viewed', targetType: 'classified_conversation', targetId: chat.id, before: null, after: { messages: messages.length } });
    const author = (senderId: string | null) => (senderId === null ? 'bitocard' : senderId === chat.buyerId ? 'buyer' : 'seller');
    return {
      object: 'classified_conversation_review' as const,
      id: chat.id,
      listing: this.presentListing(chat.listing),
      buyer: { id: chat.buyer.id, name: chat.buyer.name, email: chat.buyer.email },
      seller: { id: chat.seller.id, name: chat.seller.name, email: chat.seller.email },
      blocked: { by_buyer: Boolean(chat.buyerBlockedAt), by_seller: Boolean(chat.sellerBlockedAt) },
      reports: chat.reports.map(report => ({ id: report.id, reason: report.reason, details: report.details, status: report.status, by: report.reporterId === chat.buyerId ? 'buyer' : 'seller', created_at: report.createdAt.toISOString() })),
      messages: messages.map(message => ({ ...this.presentMessage(message, null), from: author(message.senderId), photo: message.objectKey ? this.photoOf(chat.id, message, `/v1/admin/classifieds/conversations/${chat.id}/photos/${message.id}`) : null })),
      created_at: chat.createdAt.toISOString(),
    };
  }

  async adminPhoto(actorId: string | null, id: string, messageId: string) {
    const chat = await this.reportedChat(id);
    await this.audit.record({ actorId, action: 'classifieds.conversation_photo_viewed', targetType: 'classified_conversation', targetId: chat.id, before: null, after: { message_id: messageId } });
    return this.readPhoto(chat.id, messageId);
  }

  private async reportedChat(id: string) {
    const chat = await this.prisma.classifiedConversation.findUnique({ where: { id }, include: { ...chatInclude, reports: { orderBy: { createdAt: 'asc' } } } });
    if (!chat) throw notFound();
    if (!chat.reports.length) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'conversation_not_reported', 'Chats are private: moderators read one only once it has been reported.');
    return chat;
  }

  // ---- Helpers ----

  private async chatFor(customer: CustomerWithStore, id: string) {
    const chat = await this.prisma.classifiedConversation.findUnique({ where: { id }, include: chatInclude });
    if (!chat || (chat.buyerId !== customer.id && chat.sellerId !== customer.id)) throw notFound();
    return chat;
  }

  private sideOf(chat: { buyerId: string; sellerId: string }, customerId: string): Side | null {
    return chat.buyerId === customerId ? 'buyer' : chat.sellerId === customerId ? 'seller' : null;
  }

  /** The writer's side, once nothing stops them writing. */
  private requireWritable(chat: ChatRow, customerId: string) {
    const side = this.sideOf(chat, customerId)!;
    if ((side === 'buyer' && chat.buyerBlockedAt) || (side === 'seller' && chat.sellerBlockedAt)) throw conflict('conversation_blocked', 'You blocked this person. Unblock them to write.');
    if (chat.buyerBlockedAt || chat.sellerBlockedAt) throw conflict('conversation_blocked', 'You can no longer write in this chat.');
    if (chat.listing.status === 'removed') throw conflict('listing_removed', 'Udozo removed this listing, so this chat is closed.');
    return side;
  }

  private async requirePace(chatId: string, customerId: string) {
    const recent = await this.prisma.classifiedMessage.count({ where: { conversationId: chatId, senderId: customerId, createdAt: { gt: new Date(Date.now() - minuteMs) } } });
    if (recent >= messagesPerMinute) throw tooFast('chat_rate_limited', 'You are sending messages very fast. Wait a moment, then send again.');
  }

  private async write(chat: ChatRow, side: Side, data: Omit<Prisma.ClassifiedMessageUncheckedCreateInput, 'conversationId' | 'senderId'>) {
    const now = new Date();
    const writer = side === 'buyer' ? chat.buyerId : chat.sellerId;
    const [message] = await this.prisma.$transaction([
      this.prisma.classifiedMessage.create({ data: { ...data, conversationId: chat.id, senderId: writer, createdAt: now }, include: { offer: true } }),
      this.prisma.classifiedConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now, ...readNow(side, now), ...(side === 'seller' && !chat.sellerRepliedAt ? { sellerRepliedAt: now } : {}) } }),
    ]);
    return message;
  }

  /** Tells the other side in the app, at most once every 10 minutes per chat (and never someone who blocked the writer). */
  private async alert(chat: ChatRow, to: Side, title: string, body: string) {
    if (to === 'buyer' ? chat.buyerBlockedAt : chat.sellerBlockedAt) return;
    const field = to === 'buyer' ? 'buyerAlertedAt' : 'sellerAlertedAt';
    const now = new Date();
    const claimed = await this.prisma.classifiedConversation.updateMany({
      where: { id: chat.id, OR: [{ [field]: null }, { [field]: { lte: new Date(now.getTime() - alertEveryMs) } }] },
      data: { [field]: now },
    });
    if (!claimed.count) return;
    const recipient = to === 'buyer' ? chat.buyer : chat.seller;
    await this.inbox.customer({ customerId: recipient.id, storeId: recipient.storeId }, 'customer.classifieds.message', {
      subject: `${chat.id}:${now.getTime()}`,
      title,
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      link: `/account/messages/${chat.id}`,
    });
  }

  private async seqOf(chatId: string, messageId: string, param: 'after' | 'before') {
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw invalid('parameter_invalid', 'Give a message id.', param);
    const message = await this.prisma.classifiedMessage.findFirst({ where: { id: messageId, conversationId: chatId }, select: { seq: true } });
    if (!message) throw invalid('parameter_invalid', 'No such message in this chat.', param);
    return message.seq;
  }

  private async unreadIn(customerId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.prisma.$queryRaw<{ id: string; n: bigint }[]>`
      SELECT c."id", count(m."id") AS n FROM "classified_conversations" c
      JOIN "classified_messages" m ON m."conversation_id" = c."id"
      WHERE c."id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
        AND ((c."buyer_id" = ${customerId}::uuid AND m."sender_id" = c."seller_id" AND m."created_at" > coalesce(c."buyer_read_at", 'epoch'))
          OR (c."seller_id" = ${customerId}::uuid AND m."sender_id" = c."buyer_id" AND m."created_at" > coalesce(c."seller_read_at", 'epoch')))
      GROUP BY c."id"`;
    return new Map(rows.map(row => [row.id, Number(row.n)]));
  }

  private async readPhoto(chatId: string, messageId: string) {
    const message = await this.prisma.classifiedMessage.findFirst({ where: { id: messageId, conversationId: chatId, kind: 'photo' } });
    if (!message?.objectKey) throw notFound('photo');
    const bytes = await this.storage.get(message.objectKey);
    if (!bytes) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'file_gone', 'This photo is no longer kept.');
    return { contentType: message.contentType ?? 'image/jpeg', bytes, name: `photo.${message.contentType === 'image/png' ? 'png' : 'jpg'}` };
  }

  private presentListing(listing: ChatRow['listing']) {
    return {
      id: listing.id,
      ref: Number(listing.ref),
      title: listing.title,
      slug: listing.slug,
      status: listing.status,
      country: listing.country,
      price: { kind: listing.priceKind, amount: listing.priceMinor === null ? null : Number(listing.priceMinor), currency: listing.currency },
      cover_url: listing.media[0]?.url ?? null,
    };
  }

  private present(chat: ChatRow, viewerId: string, unread: number) {
    const side = this.sideOf(chat, viewerId)!;
    const them = side === 'buyer' ? chat.seller : chat.buyer;
    const last = chat.messages[0];
    const offer = chat.offers[0];
    return {
      object: 'classified_conversation' as const,
      id: chat.id,
      role: side,
      listing: this.presentListing(chat.listing),
      with: { name: publicName(them.name) },
      last_message: last ? { kind: last.kind, body: last.kind === 'photo' && !last.body ? 'Photo' : last.body.slice(0, 140), from: last.senderId === null ? 'bitocard' : last.senderId === viewerId ? 'me' : 'them', created_at: last.createdAt.toISOString() } : null,
      unread,
      open_offer: offer ? this.presentOffer(offer, viewerId) : null,
      blocked: { by_me: Boolean(side === 'buyer' ? chat.buyerBlockedAt : chat.sellerBlockedAt), by_them: Boolean(side === 'buyer' ? chat.sellerBlockedAt : chat.buyerBlockedAt) },
      last_message_at: chat.lastMessageAt.toISOString(),
      created_at: chat.createdAt.toISOString(),
    };
  }

  private photoOf(chatId: string, message: { id: string; contentType: string | null; size: number | null; width: number | null; height: number | null }, url = `/v1/classifieds/conversations/${chatId}/photos/${message.id}`) {
    return { url, content_type: message.contentType, size: message.size, width: message.width, height: message.height };
  }

  private presentMessage(message: MessageRow, viewerId: string | null) {
    return {
      object: 'classified_message' as const,
      id: message.id,
      kind: message.kind,
      from: message.senderId === null ? 'bitocard' : message.senderId === viewerId ? 'me' : 'them',
      body: message.body,
      photo: message.objectKey ? this.photoOf(message.conversationId, message) : null,
      offer: message.offer && message.kind === 'offer' ? this.presentOffer(message.offer, viewerId) : null,
      created_at: message.createdAt.toISOString(),
    };
  }

  private presentOffer(offer: OfferRow, viewerId: string | null) {
    const status = offer.status === 'open' && offer.expiresAt <= new Date() ? 'expired' : offer.status;
    return {
      object: 'classified_offer' as const,
      id: offer.id,
      price: { amount: Number(offer.priceMinor), currency: offer.currency },
      status,
      made_by: viewerId === null ? offer.madeById : offer.madeById === viewerId ? 'me' : 'them',
      expires_at: offer.expiresAt.toISOString(),
      decided_at: offer.decidedAt?.toISOString() ?? null,
      created_at: offer.createdAt.toISOString(),
    };
  }
}

const other = (side: Side): Side => (side === 'buyer' ? 'seller' : 'buyer');
const readNow = (side: Side, now: Date) => (side === 'buyer' ? { buyerReadAt: now } : { sellerReadAt: now });

