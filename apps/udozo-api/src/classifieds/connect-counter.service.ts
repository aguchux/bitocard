import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { WatermarkService } from '../watermarks/watermarks.service.js';
import { ConnectChargesService } from './connect-charges.service.js';
import { ConnectCheckoutService } from './connect-checkout.service.js';
import { cleanMessage } from './conversations.service.js';
import { type DisputeReason, type OrderRow, SafePayService } from './safe-pay.service.js';

const hourMs = 3_600_000;
const releaseCodeTries = 5;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const noOrder = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order at this centre.');

/** Why a centre refuses an item at check-in, and the dispute reason each opens. */
export const checkInRefusals = { wrong_item: 'not_as_described', damaged: 'damaged', missing_parts: 'not_as_described', not_allowed: 'other' } as const satisfies Record<string, DisputeReason>;
export type CheckInRefusal = keyof typeof checkInRefusals;
const refusalWords: Record<CheckInRefusal, string> = { wrong_item: 'it is not the item listed', damaged: 'it arrived damaged', missing_parts: 'parts are missing', not_allowed: 'it is not allowed at Connect Centres' };

/** What each list on the centre's dashboard holds. */
export const counterViews = { expected: ['paid', 'sent'], at_centre: ['at_centre'], done: ['released', 'disputed', 'refunded', 'partly_refunded'] } as const;
/** What a centre may ask a return for. */
export type { ReturnReason } from './connect-returns.service.js';
export type CounterView = keyof typeof counterViews;

/**
 * A Connect Centre's counter (docs/UDOZO_CONNECT_PLAN.md, phase 5): the UdozoPay orders on their way to it and at it.
 * Its people (any role) receive an item, checking it against the listing and the seller's dispatch photos, or refuse
 * it (a dispute for Udozo to decide); shelve it in one of the centre's storage places, which makes it ready to collect
 * (the buyer told, with the free time to collect); and hand it over once the buyer, having inspected it, gives their
 * release code (5 tries), which releases the money: the seller's price and shipping, the centre's part of the Connect
 * fee to its partner's earnings, Udozo's to Connect revenue. A buyer who refuses it at the counter opens a dispute.
 */
@Injectable()
export class ConnectCounterService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safePay: SafePayService,
    private readonly checkout: ConnectCheckoutService,
    private readonly inbox: InboxService,
    private readonly watermarks: WatermarkService,
    private readonly charges: ConnectChargesService,
  ) {}

  onModuleInit() {
    this.safePay.useConnectTell((order, title, body) => this.tellCentre(order.connectCentreId, order.id, title, body));
  }

  /** The customer's place at the centre, or unknown (never saying whether the centre exists). */
  private async member(customer: CustomerWithStore, centreId: string) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    return member;
  }

  private async order(centreId: string, orderId: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, select: { id: true, connectCentreId: true } });
    if (!order || order.connectCentreId !== centreId) throw noOrder();
    return this.safePay.load(order.id);
  }

  async list(customer: CustomerWithStore, centreId: string, view: CounterView) {
    await this.member(customer, centreId);
    const rows = await this.prisma.classifiedOrder.findMany({
      where: { connectCentreId: centreId, status: { in: [...counterViews[view]] } },
      orderBy: view === 'done' ? { updatedAt: 'desc' } : { paidAt: 'asc' },
      take: 200,
      select: { id: true },
    });
    const orders = await Promise.all(rows.map(row => this.safePay.load(row.id)));
    return { object: 'list' as const, view, data: orders.map(order => this.present(order)) };
  }

  /** Today at the centre: what is on its way, at the centre (waiting to be shelved, ready), due to be collected and late. */
  async summary(customer: CustomerWithStore, centreId: string) {
    await this.member(customer, centreId);
    const now = new Date();
    const dayEnd = new Date(now);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const count = (where: object) => this.prisma.classifiedOrder.count({ where: { connectCentreId: centreId, ...where } });
    const [expected, toShelve, ready, dueToday, overdue] = await Promise.all([
      count({ status: { in: ['paid', 'sent'] } }),
      count({ status: 'at_centre', readyAt: null }),
      count({ status: 'at_centre', readyAt: { not: null } }),
      count({ status: 'at_centre', collectBy: { gte: now, lte: dayEnd } }),
      count({ status: 'at_centre', collectBy: { lt: now } }),
    ]);
    return { object: 'connect_counter_summary' as const, expected, to_shelve: toShelve, ready, due_today: dueToday, overdue };
  }

  /** One of the seller's dispatch photos, to check the item against at check-in. */
  async dispatchPhoto(customer: CustomerWithStore, centreId: string, orderId: string, photoId: string) {
    await this.member(customer, centreId);
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, select: { id: true, connectCentreId: true } });
    if (!order || order.connectCentreId !== centreId) throw noOrder();
    return this.safePay.dispatchPhoto(order, photoId);
  }

  async get(customer: CustomerWithStore, centreId: string, orderId: string) {
    await this.member(customer, centreId);
    return this.present(await this.order(centreId, orderId));
  }

  /** An order of this centre by its number (`SP-000123`, `sp123` or `123`), as scanned from its label or typed. */
  async lookup(customer: CustomerWithStore, centreId: string, number: string) {
    await this.member(customer, centreId);
    const digits = /^\s*(?:sp[-\s]?)?0*(\d{1,12})\s*$/i.exec(number)?.[1];
    if (!digits) throw invalid('parameter_invalid', 'Give the order number, such as SP-000123.', 'number');
    const row = await this.prisma.classifiedOrder.findUnique({ where: { number: BigInt(digits) }, select: { id: true, connectCentreId: true } });
    if (!row || row.connectCentreId !== centreId) throw noOrder();
    return this.present(await this.safePay.load(row.id));
  }

  /** Checked in: the item is the one listed and as the seller's photos show it. The seller may drop it off unannounced. */
  async receive(customer: CustomerWithStore, centreId: string, orderId: string, input: { note?: string | null }) {
    await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    if (!['paid', 'sent'].includes(order.status)) throw conflict('order_not_expected', 'This order is not on its way to the centre.');
    const note = input.note ? cleanMessage(input.note).slice(0, 300) : null;
    const now = new Date();
    const claimed = await this.prisma.$transaction(async tx => {
      const done = await tx.classifiedOrder.updateMany({ where: { id: order.id, status: { in: ['paid', 'sent'] } }, data: { status: 'at_centre', receivedAt: now, sentAt: order.sentAt ?? now } });
      if (!done.count) return false;
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'received', reportedBy: 'centre', note } });
      return true;
    });
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const received = await this.safePay.load(order.id);
    const centre = received.connectCentre!;
    await this.safePay.tellParty(received, 'buyer', 'customer.classifieds.shipment', `"${received.listing.title}" reached ${centre.name}`, 'It is being checked in and shelved. We will tell you when it is ready to collect.');
    await this.safePay.tellParty(received, 'seller', 'customer.classifieds.shipment', `${centre.name} received SP-${received.number}`, 'You are paid once the buyer collects it.');
    return this.present(received);
  }

  /** Refused at check-in (wrong item, damaged, missing parts, not allowed at centres): a dispute for Udozo to decide. */
  async refuse(customer: CustomerWithStore, centreId: string, orderId: string, input: { reason: CheckInRefusal; note?: string | null }) {
    await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    if (!['paid', 'sent'].includes(order.status)) throw conflict('order_not_expected', 'This order is not on its way to the centre.');
    const note = input.note ? cleanMessage(input.note).slice(0, 300) : '';
    const centre = order.connectCentre!;
    // Refused at the counter means it is at the centre: kept there for its seller while Udozo decides.
    await this.prisma.classifiedOrder.updateMany({ where: { id: order.id, receivedAt: null }, data: { receivedAt: new Date() } });
    await this.prisma.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'refused', reportedBy: 'centre', note: note || refusalWords[input.reason] } });
    const disputed = await this.safePay.centreDispute(order, ['paid', 'sent'], checkInRefusals[input.reason], `${centre.name} refused it at check-in: ${refusalWords[input.reason]}.${note ? ` ${note}` : ''}`);
    return this.present(disputed);
  }

  /** Into one of the centre's storage places (or moved to another): the first time, it is ready and the buyer is told. */
  async shelve(customer: CustomerWithStore, centreId: string, orderId: string, input: { shelf_id: string }) {
    await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    if (order.status !== 'at_centre') throw conflict('order_not_at_centre', 'Receive it first.');
    const shelf = await this.prisma.connectShelf.findUnique({ where: { id: input.shelf_id } });
    if (!shelf || shelf.centreId !== centreId || !shelf.active) throw invalid('parameter_invalid', 'Choose one of the centre’s storage places in use.', 'shelf_id');
    const first = !order.readyAt;
    const now = new Date();
    const { buyerFreeHours } = await this.checkout.terms(order.country);
    const collectBy = new Date(now.getTime() + buyerFreeHours * hourMs);
    const claimed = await this.prisma.$transaction(async tx => {
      const done = await tx.classifiedOrder.updateMany({ where: { id: order.id, status: 'at_centre' }, data: { connectShelfId: shelf.id, ...(first ? { readyAt: now, collectBy } : {}) } });
      if (!done.count) return false;
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: first ? 'ready' : 'note', reportedBy: 'centre', note: first ? null : 'Moved to another storage place.' } });
      return true;
    });
    if (!claimed) throw conflict('order_changed', 'This order changed: refresh and try again.');
    const shelved = await this.safePay.load(order.id);
    if (first) {
      const centre = shelved.connectCentre!;
      const by = collectBy.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
      await this.safePay.tellParty(
        shelved,
        'buyer',
        'customer.classifieds.shipment',
        `"${shelved.listing.title}" is ready to collect`,
        `At ${centre.name}, ${centre.address} (${centre.hours}). Collect it free by ${by}; storage is charged daily after that. Inspect it at the counter, then give your release code.`,
      );
    }
    return this.present(shelved);
  }

  /** Handed over: the buyer inspected it and gave their release code; the money is released. */
  async release(customer: CustomerWithStore, centreId: string, orderId: string, input: { code: string }) {
    const member = await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    if (order.status !== 'at_centre' || !order.readyAt) throw conflict('order_not_ready', 'Shelve it first: it is handed over once it is ready.');
    // Storage past the free time is paid before the code is taken.
    const { total } = await this.charges.owed(order.id, 'buyer');
    if (total > 0n) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'storage_unpaid', 'The buyer pays the storage on their order first (Pay storage).');
    await this.safePay.checkReleaseCode(order, 'at_centre', input.code);
    await this.safePay.settle(order, { kind: 'release' }, ['at_centre'], async tx => {
      await tx.classifiedOrder.update({ where: { id: order.id }, data: { releasedById: member.customerId, connectShelfId: null, connectMissingAt: null } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'collected', reportedBy: 'centre' } });
    });
    const done = await this.safePay.load(order.id);
    await this.safePay.tellParty(done, 'buyer', 'customer.classifieds.shipment', `You collected "${done.listing.title}"`, `Thank you for buying with UdozoPay. SP-${done.number} is complete.`);
    return this.present(done);
  }

  /** The buyer inspected it at the counter and refused it: it stays at the centre and Udozo decides. */
  async refuseCollection(customer: CustomerWithStore, centreId: string, orderId: string, input: { reason: string }) {
    await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    if (order.status !== 'at_centre') throw conflict('order_not_at_centre', 'Only an item at the centre can be refused at the counter.');
    const reason = cleanMessage(input.reason).slice(0, 300);
    if (reason.length < 5) throw invalid('parameter_invalid', 'Say why the buyer refused it.', 'reason');
    const centre = order.connectCentre!;
    await this.prisma.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'collection_refused', reportedBy: 'centre', note: reason } });
    const disputed = await this.safePay.centreDispute(order, ['at_centre'], 'not_as_described', `The buyer inspected it at ${centre.name} and refused it: ${reason}`);
    return this.present(disputed);
  }

  /** An update on an item for the buyer and seller to read on the order's timeline ("Box was wet on arrival"). */
  async note(customer: CustomerWithStore, centreId: string, orderId: string, input: { body: string }) {
    await this.member(customer, centreId);
    const order = await this.order(centreId, orderId);
    const body = cleanMessage(input.body).slice(0, 300);
    if (body.length < 3) throw invalid('parameter_invalid', 'Write the update (3 to 300 characters).', 'body');
    await this.prisma.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'note', reportedBy: 'centre', note: body } });
    const noted = await this.safePay.load(order.id);
    const title = `Update on SP-${noted.number} from ${noted.connectCentre!.name}`;
    await this.safePay.tellParty(noted, 'buyer', 'customer.classifieds.shipment', title, body);
    await this.safePay.tellParty(noted, 'seller', 'customer.classifieds.shipment', title, body);
    return this.present(noted);
  }

  /** Tells the centre's people of an order (inbox and push), never failing the step. */
  private async tellCentre(centreId: string | null, orderId: string, title: string, body: string) {
    if (!centreId) return;
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId }, include: { customer: { select: { id: true, storeId: true } } } });
    for (const person of people) {
      await this.inbox
        .customer({ customerId: person.customer.id, storeId: person.customer.storeId }, 'customer.connect.centre', { subject: `connect_order:${orderId}:${title}`, title, body, link: `/connect/centre/${centreId}/orders/${orderId}` })
        .catch(() => undefined);
    }
  }

  /**
   * An order as the centre's people see it: the item and the seller's photos to check it against, who sends it and who
   * collects it (the buyer's name, never their address), where it is shelved and when it must be collected. Never the
   * money beyond what the centre earns, and never the release code.
   */
  present(order: OrderRow) {
    return {
      object: 'connect_order' as const,
      id: order.id,
      number: `SP-${order.number}`,
      status: order.status,
      listing: { id: order.listing.id, ref: Number(order.listing.ref), title: order.listing.title, cover_url: order.listing.media[0] ? this.watermarks.url(order.listing.media[0], 480) : null },
      quantity: order.quantity,
      seller: { name: order.seller.name },
      buyer: { name: order.buyer.name },
      courier: order.courier,
      tracking_number: order.trackingNumber,
      tracking_url: order.trackingUrl,
      shelf: order.connectShelf ? { id: order.connectShelf.id, code: order.connectShelf.code, label: order.connectShelf.label } : null,
      centre_earns: Number(order.centreShareMinor ?? 0n),
      currency: order.currency,
      dispatch_photos: order.dispatchPhotos.map(photo => ({ id: photo.id, content_type: photo.contentType, width: photo.width, height: photo.height })),
      events: order.shipmentEvents.map(event => ({ status: event.status, note: event.note, reported_by: event.reportedBy, at: event.createdAt.toISOString() })),
      release_tries_left: order.status === 'at_centre' ? releaseCodeTries - order.releaseAttempts : null,
      /** Storage the buyer must pay before collecting it, and the seller before collecting a return. */
      buyer_owed: Number(order.connectCharges.filter(charge => charge.payer === 'buyer' && charge.status === 'owed').reduce((sum, charge) => sum + charge.amountMinor, 0n)),
      seller_owed: Number(order.connectCharges.filter(charge => charge.payer === 'seller' && charge.status === 'owed').reduce((sum, charge) => sum + charge.amountMinor, 0n)),
      loss_of_care_at: order.connectReturn?.lossOfCareAt?.toISOString() ?? null,
      paid_at: order.paidAt?.toISOString() ?? null,
      sent_at: order.sentAt?.toISOString() ?? null,
      handover_by: order.handoverBy?.toISOString() ?? null,
      received_at: order.receivedAt?.toISOString() ?? null,
      ready_at: order.readyAt?.toISOString() ?? null,
      collect_by: order.collectBy?.toISOString() ?? null,
      released_at: order.releasedAt?.toISOString() ?? null,
      /** Its return to the seller, once asked (the seller collects it with their own return code). */
      return: order.connectReturn
        ? { id: order.connectReturn.id, number: `RT-${String(order.connectReturn.number).padStart(6, '0')}`, reason: order.connectReturn.reason, status: order.connectReturn.status, collect_by: order.connectReturn.collectBy?.toISOString() ?? null }
        : null,
      /** Whether it is still here for its seller: refused, or refunded and never collected. */
      held_for_seller: ['refunded', 'partly_refunded'].includes(order.status) && Boolean(order.receivedAt) && !order.releasedAt && order.connectReturn?.status !== 'collected',
    };
  }
}
