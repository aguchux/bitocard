import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, ResaleDeal } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { type EmailThrottle, ShopEmails } from '../classifieds/shop-emails.service.js';
import { ResaleService } from '../classifieds/resale.service.js';
import { invalid } from '../classifieds/rules.js';
import { publicName } from '../classifieds/search.service.js';

export const maxMessage = 2000;
const maxOpenOffers = 5;
const maxDealDays = 366;
const day = 24 * 60 * 60 * 1000;

export const dealStatuses = ['offered', 'active', 'declined', 'withdrawn', 'ended'] as const;
type Side = 'supplier' | 'reseller';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

const relationshipInclude = {
  supplier: { select: { id: true, name: true, createdAt: true, phone: true, phoneVerifiedAt: true, storeId: true } },
  reseller: { select: { id: true, name: true, status: true, members: { where: { role: 'owner' }, take: 1, select: { user: { select: { phone: true, phoneVerifiedAt: true } } } } } },
} satisfies Prisma.ResaleRelationshipInclude;
type RelationshipRow = Prisma.ResaleRelationshipGetPayload<{ include: typeof relationshipInclude }>;

const pct = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
const dateText = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * B2B reselling, stage 2: suppliers and the resellers carrying their listings (My Resellers). One relationship per
 * supplier and reseller, made when the reseller first adds a listing or writes to them, with a chat, each side's
 * confirmed phone number shown to the other, and deals: better terms the supplier offers in the chat and the reseller
 * accepts (a bigger discount and a floor below the price), ended by either. The supplier approves or refuses the
 * reseller's notes and can stop a reseller selling their listings at any time.
 */
@Injectable()
export class ResaleTradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resale: ResaleService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
  ) {}

  // ---- Used by the stores service ----

  /** Running deals of a reseller with each supplier. */
  async dealsFor(resellerId: string, supplierIds: string[]) {
    const map = new Map<string, ResaleDeal[]>();
    if (!supplierIds.length) return map;
    const rows = await this.prisma.resaleDeal.findMany({ where: { status: 'active', relationship: { resellerId, supplierId: { in: supplierIds } } }, include: { relationship: { select: { supplierId: true } } } });
    for (const row of rows) map.set(row.relationship.supplierId, [...(map.get(row.relationship.supplierId) ?? []), row]);
    return map;
  }

  /** Suppliers who stopped this reseller selling their listings. */
  async blockedSuppliers(resellerId: string) {
    const rows = await this.prisma.resaleRelationship.findMany({ where: { resellerId, supplierBlockedAt: { not: null } }, select: { supplierId: true } });
    return rows.map(row => row.supplierId);
  }

  /** The relationship, made on first use (`created`). */
  async relationshipFor(resellerId: string, supplierId: string) {
    const existing = await this.prisma.resaleRelationship.findUnique({ where: { supplierId_resellerId: { supplierId, resellerId } } });
    if (existing) return { ...existing, created: false };
    try {
      return { ...(await this.prisma.resaleRelationship.create({ data: { supplierId, resellerId } })), created: true };
    } catch {
      // Made by a parallel request.
      return { ...(await this.prisma.resaleRelationship.findUniqueOrThrow({ where: { supplierId_resellerId: { supplierId, resellerId } } })), created: false };
    }
  }

  private async tellSupplier(relationshipId: string, type: 'customer.resale.reseller_added' | 'customer.resale.message' | 'customer.resale.note_pending' | 'customer.resale.deal_answered', subject: string, title: string, body: string) {
    const row = await this.prisma.resaleRelationship.findUnique({ where: { id: relationshipId }, select: { supplier: { select: { id: true, storeId: true } } } });
    if (!row) return;
    await this.inbox.customer({ customerId: row.supplier.id, storeId: row.supplier.storeId }, type, { subject, title, body, link: `/shop/resellers/${relationshipId}` });
    const message = type === 'customer.resale.message';
    this.emails.customer(row.supplier.id, {
      title,
      body: message ? 'Open the chat to read it and reply.' : body,
      path: `/shop/resellers/${relationshipId}`,
      action: 'Open My Resellers',
      throttle: message ? { model: 'resaleRelationship', id: relationshipId, field: 'supplierEmailedAt' } : undefined,
    });
  }

  /** Tells the reseller in SHQ and emails their owner (a message without its text, at most every 10 minutes). */
  private async tellReseller(resellerId: string, type: Parameters<InboxService['reseller']>[1], content: Parameters<InboxService['reseller']>[2], throttle?: EmailThrottle) {
    await this.inbox.reseller(resellerId, type, content);
    this.emails.reseller(resellerId, { title: content.title, body: throttle ? 'Open the chat to read it and reply.' : content.body, path: content.link ?? '/resale/suppliers', throttle });
  }

  async tellSupplierAdded(relationshipId: string) {
    const row = await this.prisma.resaleRelationship.findUniqueOrThrow({ where: { id: relationshipId }, select: { reseller: { select: { name: true } } } });
    await this.tellSupplier(relationshipId, 'customer.resale.reseller_added', relationshipId, `${row.reseller.name} is reselling your listings`, 'See their stores, chat with them and agree deals in My Resellers.');
  }

  async tellSupplierNote(relationshipId: string, storeListingId: string, title: string, submittedAt: Date) {
    await this.tellSupplier(relationshipId, 'customer.resale.note_pending', `${storeListingId}:${submittedAt.getTime()}`, 'A reseller’s note needs your approval', `A reseller wants to add a note to “${title}”. It shows only once you approve it.`);
  }

  /** Deals past their end date end (`ended_by: expired`), with a line in the chat and the reseller told. */
  async endExpired() {
    const due = await this.prisma.resaleDeal.findMany({ where: { status: 'active', endsAt: { lte: new Date() } }, select: { id: true } });
    let ended = 0;
    for (const deal of due) {
      const claimed = await this.prisma.resaleDeal.updateMany({ where: { id: deal.id, status: 'active' }, data: { status: 'ended', endedAt: new Date(), endedBy: 'expired' } });
      if (!claimed.count) continue;
      ended += 1;
      const row = await this.prisma.resaleDeal.findUniqueOrThrow({ where: { id: deal.id }, include: { listing: { select: { title: true } }, relationship: { select: { resellerId: true } } } });
      await this.system(row.relationshipId, `Deal ended at its end date: ${this.dealText(row)}.`, row.id);
      await this.tellReseller(row.relationship.resellerId, 'resale.deal_ended', { subject: row.id, title: 'A supplier deal ended', body: `Its end date passed: ${this.dealText(row)}.`, link: `/resale/suppliers/${row.relationshipId}` });
    }
    return ended;
  }

  // ---- Presenting ----

  private dealText(deal: { discountBps: number; floorBps: number; endsAt: Date | null; listing?: { title: string | null } | null }) {
    return [
      `${pct(deal.discountBps)} off ${deal.listing ? `“${deal.listing.title ?? 'one listing'}”` : 'every listing'}`,
      deal.floorBps ? `selling from ${pct(deal.floorBps)} below the price` : null,
      deal.endsAt ? `until ${dateText(deal.endsAt)}` : null,
    ]
      .filter(Boolean)
      .join(', ');
  }

  presentDeal(deal: ResaleDeal & { listing?: { id: string; title: string | null } | null }) {
    return {
      object: 'resale_deal' as const,
      id: deal.id,
      supplier_relationship_id: deal.relationshipId,
      listing: deal.listing ? { id: deal.listing.id, title: deal.listing.title ?? '' } : null,
      discount_bps: deal.discountBps,
      floor_bps: deal.floorBps,
      status: deal.status as (typeof dealStatuses)[number],
      ends_at: deal.endsAt?.toISOString() ?? null,
      responded_at: deal.respondedAt?.toISOString() ?? null,
      ended_at: deal.endedAt?.toISOString() ?? null,
      ended_by: deal.endedBy,
      created_at: deal.createdAt.toISOString(),
    };
  }

  private readonly dealInclude = { listing: { select: { id: true, title: true } } } as const;

  private async unread(rows: { id: string; supplierReadAt: Date | null; resellerReadAt: Date | null }[], side: Side) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const readAt = side === 'supplier' ? row.supplierReadAt : row.resellerReadAt;
      counts.set(row.id, await this.prisma.resaleMessage.count({ where: { relationshipId: row.id, author: { in: side === 'supplier' ? ['reseller', 'system'] : ['supplier', 'system'] }, ...(readAt ? { createdAt: { gt: readAt } } : {}) } }));
    }
    return counts;
  }

  private resellerPhone(row: RelationshipRow) {
    const owner = row.reseller.members[0]?.user;
    return owner?.phoneVerifiedAt && owner.phone ? owner.phone : null;
  }

  private closed(row: { supplierBlockedAt: Date | null; resellerBlockedAt: Date | null }) {
    return Boolean(row.supplierBlockedAt || row.resellerBlockedAt);
  }

  // ---- Reseller side ----

  private async forReseller(resellerId: string, id: string) {
    const row = await this.prisma.resaleRelationship.findFirst({ where: { id, resellerId }, include: relationshipInclude });
    if (!row) throw notFound('supplier');
    return row;
  }

  private async presentForReseller(rows: RelationshipRow[]) {
    const ids = rows.map(row => row.id);
    const [unread, deals, carried, checked] = await Promise.all([
      this.unread(rows, 'reseller'),
      this.prisma.resaleDeal.findMany({ where: { relationshipId: { in: ids }, status: { in: ['offered', 'active'] } }, include: this.dealInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.resaleListing.groupBy({ by: ['relationshipId'], where: { relationshipId: { in: ids }, status: { not: 'removed' } }, _count: { _all: true } }),
      this.prisma.identityVerification.findMany({ where: { subject: 'customer', mode: 'live', status: 'approved', customerReference: { in: rows.map(row => row.supplierId) } }, select: { customerReference: true } }),
    ]);
    const idChecked = new Set(checked.map(row => row.customerReference));
    return rows.map(row => ({
      object: 'resale_supplier' as const,
      id: row.id,
      supplier: {
        id: row.supplier.id,
        name: publicName(row.supplier.name),
        member_since: row.supplier.createdAt.toISOString(),
        badges: [...(row.supplier.phoneVerifiedAt ? ['phone_confirmed'] : []), ...(idChecked.has(row.supplier.id) ? ['id_checked'] : [])],
        /** Their confirmed phone number, shown to resellers they work with (never once either side has closed the chat). */
        phone: !this.closed(row) && row.supplier.phoneVerifiedAt ? row.supplier.phone : null,
      },
      stopped_by_supplier: Boolean(row.supplierBlockedAt),
      closed_by_you: Boolean(row.resellerBlockedAt),
      listings_in_stores: carried.find(item => item.relationshipId === row.id)?._count._all ?? 0,
      unread: unread.get(row.id) ?? 0,
      deals: deals.filter(deal => deal.relationshipId === row.id).map(deal => this.presentDeal(deal)),
      last_message_at: row.lastMessageAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async suppliers(resellerId: string) {
    const rows = await this.prisma.resaleRelationship.findMany({ where: { resellerId }, include: relationshipInclude, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200 });
    return { object: 'list' as const, data: await this.presentForReseller(rows) };
  }

  async supplier(resellerId: string, id: string) {
    const [item] = await this.presentForReseller([await this.forReseller(resellerId, id)]);
    return item;
  }

  /** `POST /v1/resale/suppliers`: start working with a supplier who has a resale listing in the reseller's country. */
  async start(resellerId: string, country: string, supplierId: string) {
    const listing = await this.prisma.classifiedListing.findFirst({ where: { customerId: supplierId, country, status: 'active', resale: true }, select: { id: true } });
    if (!listing) throw notFound('supplier');
    const relationship = await this.relationshipFor(resellerId, supplierId);
    if (relationship.created) await this.tellSupplierAdded(relationship.id);
    return this.supplier(resellerId, relationship.id);
  }

  async setResellerClosed(resellerId: string, id: string, closed: boolean) {
    const row = await this.forReseller(resellerId, id);
    await this.prisma.resaleRelationship.update({ where: { id: row.id }, data: { resellerBlockedAt: closed ? new Date() : null } });
    return this.supplier(resellerId, id);
  }

  /** The reseller answers an offered deal; accepting replaces their running deal for the same listing (or all). */
  async answerDeal(resellerId: string, dealId: string, answer: 'accept' | 'decline') {
    const deal = await this.prisma.resaleDeal.findFirst({ where: { id: dealId, relationship: { resellerId } }, include: this.dealInclude });
    if (!deal) throw notFound('deal');
    if (deal.status !== 'offered') throw conflict('deal_not_offered', 'This deal is no longer waiting for an answer.');
    if (answer === 'accept' && deal.endsAt && deal.endsAt.getTime() <= Date.now()) throw conflict('deal_expired', 'This deal’s end date has passed.');
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      if (answer === 'accept') {
        await tx.resaleDeal.updateMany({ where: { relationshipId: deal.relationshipId, listingId: deal.listingId, status: 'active' }, data: { status: 'ended', endedAt: now, endedBy: 'replaced' } });
      }
      const claimed = await tx.resaleDeal.updateMany({ where: { id: deal.id, status: 'offered' }, data: { status: answer === 'accept' ? 'active' : 'declined', respondedAt: now } });
      if (!claimed.count) throw conflict('deal_not_offered', 'This deal is no longer waiting for an answer.');
    });
    const text = this.dealText(deal);
    await this.system(deal.relationshipId, `${answer === 'accept' ? 'Deal accepted' : 'Deal declined'}: ${text}.`, deal.id);
    await this.tellSupplier(deal.relationshipId, 'customer.resale.deal_answered', `${deal.id}:${answer}`, answer === 'accept' ? 'A reseller accepted your deal' : 'A reseller declined your deal', `${text}.`);
    return this.presentDeal(await this.prisma.resaleDeal.findUniqueOrThrow({ where: { id: deal.id }, include: this.dealInclude }));
  }

  async resellerEndsDeal(resellerId: string, dealId: string) {
    const deal = await this.prisma.resaleDeal.findFirst({ where: { id: dealId, relationship: { resellerId } }, include: this.dealInclude });
    if (!deal) throw notFound('deal');
    return this.endDeal(deal, 'reseller');
  }

  // ---- Messages (either side) ----

  private presentMessage(message: { id: string; author: string; userId: string | null; body: string; dealId: string | null; createdAt: Date }, names: { supplier: string; reseller: string; people: Map<string, string> }, side: Side, deals: Map<string, ReturnType<ResaleTradeService['presentDeal']>>) {
    const name = message.author === 'system' ? 'BitoCard' : message.author === 'supplier' ? names.supplier : side === 'reseller' && message.userId ? (names.people.get(message.userId) ?? names.reseller) : names.reseller;
    return {
      object: 'resale_message' as const,
      id: message.id,
      author: message.author as Side | 'system',
      author_name: name,
      mine: message.author === side,
      body: message.body,
      deal: message.dealId ? (deals.get(message.dealId) ?? null) : null,
      created_at: message.createdAt.toISOString(),
    };
  }

  private async messages(row: RelationshipRow, side: Side, after?: string) {
    const since = after ? await this.prisma.resaleMessage.findFirst({ where: { id: after, relationshipId: row.id }, select: { createdAt: true } }) : null;
    const rows = await this.prisma.resaleMessage.findMany({
      where: { relationshipId: row.id, ...(since ? { createdAt: { gt: since.createdAt } } : {}) },
      orderBy: { createdAt: since ? 'asc' : 'desc' },
      take: 100,
    });
    if (!since) rows.reverse();
    const [people, deals] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.map(item => item.userId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } }),
      this.prisma.resaleDeal.findMany({ where: { id: { in: rows.map(item => item.dealId).filter((id): id is string => Boolean(id)) } }, include: this.dealInclude }),
    ]);
    await this.prisma.resaleRelationship.update({ where: { id: row.id }, data: side === 'supplier' ? { supplierReadAt: new Date() } : { resellerReadAt: new Date() } });
    const names = { supplier: publicName(row.supplier.name), reseller: row.reseller.name, people: new Map(people.map(person => [person.id, person.name])) };
    const dealMap = new Map(deals.map(deal => [deal.id, this.presentDeal(deal)]));
    return { object: 'list' as const, data: rows.map(message => this.presentMessage(message, names, side, dealMap)), closed: this.closed(row) };
  }

  private async post(row: RelationshipRow, side: Side, body: string, userId: string | null) {
    if (this.closed(row)) throw conflict('chat_closed', row.supplierBlockedAt ? 'The supplier has stopped working with this reseller.' : 'This chat was closed.');
    const text = body.replace(/\r\n?/g, '\n').trim();
    if (!text || text.length > maxMessage) throw invalid('parameter_invalid', `A message has 1 to ${maxMessage} characters.`, 'body');
    const now = new Date();
    const message = await this.prisma.resaleMessage.create({ data: { relationshipId: row.id, author: side, userId, body: text, createdAt: now } });
    await this.prisma.resaleRelationship.update({ where: { id: row.id }, data: { lastMessageAt: now, ...(side === 'supplier' ? { supplierReadAt: now } : { resellerReadAt: now }) } });
    // At most one notice until the other side reads the chat.
    if (side === 'reseller') {
      await this.tellSupplier(row.id, 'customer.resale.message', `${row.id}:${row.supplierReadAt?.getTime() ?? 0}`, `New message from ${row.reseller.name}`, text.slice(0, 140));
    } else {
      await this.tellReseller(row.resellerId, 'resale.message_received', { subject: `${row.id}:${row.resellerReadAt?.getTime() ?? 0}`, title: `New message from ${publicName(row.supplier.name)}`, body: text.slice(0, 140), link: `/resale/suppliers/${row.id}` }, { model: 'resaleRelationship', id: row.id, field: 'resellerEmailedAt' });
    }
    const people = userId ? await this.prisma.user.findMany({ where: { id: userId }, select: { id: true, name: true } }) : [];
    return this.presentMessage(message, { supplier: publicName(row.supplier.name), reseller: row.reseller.name, people: new Map(people.map(person => [person.id, person.name])) }, side, new Map());
  }

  private async system(relationshipId: string, body: string, dealId: string | null) {
    const now = new Date();
    await this.prisma.resaleMessage.create({ data: { relationshipId, author: 'system', body, dealId, createdAt: now } });
    await this.prisma.resaleRelationship.update({ where: { id: relationshipId }, data: { lastMessageAt: now } });
  }

  async resellerMessages(resellerId: string, id: string, after?: string) {
    return this.messages(await this.forReseller(resellerId, id), 'reseller', after);
  }

  async resellerSends(resellerId: string, id: string, body: string, userId: string | null) {
    return this.post(await this.forReseller(resellerId, id), 'reseller', body, userId);
  }

  // ---- Supplier side (My Resellers) ----

  private async forSupplier(customer: CustomerWithStore, id: string) {
    const row = await this.prisma.resaleRelationship.findFirst({ where: { id, supplierId: customer.id }, include: relationshipInclude });
    if (!row) throw notFound('reseller');
    return row;
  }

  private async presentForSupplier(rows: RelationshipRow[], detail = false) {
    const ids = rows.map(row => row.id);
    const supplierId = rows[0]?.supplierId;
    const [unread, deals, carried, pending, sales] = await Promise.all([
      this.unread(rows, 'supplier'),
      this.prisma.resaleDeal.findMany({ where: { relationshipId: { in: ids }, status: { in: ['offered', 'active'] } }, include: this.dealInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.resaleListing.findMany({
        where: { relationshipId: { in: ids }, status: { not: 'removed' } },
        include: { store: { select: { id: true, name: true, subdomain: true } }, listing: { select: { id: true, title: true, priceMinor: true, currency: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.resaleListing.groupBy({ by: ['relationshipId'], where: { relationshipId: { in: ids }, noteStatus: 'pending', status: { not: 'removed' } }, _count: { _all: true } }),
      // What each reseller has sold of the supplier's: orders by state and what the supplier was paid (B2B reselling stage 5).
      supplierId
        ? this.prisma.classifiedOrder.groupBy({ by: ['resellerId', 'status', 'currency'], where: { sellerId: supplierId, kind: 'resale', resellerId: { in: rows.map(row => row.resellerId) } }, _count: { _all: true }, _sum: { sellerPayoutMinor: true } })
        : [],
    ]);
    return rows.map(row => {
      const mine = carried.filter(item => item.relationshipId === row.id);
      const stores = [...new Map(mine.map(item => [item.store.id, item.store])).values()];
      return {
        object: 'resale_reseller' as const,
        id: row.id,
        reseller: {
          id: row.reseller.id,
          name: row.reseller.name,
          verified: row.reseller.status === 'active',
          phone: !this.closed(row) ? this.resellerPhone(row) : null,
        },
        stores: stores.map(store => ({ id: store.id, name: store.name, url: `https://${store.subdomain}.bitocard.com` })),
        stopped: Boolean(row.supplierBlockedAt),
        closed_by_reseller: Boolean(row.resellerBlockedAt),
        listings_carried: mine.length,
        sales: salesOf(sales.filter(item => item.resellerId === row.resellerId)),
        notes_pending: pending.find(item => item.relationshipId === row.id)?._count._all ?? 0,
        unread: unread.get(row.id) ?? 0,
        deals: deals.filter(deal => deal.relationshipId === row.id).map(deal => this.presentDeal(deal)),
        listings: detail
          ? mine.map(item => ({
              id: item.id,
              store_id: item.storeId,
              listing: { id: item.listing.id, title: item.listing.title ?? '' },
              status: item.status,
              note: item.note === null ? null : { text: item.note, status: item.noteStatus!, reason: item.noteReason, submitted_at: item.noteSubmittedAt?.toISOString() ?? null },
            }))
          : undefined,
        last_message_at: row.lastMessageAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  async resellers(customer: CustomerWithStore) {
    const rows = await this.prisma.resaleRelationship.findMany({ where: { supplierId: customer.id }, include: relationshipInclude, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200 });
    return { object: 'list' as const, data: await this.presentForSupplier(rows) };
  }

  async reseller(customer: CustomerWithStore, id: string) {
    const [item] = await this.presentForSupplier([await this.forSupplier(customer, id)], true);
    return item;
  }

  async supplierMessages(customer: CustomerWithStore, id: string, after?: string) {
    return this.messages(await this.forSupplier(customer, id), 'supplier', after);
  }

  async supplierSends(customer: CustomerWithStore, id: string, body: string) {
    return this.post(await this.forSupplier(customer, id), 'supplier', body, null);
  }

  /** Stop (or let again) this reseller selling the supplier's listings: every store of theirs stops at once. */
  async setStopped(customer: CustomerWithStore, id: string, stopped: boolean) {
    const row = await this.forSupplier(customer, id);
    if (Boolean(row.supplierBlockedAt) !== stopped) {
      await this.prisma.resaleRelationship.update({ where: { id: row.id }, data: { supplierBlockedAt: stopped ? new Date() : null } });
      if (stopped) {
        await this.prisma.resaleDeal.updateMany({ where: { relationshipId: row.id, status: { in: ['offered', 'active'] } }, data: { status: 'ended', endedAt: new Date(), endedBy: 'supplier' } });
        await this.tellReseller(row.resellerId, 'resale.supplier_stopped', {
          subject: `${row.id}:${Date.now()}`,
          title: `${publicName(row.supplier.name)} stopped you reselling their listings`,
          body: 'Their listings are off your stores. Your chat with them is closed.',
          link: `/resale/suppliers/${row.id}`,
        });
      }
    }
    return this.reseller(customer, id);
  }

  /** The supplier offers this reseller better terms on one listing or all of them. */
  async offerDeal(customer: CustomerWithStore, country: string, id: string, input: { listing_id?: string | null; discount_bps: number; floor_bps?: number; ends_at?: string | null }) {
    const row = await this.forSupplier(customer, id);
    if (this.closed(row)) throw conflict('chat_closed', 'This chat is closed.');
    const limits = await this.resale.limits(country);
    if (input.discount_bps < limits.discountMinBps || input.discount_bps > limits.discountMaxBps) {
      throw invalid('resale_discount_out_of_range', `A deal’s discount must be from ${pct(limits.discountMinBps)} to ${pct(limits.discountMaxBps)} in this country.`, 'discount_bps');
    }
    const floor = input.floor_bps ?? 0;
    if (floor < 0 || floor > input.discount_bps) throw invalid('parameter_invalid', 'The floor can be at most the deal’s discount below your price.', 'floor_bps');
    const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now() || endsAt.getTime() > Date.now() + maxDealDays * day)) {
      throw invalid('parameter_invalid', `The end date must be in the next ${maxDealDays} days.`, 'ends_at');
    }
    if (input.listing_id) {
      const listing = await this.prisma.classifiedListing.findFirst({ where: { id: input.listing_id, customerId: customer.id, resale: true }, select: { id: true } });
      if (!listing) throw invalid('parameter_invalid', 'Choose one of your listings open to resellers.', 'listing_id');
    }
    if ((await this.prisma.resaleDeal.count({ where: { relationshipId: row.id, status: 'offered' } })) >= maxOpenOffers) throw conflict('too_many_offers', `At most ${maxOpenOffers} deals can wait for an answer.`);
    const deal = await this.prisma.resaleDeal.create({ data: { relationshipId: row.id, listingId: input.listing_id ?? null, discountBps: input.discount_bps, floorBps: floor, endsAt }, include: this.dealInclude });
    const text = this.dealText(deal);
    await this.system(row.id, `Deal offered: ${text}.`, deal.id);
    await this.tellReseller(row.resellerId, 'resale.deal_offered', { subject: deal.id, title: `${publicName(row.supplier.name)} offered you a deal`, body: `${text}.`, link: `/resale/suppliers/${row.id}` });
    return this.presentDeal(deal);
  }

  async withdrawDeal(customer: CustomerWithStore, dealId: string) {
    const deal = await this.prisma.resaleDeal.findFirst({ where: { id: dealId, relationship: { supplierId: customer.id } }, include: this.dealInclude });
    if (!deal) throw notFound('deal');
    if (deal.status === 'offered') {
      const claimed = await this.prisma.resaleDeal.updateMany({ where: { id: deal.id, status: 'offered' }, data: { status: 'withdrawn', endedAt: new Date(), endedBy: 'supplier' } });
      if (!claimed.count) throw conflict('deal_not_offered', 'This deal was answered meanwhile.');
      await this.system(deal.relationshipId, `Deal withdrawn: ${this.dealText(deal)}.`, deal.id);
      return this.presentDeal(await this.prisma.resaleDeal.findUniqueOrThrow({ where: { id: deal.id }, include: this.dealInclude }));
    }
    return this.endDeal(deal, 'supplier');
  }

  private async endDeal(deal: ResaleDeal & { listing: { id: string; title: string | null } | null }, by: Side) {
    const claimed = await this.prisma.resaleDeal.updateMany({ where: { id: deal.id, status: 'active' }, data: { status: 'ended', endedAt: new Date(), endedBy: by } });
    if (!claimed.count) throw conflict('deal_not_active', 'This deal is not running.');
    const text = this.dealText(deal);
    await this.system(deal.relationshipId, `Deal ended by the ${by}: ${text}.`, deal.id);
    if (by === 'supplier') {
      const row = await this.prisma.resaleRelationship.findUniqueOrThrow({ where: { id: deal.relationshipId }, select: { resellerId: true } });
      await this.tellReseller(row.resellerId, 'resale.deal_ended', { subject: `${deal.id}:ended`, title: 'A supplier ended a deal', body: `${text}. New orders use the listing’s own terms; check your prices.`, link: `/resale/suppliers/${deal.relationshipId}` });
    } else {
      await this.tellSupplier(deal.relationshipId, 'customer.resale.deal_answered', `${deal.id}:ended`, 'A reseller ended a deal', `${text}.`);
    }
    return this.presentDeal(await this.prisma.resaleDeal.findUniqueOrThrow({ where: { id: deal.id }, include: this.dealInclude }));
  }

  /** The supplier approves the note exactly as they read it, refuses it with a reason, or takes back an approval. */
  async decideNote(customer: CustomerWithStore, storeListingId: string, decision: 'approve' | 'refuse' | 'withdraw', input: { note?: string; reason?: string }) {
    const row = await this.prisma.resaleListing.findFirst({ where: { id: storeListingId, relationship: { supplierId: customer.id } }, include: { listing: { select: { title: true } } } });
    if (!row || row.note === null) throw notFound('note');
    const from = decision === 'withdraw' ? 'approved' : 'pending';
    if (row.noteStatus !== from) throw conflict('note_not_pending', decision === 'withdraw' ? 'Only an approved note can be withdrawn.' : 'This note is not waiting for your decision.');
    if (decision === 'approve' && input.note !== row.note) throw conflict('note_changed', 'The reseller changed this note; read it again before approving.', 'note');
    const status = decision === 'approve' ? 'approved' : decision === 'refuse' ? 'refused' : 'withdrawn';
    const claimed = await this.prisma.resaleListing.updateMany({
      where: { id: row.id, noteStatus: from, note: row.note },
      data: { noteStatus: status, noteReason: decision === 'approve' ? null : (input.reason?.trim() || null), noteDecidedAt: new Date() },
    });
    if (!claimed.count) throw conflict('note_changed', 'The reseller changed this note; read it again.', 'note');
    await this.tellReseller(row.resellerId, 'resale.note_decided', {
      subject: `${row.id}:${Date.now()}`,
      title: decision === 'approve' ? 'Your note was approved' : decision === 'refuse' ? 'Your note was refused' : 'The supplier withdrew their approval of your note',
      body: `${row.listing.title ?? 'A listing'}${input.reason ? `: ${input.reason.trim()}` : ''}`,
      link: `/resale/listings/${row.id}`,
    });
    return this.reseller(customer, row.relationshipId);
  }
}

/** A reseller's sales of one supplier's listings: orders open, completed and refunded, and what the supplier was paid. */
function salesOf(rows: Array<{ status: string; currency: string; _count: { _all: number }; _sum: { sellerPayoutMinor: bigint | null } }>) {
  const count = (statuses: string[]) => rows.filter(row => statuses.includes(row.status)).reduce((total, row) => total + row._count._all, 0);
  const paid = rows.filter(row => row.status === 'released' || row.status === 'partly_refunded');
  return {
    open: count(['locked', 'paid', 'sent', 'disputed']),
    completed: count(['released', 'partly_refunded']),
    refunded: count(['refunded']),
    paid_to_you: paid.length ? { currency: paid[0]!.currency, amount: paid.reduce((total, row) => total + Number(row._sum.sellerPayoutMinor ?? 0n), 0) } : null,
  };
}
