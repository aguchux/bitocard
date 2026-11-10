import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ConnectReturnRequest } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ConnectChargesService } from './connect-charges.service.js';
import { connectFeeOf, centreShareOf, ConnectCheckoutService } from './connect-checkout.service.js';
import { cleanMessage } from './conversations.service.js';
import { SafePayService } from './safe-pay.service.js';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
const codeTries = 5;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const notFound = (what = 'return') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

export const returnReasons = ['not_collected', 'refused_at_check_in', 'refused_at_counter', 'damaged'] as const;
export type ReturnReason = (typeof returnReasons)[number];
const reasonWords: Record<ReturnReason, string> = {
  not_collected: 'the buyer did not collect it in time',
  refused_at_check_in: 'the centre refused it at check-in',
  refused_at_counter: 'the buyer refused it at the counter',
  damaged: 'it is damaged',
};
export const returnNumber = (number: number) => `RT-${String(number).padStart(6, '0')}`;

/**
 * Returns to the seller (docs/UDOZO_CONNECT_PLAN.md, Return requests). A Connect Centre asks, with why: an item the buyer
 * did not collect within the market's days after it was ready, or one whose dispute Udozo decided (refused at check-in
 * or at the counter, or damaged). The seller accepts it or Udozo approves it, whichever comes first, and it is accepted
 * by itself when neither answers within the market's hours; everyone is told each time. Accepted, the seller gets a
 * 6-digit return code and the market's days to collect it at the centre, paying the centre's Connect fee as the return
 * fee (from their Udozo money, else their wallet). An item not collected is settled on acceptance: the buyer gets the
 * price back, the seller keeps the shipping, the Connect fee is shared.
 */
@Injectable()
export class ConnectReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safePay: SafePayService,
    private readonly checkout: ConnectCheckoutService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly charges: ConnectChargesService,
  ) {}

  private async settings(country: string) {
    const row = await this.prisma.connectSettings.findUnique({ where: { country } });
    return { returnDueDays: row?.returnDueDays ?? 7, returnAnswerHours: row?.returnAnswerHours ?? 48, sellerCollectDays: row?.sellerCollectDays ?? 7 };
  }

  private async member(customer: CustomerWithStore, centreId: string) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    return member;
  }

  // ---- The centre asks ----

  async request(customer: CustomerWithStore, centreId: string, orderId: string, input: { reason: ReturnReason; note?: string | null }) {
    const member = await this.member(customer, centreId);
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, select: { id: true, connectCentreId: true } });
    if (!order || order.connectCentreId !== centreId) throw notFound('order at this centre');
    const row = await this.safePay.load(order.id);
    if (row.connectReturn) throw conflict('return_exists', 'A return to the seller has already been asked for.');
    const settings = await this.settings(row.country);
    if (input.reason === 'not_collected') {
      if (row.status !== 'at_centre' || !row.readyAt) throw conflict('return_not_due', 'Only an item ready at the centre can be returned for not being collected.');
      const due = new Date(row.readyAt.getTime() + settings.returnDueDays * dayMs);
      if (due > new Date()) throw conflict('return_not_due', `Its return is due ${settings.returnDueDays} days after it was ready, on ${due.toISOString().slice(0, 10)}.`);
    } else if (!(['refunded', 'partly_refunded'].includes(row.status) && row.receivedAt && !row.releasedAt)) {
      // Refused or damaged: Udozo decides the dispute first; the item then goes back to its seller.
      throw conflict('return_not_due', 'Udozo decides first: ask for the return once the dispute is decided for the buyer.');
    }
    const note = input.note ? cleanMessage(input.note).slice(0, 300) : null;
    const made = await this.prisma.connectReturnRequest.create({
      data: { orderId: row.id, centreId, reason: input.reason, note, requestedById: member.customerId, answerBy: new Date(Date.now() + settings.returnAnswerHours * hourMs) },
    });
    const label = returnNumber(made.number);
    const centre = row.connectCentre!;
    await this.safePay.tellParty(row, 'seller', 'customer.connect.return', `${centre.name} is returning "${row.listing.title}"`, `Because ${reasonWords[input.reason]}. Accept the return on your order; it is accepted by itself in ${settings.returnAnswerHours} hours if nobody answers.`);
    await this.safePay.tellParty(row, 'buyer', 'customer.connect.return', `SP-${row.number} is going back to the seller`, input.reason === 'not_collected' ? 'It was not collected in time: you get the price back, less the shipping and fees.' : 'Udozo decided for you; the item goes back to the seller.');
    await this.inbox.admins('admin.connect.return', { subject: made.id, title: `Return ${label} asked for`, body: `${centre.name}: ${reasonWords[input.reason]}.`, link: `/connect/returns` });
    return this.present(made.id);
  }

  // ---- The seller accepts, or Udozo approves, or nobody answers ----

  async accept(customer: CustomerWithStore, orderId: string) {
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { orderId }, include: { order: { select: { sellerId: true } } } });
    if (!row || row.order.sellerId !== customer.id) throw notFound();
    await this.decide(row.id, 'seller', customer.id);
    return this.present(row.id);
  }

  async approve(adminId: string | null, id: string) {
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { id } });
    if (!row) throw notFound();
    await this.decide(row.id, 'admin', adminId);
    await this.audit.record({ actorId: adminId, action: 'connect_return.approved', targetType: 'connect_return', targetId: id, before: { status: row.status }, after: { status: 'accepted' } });
    return this.present(row.id);
  }

  /** Claimed once (requested to accepted), then the money of an item not collected is settled. */
  private async decide(id: string, by: 'seller' | 'admin' | 'auto', who: string | null) {
    const row = await this.prisma.connectReturnRequest.findUniqueOrThrow({ where: { id } });
    const order = await this.safePay.load(row.orderId);
    const settings = await this.settings(order.country);
    const now = new Date();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const claimed = await this.prisma.connectReturnRequest.updateMany({
      where: { id, status: 'requested' },
      data: { status: 'accepted', decidedBy: by, decidedById: who, decidedAt: now, returnCode: this.safePay.seal(code), collectBy: new Date(now.getTime() + settings.sellerCollectDays * dayMs) },
    });
    if (!claimed.count) throw conflict('return_decided', 'This return was already answered.');
    if (row.reason === 'not_collected' && order.status === 'at_centre') await this.settleNotCollected(order);
    const centre = order.connectCentre!;
    const why = by === 'auto' ? `It was accepted because nobody answered within ${settings.returnAnswerHours} hours. ` : '';
    await this.safePay.tellParty(order, 'seller', 'customer.connect.return', `Collect "${order.listing.title}" from ${centre.name}`, `${why}Show your return code on your order at the counter within ${settings.sellerCollectDays} days. You pay the centre's Connect fee as the return fee.`);
    await this.safePay.tellParty(order, 'buyer', 'customer.connect.return', `SP-${order.number}'s return was accepted`, `${why}The item goes back to the seller.`);
    await this.tellCentre(row.centreId, `Return ${returnNumber(row.number)} accepted`, `${why}Keep "${order.listing.title}" for the seller, who collects it with their return code.`);
    await this.inbox.admins('admin.connect.return', { subject: `${id}:accepted`, title: `Return ${returnNumber(row.number)} accepted`, body: `${why}${by === 'auto' ? '' : `By the ${by}.`}`.trim(), link: '/connect/returns' });
  }

  /** The job: requests nobody answered are accepted by themselves; accepted ones not yet settled are settled. */
  async runDue(now = new Date()) {
    const due = await this.prisma.connectReturnRequest.findMany({ where: { status: 'requested', answerBy: { lte: now } }, select: { id: true }, take: 100 });
    let accepted = 0;
    for (const row of due) {
      try {
        await this.decide(row.id, 'auto', null);
        accepted += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    // A settlement a crash interrupted (the return accepted, the item's money not yet moved): done now, once.
    const stuck = await this.prisma.connectReturnRequest.findMany({ where: { status: 'accepted', reason: 'not_collected', order: { status: 'at_centre' } }, select: { orderId: true }, take: 100 });
    for (const row of stuck) await this.settleNotCollected(await this.safePay.load(row.orderId)).catch(() => undefined);
    return { accepted, settled: stuck.length };
  }

  /** An item not collected: refunded less the buyer's demurrage, which is shared as any paid storage. */
  private async settleNotCollected(order: Awaited<ReturnType<SafePayService['load']>>) {
    const owed = await this.charges.owed(order.id, 'buyer');
    const rates = await this.charges.rates(order.country);
    const kept = owed.total < order.priceMinor ? owed.total : order.priceMinor;
    return this.safePay.settleNotCollected(
      order,
      owed.total > 0n
        ? { amount: owed.total, lines: this.charges.shareLines(kept, order.currency, order.connectCentre!.partnerId, rates.centreShareBps), paid: tx => this.charges.settleFromRefund(tx, owed.rows.map(row => row.id)) }
        : undefined,
    );
  }

  /** The seller's return code, shown on their order once the return is accepted, until they collect it. */
  async returnCode(customer: CustomerWithStore, orderId: string) {
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { orderId }, include: { order: { select: { sellerId: true } } } });
    if (!row || row.order.sellerId !== customer.id) throw notFound();
    if (row.status !== 'accepted' || !row.returnCode) throw conflict('return_code_unavailable', 'A return code is shown once the return is accepted, until you collect it.');
    return { object: 'connect_return_code' as const, order_id: orderId, code: this.safePay.unseal(row.returnCode), tries_left: codeTries - row.codeAttempts };
  }

  // ---- The seller collects it ----

  /** The centre hands it back: the seller's return code (5 tries), then the return fee from their money. */
  async handBack(customer: CustomerWithStore, centreId: string, id: string, input: { code: string }) {
    await this.member(customer, centreId);
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { id } });
    if (!row || row.centreId !== centreId) throw notFound();
    const place = (await this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id: row.orderId }, select: { connectPlace: true } })).connectPlace;
    if (place && place !== 'awaiting_pickup') throw conflict('with_udozo', 'This item is with Udozo now: the seller collects it at Udozo’s warehouse.');
    return this.complete(row, input.code, 'centre');
  }

  /** Udozo's team hands an abandoned item back to its seller at the warehouse, against the seller's return code. */
  async handBackAtWarehouse(adminId: string | null, id: string, input: { code: string }) {
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { id } });
    if (!row) throw notFound();
    const place = (await this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id: row.orderId }, select: { connectPlace: true } })).connectPlace;
    if (place !== 'udozo_warehouse') throw conflict('not_at_warehouse', 'This item is not at Udozo’s warehouse.');
    const done = await this.complete(row, input.code, 'warehouse');
    await this.audit.record({ actorId: adminId, action: 'connect_return.handed_back_at_warehouse', targetType: 'connect_return', targetId: id, before: { status: 'accepted' }, after: { status: 'collected' } });
    return done;
  }

  private async complete(row: ConnectReturnRequest, code: string, where: 'centre' | 'warehouse') {
    const id = row.id;
    const input = { code };
    if (row.status !== 'accepted' || !row.returnCode) throw conflict('return_not_accepted', 'This return is not ready to hand back.');
    const tried = await this.prisma.connectReturnRequest.updateMany({ where: { id, status: 'accepted', codeAttempts: { lt: codeTries } }, data: { codeAttempts: { increment: 1 } } });
    if (!tried.count) throw conflict('return_locked', 'The code was entered wrongly too many times. Ask Udozo to look into it.');
    const expected = Buffer.from(this.safePay.unseal(row.returnCode));
    const given = Buffer.from(input.code.trim());
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const left = codeTries - row.codeAttempts - 1;
      throw invalid('return_code_wrong', left > 0 ? `That is not the code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That is not the code, and no tries are left.', 'code');
    }
    const order = await this.safePay.load(row.orderId);
    // Storage owed (in Loss of care) is taken first; what their money cannot cover keeps the item at the centre.
    await this.charges.collectSeller(order.id);
    if ((await this.charges.owed(order.id, 'seller')).total > 0n) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'return_fee_unpaid', 'The seller must add the storage owed to their Udozo wallet first.');
    const terms = await this.checkout.terms(order.country);
    const fee = connectFeeOf(terms, order.deliveryFeeMinor) ?? 0n;
    // At Udozo's warehouse the return fee is all Udozo's: the centre no longer handles it.
    const share = where === 'warehouse' ? 0n : centreShareOf(fee, terms.centreShareBps);
    // The return fee: from the seller's Udozo money, else their wallet; without enough in either, it waits.
    const balance = async (kind: 'customer_withdrawable' | 'customer_wallet') =>
      (await this.prisma.ledgerAccount.findFirst({ where: { kind, mode: order.mode, currency: order.currency, customerId: order.sellerId } }))?.balanceMinor ?? 0n;
    const source = fee === 0n ? null : (await balance('customer_withdrawable')) >= fee ? 'customer_withdrawable' : (await balance('customer_wallet')) >= fee ? 'customer_wallet' : undefined;
    if (source === undefined) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'return_fee_unpaid', 'The seller must add the return fee to their Udozo wallet first.');
    const entry = source
      ? await this.ledger.prepare({
          mode: order.mode,
          type: 'connect_return_fee',
          reference: `connect_return:${id}:fee`,
          description: `Return fee for ${returnNumber(row.number)}`,
          lines: [
            { account: { kind: source, currency: order.currency, customerId: order.sellerId }, debit: fee },
            ...(share > 0n ? [{ account: { kind: 'connect_centre_earnings' as const, currency: order.currency, customerId: order.connectCentre!.partnerId }, credit: share }] : []),
            ...(fee - share > 0n ? [{ account: { kind: 'connect_revenue' as const, currency: order.currency }, credit: fee - share }] : []),
          ],
        })
      : null;
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const done = await tx.connectReturnRequest.updateMany({ where: { id, status: 'accepted' }, data: { status: 'collected', collectedAt: now, returnFeeMinor: fee } });
      if (!done.count) throw conflict('return_changed', 'This return changed: refresh and try again.');
      if (entry) await this.ledger.write(tx, entry);
      await tx.classifiedOrder.update({ where: { id: order.id }, data: { connectShelfId: null, connectMissingAt: null, connectPlace: null } });
      // A pickup that was to take it to the warehouse goes without it.
      await tx.connectPickupItem.updateMany({ where: { orderId: order.id, status: 'waiting' }, data: { status: 'removed' } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'returned', reportedBy: where === 'warehouse' ? 'bitocard' : 'centre', note: where === 'warehouse' ? 'Collected by the seller at Udozo’s warehouse.' : 'Collected by the seller.' } });
    });
    await this.safePay.tellParty(order, 'seller', 'customer.connect.return', `You collected "${order.listing.title}"`, fee ? `The return fee was taken from your ${source === 'customer_wallet' ? 'wallet' : 'Udozo money'}.` : 'Return complete.');
    return this.present(id);
  }

  // ---- Lists ----

  async forCentre(customer: CustomerWithStore, centreId: string, status?: string) {
    await this.member(customer, centreId);
    const rows = await this.prisma.connectReturnRequest.findMany({ where: { centreId, ...(status ? { status } : { status: { in: ['requested', 'accepted'] } }) }, orderBy: { createdAt: 'asc' }, take: 200, select: { id: true } });
    return { object: 'list' as const, data: await Promise.all(rows.map(row => this.present(row.id))) };
  }

  async forAdmin(filter: { status?: string; country?: string }) {
    const rows = await this.prisma.connectReturnRequest.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.country ? { centre: { country: filter.country.toUpperCase() } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true },
    });
    return { object: 'list' as const, data: await Promise.all(rows.map(row => this.present(row.id))) };
  }

  async present(id: string) {
    const row = await this.prisma.connectReturnRequest.findUniqueOrThrow({
      where: { id },
      include: { centre: { select: { id: true, name: true } }, order: { select: { id: true, number: true, currency: true, listing: { select: { title: true } }, seller: { select: { name: true } } } } },
    });
    return {
      object: 'connect_return' as const,
      id: row.id,
      number: returnNumber(row.number),
      order: { id: row.order.id, number: `SP-${row.order.number}`, title: row.order.listing.title },
      centre: row.centre,
      seller: { name: row.order.seller.name },
      reason: row.reason as ReturnReason,
      note: row.note,
      status: row.status as 'requested' | 'accepted' | 'collected' | 'cancelled',
      answer_by: row.answerBy.toISOString(),
      decided_by: row.decidedBy,
      decided_at: row.decidedAt?.toISOString() ?? null,
      collect_by: row.collectBy?.toISOString() ?? null,
      collected_at: row.collectedAt?.toISOString() ?? null,
      return_fee: row.returnFeeMinor === null ? null : Number(row.returnFeeMinor),
      currency: row.order.currency,
      code_tries_left: row.status === 'accepted' ? codeTries - row.codeAttempts : null,
      created_at: row.createdAt.toISOString(),
    };
  }

  private async tellCentre(centreId: string, title: string, body: string) {
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId }, include: { customer: { select: { id: true, storeId: true } } } });
    for (const person of people) {
      await this.inbox.customer({ customerId: person.customer.id, storeId: person.customer.storeId }, 'customer.connect.centre', { subject: `connect_return:${centreId}:${title}`, title, body, link: `/connect/centre/${centreId}/returns` }).catch(() => undefined);
    }
  }
}
