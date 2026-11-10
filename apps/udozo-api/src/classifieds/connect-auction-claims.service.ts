import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { SafePayService } from './safe-pay.service.js';

const dayMs = 86_400_000;
/** The seller is reminded once, this long before their days to claim end. */
export const claimReminderMs = 7 * dayMs;
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such claim.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const claimNumber = (number: number) => `CL-${String(number).padStart(6, '0')}`;
const lotNumber = (number: number) => `AU-${String(number).padStart(6, '0')}`;
const openClaim = { status: { in: ['requested', 'paid'] } };

const claimInclude = {
  auction: { select: { id: true, number: true, title: true, country: true, currency: true, saleMinor: true, leftOverMinor: true, claimBy: true, unclaimedAt: true, orderId: true, order: { select: { id: true, number: true, mode: true } } } },
  seller: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.ConnectAuctionClaimInclude;
type ClaimRow = Prisma.ConnectAuctionClaimGetPayload<{ include: typeof claimInclude }>;

/**
 * Claims (docs/UDOZO_CONNECT_PLAN.md, phase 7c): what an auction of an abandoned item left over (held in
 * `connect_auction_held` by the sale) is its seller's, but only if they claim it from their order within the market's
 * `claim_days` of the sale. Finance checks each claim (`CL-000123`) and pays it into the seller's Udozo money
 * (`customer_withdrawable`), or rejects it with why (the seller may claim again while their days last). The `classifieds`
 * job reminds the seller once a week before the days end, then moves what nobody claimed to `connect_revenue`: Udozo's.
 * A claim waiting for finance when the days end is still decided.
 */
@Injectable()
export class ConnectAuctionClaimsService {
  private readonly logger = new Logger(ConnectAuctionClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly safePay: SafePayService,
  ) {}

  /** The seller claims what their item's auction left over. */
  async file(customer: CustomerWithStore, orderId: string, note?: string | null) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, select: { id: true, sellerId: true } });
    if (!order || order.sellerId !== customer.id) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');
    const lot = await this.prisma.connectAuction.findFirst({ where: { orderId, status: 'sold' }, include: { claims: { where: openClaim } } });
    if (!lot || !lot.leftOverMinor || lot.leftOverMinor <= 0n) throw conflict('nothing_to_claim', 'The auction of this item left nothing over to claim.');
    if (lot.unclaimedAt || (lot.claimBy && lot.claimBy < new Date())) throw conflict('claim_window_closed', 'The days to claim what the auction left over have passed.');
    if (lot.claims.length) throw conflict('claim_exists', lot.claims[0]!.status === 'paid' ? 'What the auction left over was paid to you.' : 'Your claim is with Udozo.');
    let claim;
    try {
      claim = await this.prisma.connectAuctionClaim.create({ data: { auctionId: lot.id, sellerId: customer.id, amountMinor: lot.leftOverMinor, currency: lot.currency, note: note?.trim().slice(0, 500) || null }, include: claimInclude });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('claim_exists', 'Your claim is with Udozo.');
      throw error;
    }
    await this.inbox.admins('admin.connect.claim', { subject: `auction_claim:${claim.id}`, title: `${claimNumber(claim.number)}: a seller claims ${formatMoney(claim.amountMinor, claim.currency)}`, body: `What ${lotNumber(lot.number)} ("${lot.title}") left over.`, link: '/connect/claims' });
    return this.present(claim);
  }

  /** Finance pays a claim into the seller's Udozo money from what the sale holds. */
  async pay(adminId: string | null, id: string, note?: string | null) {
    const claim = await this.load(id);
    if (claim.status !== 'requested') throw conflict('claim_decided', 'This claim was decided.');
    const { auction } = claim;
    const entry = await this.ledger.prepare({
      mode: auction.order.mode,
      type: 'connect_auction_claim',
      reference: `connect_auction:${auction.id}:claim`,
      description: `Claim ${claimNumber(claim.number)} on Udozo auction ${lotNumber(auction.number)}`,
      metadata: { auction: auction.number, claim: claim.number },
      lines: [
        { account: { kind: 'connect_auction_held', currency: claim.currency }, debit: claim.amountMinor },
        { account: { kind: 'customer_withdrawable', currency: claim.currency, customerId: claim.sellerId }, credit: claim.amountMinor },
      ],
    });
    await this.prisma.$transaction(async tx => {
      const done = await tx.connectAuctionClaim.updateMany({ where: { id, status: 'requested' }, data: { status: 'paid', decisionNote: note?.trim().slice(0, 500) || null, decidedById: adminId, decidedAt: new Date() } });
      if (!done.count) throw conflict('claim_decided', 'This claim was decided.');
      await this.ledger.write(tx, entry);
    });
    await this.audit.record({ actorId: adminId, action: 'connect_auction_claim.paid', targetType: 'connect_auction_claim', targetId: id, before: { status: 'requested' }, after: { status: 'paid', amount: Number(claim.amountMinor), currency: claim.currency } });
    await this.tellSeller(auction.orderId, `"${auction.title}": your claim was paid`, `${formatMoney(claim.amountMinor, claim.currency)} from its auction is in your Udozo money, to pay out to your bank.`);
    return this.present(await this.load(id));
  }

  /** Finance rejects a claim with why; the seller may claim again while their days last. */
  async reject(adminId: string | null, id: string, reason: string) {
    const claim = await this.load(id);
    if (claim.status !== 'requested') throw conflict('claim_decided', 'This claim was decided.');
    const done = await this.prisma.connectAuctionClaim.updateMany({ where: { id, status: 'requested' }, data: { status: 'rejected', decisionNote: reason.trim().slice(0, 500), decidedById: adminId, decidedAt: new Date() } });
    if (!done.count) throw conflict('claim_decided', 'This claim was decided.');
    await this.audit.record({ actorId: adminId, action: 'connect_auction_claim.rejected', targetType: 'connect_auction_claim', targetId: id, before: { status: 'requested' }, after: { status: 'rejected', reason } });
    const { auction } = claim;
    const open = !auction.claimBy || auction.claimBy > new Date();
    await this.tellSeller(auction.orderId, `"${auction.title}": your claim was not paid`, `${reason.trim()}${open && auction.claimBy ? ` You can claim again on your order until ${auction.claimBy.toUTCString().slice(0, 16)}.` : ''}`);
    return this.present(await this.load(id));
  }

  async list(filter: { status?: string; country?: string }) {
    const rows = await this.prisma.connectAuctionClaim.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.country ? { auction: { country: filter.country.toUpperCase() } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: claimInclude,
    });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  // ---- The job ----

  /** Reminds sellers a week before their days to claim end, then makes what nobody claimed Udozo's. */
  async runDue(now = new Date()) {
    const result = { reminded: 0, unclaimed: 0 };
    const unclaimedLot = { status: 'sold', unclaimedAt: null, leftOverMinor: { gt: 0n }, claims: { none: openClaim } } satisfies Prisma.ConnectAuctionWhereInput;
    const remind = await this.prisma.connectAuction.findMany({ where: { ...unclaimedLot, claimRemindedAt: null, claimBy: { gt: now, lte: new Date(now.getTime() + claimReminderMs) } }, take: 200 });
    for (const lot of remind) {
      const claimed = await this.prisma.connectAuction.updateMany({ where: { id: lot.id, claimRemindedAt: null }, data: { claimRemindedAt: now } });
      if (!claimed.count) continue;
      result.reminded += 1;
      await this.tellSeller(lot.orderId, `Claim what "${lot.title}" left over`, `${formatMoney(lot.leftOverMinor!, lot.currency)} from its auction is yours if you claim it on your order by ${lot.claimBy!.toUTCString().slice(0, 16)}. After that it becomes Udozo's.`);
    }
    const expired = await this.prisma.connectAuction.findMany({ where: { ...unclaimedLot, claimBy: { lte: now } }, take: 200, include: { order: { select: { mode: true } } } });
    for (const lot of expired) {
      const amount = lot.leftOverMinor!;
      const entry = await this.ledger.prepare({
        mode: lot.order.mode,
        type: 'connect_auction_unclaimed',
        reference: `connect_auction:${lot.id}:unclaimed`,
        description: `Unclaimed from Udozo auction ${lotNumber(lot.number)}`,
        metadata: { auction: lot.number },
        lines: [
          { account: { kind: 'connect_auction_held', currency: lot.currency }, debit: amount },
          { account: { kind: 'connect_revenue', currency: lot.currency }, credit: amount },
        ],
      });
      const moved = await this.prisma.$transaction(async tx => {
        // A claim made in the meantime keeps the money for finance to decide.
        const done = await tx.connectAuction.updateMany({ where: { id: lot.id, unclaimedAt: null, claims: { none: openClaim } }, data: { unclaimedAt: now } });
        if (!done.count) return false;
        await this.ledger.write(tx, entry);
        return true;
      });
      if (!moved) continue;
      result.unclaimed += 1;
      await this.audit.record({ actorId: null, action: 'connect_auction.unclaimed', targetType: 'connect_auction', targetId: lot.id, before: { left_over: Number(amount) }, after: { to: 'connect_revenue' } });
      await this.tellSeller(lot.orderId, `What "${lot.title}" left over was not claimed`, `${formatMoney(amount, lot.currency)} from its auction was not claimed in time, so it is now Udozo's.`);
    }
    if (result.reminded || result.unclaimed) this.logger.log(result, 'Udozo auction claims');
    return result;
  }

  // ---- Presenting ----

  private async load(id: string) {
    const row = await this.prisma.connectAuctionClaim.findUnique({ where: { id }, include: claimInclude });
    if (!row) throw notFound();
    return row;
  }

  private async tellSeller(orderId: string, title: string, body: string) {
    const order = await this.safePay.load(orderId).catch(() => null);
    if (order) await this.safePay.tellParty(order, 'seller', 'customer.connect.auction', title, body).catch(() => undefined);
  }

  present(row: ClaimRow) {
    return {
      object: 'connect_auction_claim' as const,
      id: row.id,
      number: claimNumber(row.number),
      status: row.status as 'requested' | 'paid' | 'rejected',
      amount: Number(row.amountMinor),
      currency: row.currency,
      note: row.note,
      decision_note: row.decisionNote,
      decided_by: row.decidedBy ? { id: row.decidedBy.id, name: row.decidedBy.name } : null,
      decided_at: row.decidedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      auction: { id: row.auction.id, number: lotNumber(row.auction.number), title: row.auction.title, country: row.auction.country, sale: row.auction.saleMinor === null ? null : Number(row.auction.saleMinor), claim_by: row.auction.claimBy?.toISOString() ?? null },
      order: { id: row.auction.order.id, number: `SP-${row.auction.order.number}` },
      seller: row.seller,
    };
  }
}
