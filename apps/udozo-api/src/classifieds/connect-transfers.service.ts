import { randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';
import { LedgerService, type Line } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { ConnectChargesService } from './connect-charges.service.js';
import { centreShareOf, ConnectCheckoutService, connectFeeOf } from './connect-checkout.service.js';
import { SafePayService } from './safe-pay.service.js';

const dayMs = 86_400_000;
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const notFound = (what = 'transfer') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const unpaid = (code: string, message: string) => new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', code, message);

export const transferNumber = (number: number) => `TF-${String(number).padStart(6, '0')}`;
const returnNumber = (number: number) => `RT-${String(number).padStart(6, '0')}`;
const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
type Source = 'customer_withdrawable' | 'customer_wallet';
export const openTransferStatuses = ['paid', 'sent', 'arrived'];
const codeTries = 5;

const centreSelect = { id: true, number: true, name: true, address: true, landmark: true, hours: true, phone: true, partnerId: true, stateId: true, area: { select: { name: true } }, state: { select: { name: true } } } as const;
const transferInclude = {
  order: { select: { id: true, number: true, listing: { select: { title: true } } } },
  fromCentre: { select: centreSelect },
  fromWarehouse: { select: { id: true, name: true, address: true, hours: true, phone: true, state: { select: { name: true } } } },
  toCentre: { select: centreSelect },
  recipient: { select: { id: true, name: true, storeId: true } },
  shelf: { select: { code: true } },
  returnRequest: { select: { id: true, number: true } },
  auction: { select: { id: true, number: true } },
} satisfies Prisma.ConnectTransferInclude;
type TransferRow = Prisma.ConnectTransferGetPayload<{ include: typeof transferInclude }>;
type CentreRow = Prisma.ConnectCentreGetPayload<{ select: typeof centreSelect }>;

/**
 * Moving an item to a Connect Centre for someone to collect there with their code (docs/UDOZO_CONNECT_PLAN.md).
 *
 * **A return** (the seller's): once a return is accepted, the seller may, within their free days to collect, have it sent
 * on to an open centre near them instead of collecting it where it is. They pay the return shipping up front (the
 * listing's own Connect charge for that centre's state, else the market's `transfer_ship_minor`), from their Udozo money
 * or wallet, held in their `customer_wallet_locked` until the centre holding it sends it, when it is the sending
 * centre's (it pays the courier). Their days to collect stop while it travels and start again when it arrives, where the
 * centre checks it in and the seller collects it with their return code as before, paying that centre's return fee.
 * Centres only ever send returns to another Connect Centre, never a door.
 *
 * **A lot** (the buyer's): an abandoned item bought at a Udozo auction is collected at Udozo's warehouse, or, where the
 * market has a transfer rate, sent to an open Connect Centre the buyer chooses. They pay the shipping (the rate) and the
 * centre's Connect fee up front from their Udozo money or wallet, held in their locked wallet: the shipping is Udozo's when
 * its team sends it from the warehouse, the fee is shared with the centre when the centre hands it over against the
 * buyer's collection code.
 *
 * Every step is claimed once, in the same transaction as the money it moves.
 */
@Injectable()
export class ConnectTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly safePay: SafePayService,
    private readonly charges: ConnectChargesService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly checkout: ConnectCheckoutService,
  ) {}

  /** The market's rate for a move where no listing charge applies (null: not offered), and the seller's days to collect. */
  async settings(country: string) {
    const row = await this.prisma.connectSettings.findUnique({ where: { country } });
    return { transferShipMinor: row?.transferShipMinor ?? null, sellerCollectDays: row?.sellerCollectDays ?? 7 };
  }

  private async member(customer: CustomerWithStore, centreId: string) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    return member;
  }

  private async balance(kind: Source | 'customer_wallet_locked', mode: LedgerMode, currency: string, customerId: string) {
    return (await this.prisma.ledgerAccount.findFirst({ where: { kind, mode, currency, customerId } }))?.balanceMinor ?? 0n;
  }

  /** The payer's money: their Udozo money first, else their wallet; null when neither covers it. */
  private async sourceFor(mode: LedgerMode, currency: string, customerId: string, amount: bigint, order: Source[]): Promise<Source | null> {
    for (const kind of order) if ((await this.balance(kind, mode, currency, customerId)) >= amount) return kind;
    return null;
  }

  // ---- A return sent on to a centre near the seller ----

  /** The seller's return, checked as one they may still have sent on (accepted, at a centre, within its free days). */
  private async returnToShip(customer: CustomerWithStore, orderId: string) {
    const row = await this.prisma.connectReturnRequest.findUnique({ where: { orderId }, include: { order: { select: { sellerId: true, connectPlace: true } }, transfers: { where: { status: { in: openTransferStatuses } }, select: { status: true } } } });
    if (!row || row.order.sellerId !== customer.id) throw notFound('return');
    if (row.transfers.length) throw conflict('transfer_exists', 'It is already on its way to the centre you chose.');
    if (row.status !== 'accepted') throw conflict('return_not_accepted', 'A return is sent on once it is accepted, until you collect it.');
    if (row.order.connectPlace) throw conflict('with_udozo', 'This item is with Udozo now: it is collected at Udozo’s warehouse.');
    if (row.lossOfCareAt || !row.collectBy || row.collectBy <= new Date()) throw conflict('ship_too_late', 'It can be sent on only within your free days to collect it.');
    return row;
  }

  /** What sending it to a centre costs: the listing's own Connect charge for that state, else the market's rate. */
  private async shippingTo(listingId: string, country: string, stateId: string) {
    const own = await this.prisma.classifiedListingConnectState.findUnique({ where: { listingId_stateId: { listingId, stateId } }, select: { shippingMinor: true } });
    if (own) return own.shippingMinor;
    return (await this.settings(country)).transferShipMinor;
  }

  /** The open centres the seller may have their return sent to, each with what it costs. */
  async returnOptions(customer: CustomerWithStore, orderId: string) {
    const row = await this.returnToShip(customer, orderId);
    const order = await this.safePay.load(row.orderId);
    const centres = await this.prisma.connectCentre.findMany({ where: { country: order.country, status: 'active', id: { not: row.centreId } }, orderBy: [{ state: { name: 'asc' } }, { name: 'asc' }], select: centreSelect, take: 500 });
    const data = [];
    for (const centre of centres) {
      const shipping = await this.shippingTo(order.listing.id, order.country, centre.stateId);
      if (shipping !== null) data.push({ centre: this.presentCentre(centre), shipping: Number(shipping) });
    }
    return { object: 'list' as const, currency: order.currency, collect_by: row.collectBy!.toISOString(), data };
  }

  /** The seller pays the shipping and the centre holding it is asked to send it on. */
  async shipReturn(customer: CustomerWithStore, orderId: string, input: { centre_id: string; expected_shipping?: number }) {
    const row = await this.returnToShip(customer, orderId);
    if (input.centre_id === row.centreId) throw invalid('parameter_invalid', 'It is at that centre already: collect it there.', 'centre_id');
    const order = await this.safePay.load(row.orderId);
    const centre = await this.prisma.connectCentre.findUnique({ where: { id: input.centre_id }, select: { ...centreSelect, country: true, status: true } });
    if (!centre || centre.country !== order.country || centre.status !== 'active') throw invalid('parameter_invalid', 'Choose an open Connect Centre in your country.', 'centre_id');
    const shipping = await this.shippingTo(order.listing.id, order.country, centre.stateId);
    if (shipping === null) throw conflict('transfer_unavailable', 'It cannot be sent to that centre yet.');
    if (input.expected_shipping !== undefined && BigInt(input.expected_shipping) !== shipping) throw conflict('price_changed', `Sending it there costs ${formatMoney(shipping, order.currency)} now.`);
    // Storage owed on this item comes first, as for collecting it.
    await this.charges.collectSeller(order.id);
    if ((await this.charges.owed(order.id, 'seller')).total > 0n) throw unpaid('storage_unpaid', 'Add the storage owed to your Udozo wallet first.');
    const source = shipping === 0n ? 'customer_wallet' : await this.sourceFor(order.mode, order.currency, customer.id, shipping, ['customer_withdrawable', 'customer_wallet']);
    if (!source) throw unpaid('return_shipping_unpaid', `Add ${formatMoney(shipping, order.currency)} to your Udozo wallet to send it.`);
    // The entry is prepared before the transaction (it reads the accounts), under the move's own id.
    const id = randomUUID();
    const held = shipping > 0n ? await this.lock(id, order.mode, order.currency, customer.id, source, shipping, `Return shipping to ${centre.name}`) : null;
    const transfer = await this.prisma.$transaction(async tx => {
      const made = await tx.connectTransfer.create({
        data: { id, kind: 'return', orderId: order.id, returnId: row.id, fromCentreId: row.centreId, toCentreId: centre.id, recipientId: customer.id, mode: order.mode, country: order.country, currency: order.currency, shippingMinor: shipping, paidFrom: source },
      });
      // Its free days stop while it travels: they start again when it arrives.
      const paused = await tx.connectReturnRequest.updateMany({ where: { id: row.id, status: 'accepted', collectBy: { gt: new Date() }, lossOfCareAt: null }, data: { collectBy: null } });
      if (!paused.count) throw conflict('return_changed', 'This return changed: refresh and try again.');
      if (held) await this.ledger.write(tx, held);
      await tx.classifiedShipmentEvent.create({ data: { orderId: order.id, status: 'note', reportedBy: 'seller', note: `The seller asked for it to be sent to ${centre.name}.` } });
      return made;
    });
    const full = await this.load(transfer.id);
    await this.tellCentre(row.centreId, `send:${transfer.id}`, `Send ${order.listing.title} to ${centre.name}`, `The seller asked for it to be sent to ${centre.name}, ${centre.address}. Pack it, hand it to a courier and mark it sent with the tracking number.`, `/connect/centre/${row.centreId}/transfers`);
    await this.tellCentre(centre.id, `coming:${transfer.id}`, `${order.listing.title} is coming to you`, `A return for its seller, from another Connect Centre. Check it in when it arrives.`, `/connect/centre/${centre.id}/transfers`);
    await this.safePay.tellParty(order, 'seller', 'customer.connect.return', `"${order.listing.title}" will be sent to ${centre.name}`, `You paid ${formatMoney(shipping, order.currency)} for the shipping. Your days to collect start again when it arrives; collect it there with your return code.`);
    return this.present(full);
  }

  /** The payer's money into their locked wallet, until it is sent (or given back if it is cancelled first). */
  private lock(id: string, mode: LedgerMode, currency: string, customerId: string, source: Source, amount: bigint, description: string) {
    return this.ledger.prepare({
      mode,
      type: 'connect_transfer',
      reference: `connect_transfer:${id}:paid`,
      description,
      lines: [
        { account: { kind: source, currency, customerId }, debit: amount },
        { account: { kind: 'customer_wallet_locked', currency, customerId }, credit: amount },
      ],
    });
  }

  /** The centre holding a return sends it on: the courier and its tracking number. The shipping is then the centre's. */
  async send(customer: CustomerWithStore, centreId: string, id: string, input: { courier: string; tracking_number?: string | null }) {
    const member = await this.member(customer, centreId);
    const row = await this.load(id);
    if (row.kind !== 'return' || row.fromCentreId !== centreId) throw notFound();
    if (row.status !== 'paid') throw conflict('transfer_not_waiting', 'This item was already sent, or the move was cancelled.');
    const courier = text(input.courier, 80);
    if (!courier) throw invalid('parameter_missing', 'Say which courier takes it.', 'courier');
    const tracking = text(input.tracking_number, 80);
    const now = new Date();
    const pay = row.shippingMinor > 0n ? await this.release(row, 'sent', [{ account: { kind: 'connect_centre_earnings', currency: row.currency, customerId: row.fromCentre!.partnerId }, credit: row.shippingMinor }]) : null;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectTransfer.updateMany({ where: { id, status: 'paid' }, data: { status: 'sent', courier, trackingNumber: tracking, sentAt: now, sentById: member.customerId } });
      if (!claimed.count) throw conflict('transfer_not_waiting', 'This item was already sent, or the move was cancelled.');
      if (pay) await this.ledger.write(tx, pay);
      // Off this centre's shelf: it no longer holds it.
      await tx.classifiedOrder.update({ where: { id: row.orderId }, data: { connectShelfId: null, connectMissingAt: null } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'in_transit', reportedBy: 'centre', note: `Sent to ${row.toCentre.name} with ${courier}${tracking ? ` (${tracking})` : ''}.` } });
    });
    await this.tellRecipient(row, `sent:${id}`, `"${row.order.listing.title}" is on its way to ${row.toCentre.name}`, `${courier}${tracking ? `, tracking ${tracking}` : ''}. You are told when it arrives.`);
    await this.tellCentre(row.toCentreId, `sent:${id}`, `${row.order.listing.title} is on its way to you`, `With ${courier}${tracking ? ` (${tracking})` : ''}. Check it in when it arrives.`, `/connect/centre/${row.toCentreId}/transfers`);
    return this.present(await this.load(id));
  }

  /** The money held for a move, out of the payer's locked wallet to whoever it goes to now. */
  private release(row: TransferRow, step: string, credits: Line[]) {
    const amount = credits.reduce((sum, line) => sum + (line.credit ?? 0n), 0n);
    return this.ledger.prepare({
      mode: row.mode,
      type: 'connect_transfer',
      reference: `connect_transfer:${row.id}:${step}`,
      description: `${transferNumber(row.number)} ${step}`,
      lines: [{ account: { kind: 'customer_wallet_locked', currency: row.currency, customerId: row.recipientId }, debit: amount }, ...credits],
    });
  }

  /** The centre it was sent to checks it in (and shelves it): it now holds the item for its recipient. */
  async receive(customer: CustomerWithStore, centreId: string, id: string, input: { shelf_id?: string | null }) {
    const member = await this.member(customer, centreId);
    const row = await this.load(id);
    if (row.toCentreId !== centreId) throw notFound();
    if (row.status !== 'sent') throw conflict('transfer_not_sent', 'Only an item on its way to you can be checked in.');
    if (input.shelf_id && !(await this.prisma.connectShelf.findFirst({ where: { id: input.shelf_id, centreId, active: true } }))) throw invalid('parameter_invalid', 'No such storage place at this centre.', 'shelf_id');
    const now = new Date();
    const { sellerCollectDays } = await this.settings(row.country);
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectTransfer.updateMany({ where: { id, status: 'sent' }, data: { status: 'arrived', arrivedAt: now, receivedById: member.customerId, shelfId: input.shelf_id ?? null } });
      if (!claimed.count) throw conflict('transfer_not_sent', 'Only an item on its way to you can be checked in.');
      // This centre holds it now: its stock, its storage, its counter.
      await tx.classifiedOrder.update({ where: { id: row.orderId }, data: { connectCentreId: centreId, connectShelfId: input.shelf_id ?? null, connectSeenAt: now, connectMissingAt: null } });
      if (row.kind === 'return') await tx.connectReturnRequest.update({ where: { id: row.returnId! }, data: { centreId, collectBy: new Date(now.getTime() + sellerCollectDays * dayMs) } });
      // A lot is held here for its buyer (counted in the centre's stock) until it hands it over.
      else await tx.classifiedOrder.update({ where: { id: row.orderId }, data: { connectPlace: 'lot_at_centre' } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'note', reportedBy: 'centre', note: `Arrived at ${row.toCentre.name}.` } });
    });
    if (row.kind === 'return') await this.tellRecipient(row, `arrived:${id}`, `Collect "${row.order.listing.title}" from ${row.toCentre.name}`, `It arrived. Show your return code on your order at the counter within ${sellerCollectDays} days (${row.toCentre.hours}).`);
    else await this.tellRecipient(row, `arrived:${id}`, `Collect "${row.order.listing.title}" from ${row.toCentre.name}`, `It arrived. Show your collection code from the lot's page at the counter (${row.toCentre.hours}, ${row.toCentre.address}).`);
    return this.present(await this.load(id));
  }

  /** A return collected at the centre it was sent to: the move is over. Called in the hand-back's transaction. */
  async collected(tx: Prisma.TransactionClient, returnId: string) {
    await tx.connectTransfer.updateMany({ where: { returnId, status: 'arrived' }, data: { status: 'collected', collectedAt: new Date() } });
  }

  /** Whether a return is moving between centres (its hand-back waits until it arrives). */
  async moving(returnId: string) {
    return (await this.prisma.connectTransfer.count({ where: { returnId, status: { in: ['paid', 'sent'] } } })) > 0;
  }

  // ---- A lot sent from Udozo's warehouse to a centre near its buyer ----

  /** The buyer's sold lot, still at the warehouse and not moving. */
  private async lotToShip(customer: CustomerWithStore, ref: string) {
    if (!/^\d{1,9}$/.test(ref)) throw notFound('lot');
    const lot = await this.prisma.connectAuction.findUnique({ where: { number: Number(ref) }, include: { transfers: { where: { status: { in: openTransferStatuses } }, select: { id: true } } } });
    if (!lot || lot.kind !== 'abandoned' || lot.buyerId !== customer.id || lot.status !== 'sold') throw notFound('lot');
    if (lot.collectedAt) throw conflict('lot_collected', 'You collected it already.');
    if (lot.transfers.length) throw conflict('transfer_exists', 'It is already on its way to the centre you chose.');
    if (!lot.warehouseId || !lot.orderId) throw conflict('lot_shipping_unavailable', 'It is collected at Udozo’s warehouse.');
    const rate = (await this.settings(lot.country)).transferShipMinor;
    if (rate === null) throw conflict('lot_shipping_unavailable', 'Sending lots to a Connect Centre is not offered here yet: collect it at Udozo’s warehouse.');
    const fee = connectFeeOf(await this.checkout.terms(lot.country), rate);
    if (fee === null) throw conflict('lot_shipping_unavailable', 'Sending lots to a Connect Centre is not offered here yet: collect it at Udozo’s warehouse.');
    return { lot, rate, fee };
  }

  /** The open centres the buyer may have their lot sent to, with the shipping and the centre's Connect fee. */
  async lotOptions(customer: CustomerWithStore, ref: string) {
    const { lot, rate, fee } = await this.lotToShip(customer, ref);
    const centres = await this.prisma.connectCentre.findMany({ where: { country: lot.country, status: 'active' }, orderBy: [{ state: { name: 'asc' } }, { name: 'asc' }], select: centreSelect, take: 500 });
    return { object: 'list' as const, currency: lot.currency, shipping: Number(rate), fee: Number(fee), total: Number(rate + fee), data: centres.map(centre => ({ centre: this.presentCentre(centre) })) };
  }

  /** The buyer pays the shipping and the Connect fee, held until Udozo sends it and the centre hands it over. */
  async shipLot(customer: CustomerWithStore, ref: string, input: { centre_id: string; expected_total?: number }) {
    const { lot, rate, fee } = await this.lotToShip(customer, ref);
    const total = rate + fee;
    if (input.expected_total !== undefined && BigInt(input.expected_total) !== total) throw conflict('price_changed', `Sending it to a Connect Centre costs ${formatMoney(total, lot.currency)} now.`);
    const centre = await this.prisma.connectCentre.findUnique({ where: { id: input.centre_id }, select: { ...centreSelect, country: true, status: true } });
    if (!centre || centre.country !== lot.country || centre.status !== 'active') throw invalid('parameter_invalid', 'Choose an open Connect Centre in your country.', 'centre_id');
    const order = await this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id: lot.orderId! }, select: { mode: true } });
    const source = total === 0n ? 'customer_wallet' : await this.sourceFor(order.mode, lot.currency, customer.id, total, ['customer_withdrawable', 'customer_wallet']);
    if (!source) throw unpaid('wallet_balance_low', `Add ${formatMoney(total, lot.currency)} to your Udozo wallet to send it.`);
    const id = randomUUID();
    const held = total > 0n ? await this.lock(id, order.mode, lot.currency, customer.id, source, total, `Sending AU-${String(lot.number).padStart(6, '0')} to ${centre.name}`) : null;
    await this.prisma.$transaction(async tx => {
      await tx.connectTransfer.create({
        data: { id, kind: 'lot', orderId: lot.orderId!, auctionId: lot.id, fromWarehouseId: lot.warehouseId!, toCentreId: centre.id, recipientId: customer.id, mode: order.mode, country: lot.country, currency: lot.currency, shippingMinor: rate, feeMinor: fee, paidFrom: source },
      });
      if (held) await this.ledger.write(tx, held);
    });
    const full = await this.load(id);
    await this.inbox.admins('admin.connect.alert', { subject: `connect_transfer_lot:${id}`, title: `Send ${transferNumber(full.number)} to ${centre.name}`, body: `"${full.order.listing.title}" from ${full.fromWarehouse!.name}, for its auction buyer.`, link: '/connect/transfers' });
    await this.tellCentre(centre.id, `coming:${id}`, `${full.order.listing.title} is coming to you`, `A Udozo auction lot, from Udozo's warehouse. Check it in when it arrives, then hand it to its buyer against their collection code.`, `/connect/centre/${centre.id}/transfers`);
    await this.tellRecipient(full, `paid:${id}`, `"${full.order.listing.title}" will be sent to ${centre.name}`, `You paid ${formatMoney(total, lot.currency)}. You are told when it arrives; collect it there with your collection code.`);
    return this.present(full);
  }

  /** The buyer changes their mind before Udozo sends it: their money back, and they collect it at the warehouse. */
  async cancelLot(customer: CustomerWithStore, ref: string) {
    if (!/^\d{1,9}$/.test(ref)) throw notFound('lot');
    const row = await this.prisma.connectTransfer.findFirst({ where: { kind: 'lot', recipientId: customer.id, status: 'paid', auction: { number: Number(ref) } }, select: { id: true } });
    if (!row) throw conflict('transfer_not_waiting', 'Only a move not yet sent can be cancelled.');
    return this.cancel(row.id, 'The buyer cancelled it.', customer.id, 'buyer');
  }

  /** Udozo's team sends a lot from its warehouse: the shipping is then Udozo's (audited). */
  async sendLot(adminId: string | null, id: string, input: { courier: string; tracking_number?: string | null }) {
    const row = await this.load(id);
    if (row.kind !== 'lot') throw notFound();
    if (row.status !== 'paid') throw conflict('transfer_not_waiting', 'This lot was already sent, or the move was cancelled.');
    const courier = text(input.courier, 80);
    if (!courier) throw invalid('parameter_missing', 'Say which courier takes it.', 'courier');
    const tracking = text(input.tracking_number, 80);
    const pay = row.shippingMinor > 0n ? await this.release(row, 'sent', [{ account: { kind: 'connect_revenue', currency: row.currency }, credit: row.shippingMinor }]) : null;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectTransfer.updateMany({ where: { id, status: 'paid' }, data: { status: 'sent', courier, trackingNumber: tracking, sentAt: new Date(), sentById: adminId } });
      if (!claimed.count) throw conflict('transfer_not_waiting', 'This lot was already sent, or the move was cancelled.');
      if (pay) await this.ledger.write(tx, pay);
      await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'in_transit', reportedBy: 'bitocard', note: `Auction lot sent from ${row.fromWarehouse?.name ?? 'Udozo’s warehouse'} to ${row.toCentre.name} with ${courier}.` } });
    });
    await this.audit.record({ actorId: adminId, action: 'connect_transfer.sent', targetType: 'connect_transfer', targetId: id, before: { status: 'paid' }, after: { status: 'sent', courier, tracking_number: tracking } });
    await this.tellRecipient(row, `sent:${id}`, `"${row.order.listing.title}" is on its way to ${row.toCentre.name}`, `${courier}${tracking ? `, tracking ${tracking}` : ''}. You are told when it arrives.`);
    await this.tellCentre(row.toCentreId, `sent:${id}`, `${row.order.listing.title} is on its way to you`, `With ${courier}${tracking ? ` (${tracking})` : ''}. Check it in when it arrives.`, `/connect/centre/${row.toCentreId}/transfers`);
    return this.present(await this.load(id));
  }

  /** The centre hands a lot to its buyer against their collection code (5 tries): the Connect fee is then shared. */
  async handOverLot(customer: CustomerWithStore, centreId: string, id: string, input: { code: string }) {
    const member = await this.member(customer, centreId);
    const row = await this.load(id);
    if (row.kind !== 'lot' || row.toCentreId !== centreId) throw notFound();
    if (row.status !== 'arrived') throw conflict('transfer_not_arrived', 'Check it in first.');
    const lot = await this.prisma.connectAuction.findUniqueOrThrow({ where: { id: row.auctionId! }, select: { collectionCode: true, collectedAt: true } });
    if (!lot.collectionCode || lot.collectedAt) throw conflict('lot_collected', 'It was collected already.');
    const tried = await this.prisma.connectTransfer.updateMany({ where: { id, status: 'arrived', codeAttempts: { lt: codeTries } }, data: { codeAttempts: { increment: 1 } } });
    if (!tried.count) throw conflict('collection_locked', 'The code was entered wrongly too many times. Ask Udozo to look into it.');
    const expected = Buffer.from(this.safePay.unseal(lot.collectionCode));
    const given = Buffer.from(input.code.replace(/\s/g, ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const left = codeTries - row.codeAttempts - 1;
      throw invalid('collection_code_wrong', left > 0 ? `That is not the buyer’s collection code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That is not the buyer’s collection code, and no tries are left.', 'code');
    }
    const terms = await this.checkout.terms(row.country);
    const share = centreShareOf(row.feeMinor, terms.centreShareBps);
    const pay =
      row.feeMinor > 0n
        ? await this.release(row, 'collected', [
            ...(share > 0n ? [{ account: { kind: 'connect_centre_earnings' as const, currency: row.currency, customerId: row.toCentre.partnerId }, credit: share }] : []),
            ...(row.feeMinor - share > 0n ? [{ account: { kind: 'connect_revenue' as const, currency: row.currency }, credit: row.feeMinor - share }] : []),
          ])
        : null;
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectTransfer.updateMany({ where: { id, status: 'arrived' }, data: { status: 'collected', collectedAt: now } });
      if (!claimed.count) throw conflict('transfer_not_arrived', 'Check it in first.');
      const done = await tx.connectAuction.updateMany({ where: { id: row.auctionId!, collectedAt: null }, data: { collectedAt: now } });
      if (!done.count) throw conflict('lot_collected', 'It was collected already.');
      if (pay) await this.ledger.write(tx, pay);
      await tx.classifiedOrder.update({ where: { id: row.orderId }, data: { connectShelfId: null, connectMissingAt: null, connectPlace: 'auctioned', connectWarehouseId: null } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'note', reportedBy: 'centre', note: `Handed to its auction buyer at ${row.toCentre.name}.` } });
    });
    await this.audit.record({ actorId: member.customerId, action: 'connect_transfer.handed_over', targetType: 'connect_transfer', targetId: id, before: { status: 'arrived' }, after: { status: 'collected' } });
    await this.tellRecipient(row, `collected:${id}`, `You collected "${row.order.listing.title}"`, `At ${row.toCentre.name}.`);
    return this.present(await this.load(id));
  }

  /** A lot's open move, for its page (the buyer's view). */
  async ofLot(auctionId: string) {
    const row = await this.prisma.connectTransfer.findFirst({ where: { auctionId, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, include: transferInclude });
    return row ? this.present(row) : null;
  }

  // ---- Cancelling, before it is sent ----

  /** The seller changes their mind before it is sent: their money back where it came from, their days to collect again. */
  async cancelReturn(customer: CustomerWithStore, orderId: string) {
    const row = await this.prisma.connectTransfer.findFirst({ where: { orderId, kind: 'return', recipientId: customer.id, status: 'paid' }, select: { id: true } });
    if (!row) throw conflict('transfer_not_waiting', 'Only a move not yet sent can be cancelled.');
    return this.cancel(row.id, 'The seller cancelled it.', customer.id, 'seller');
  }

  /** Udozo's team cancels a move not yet sent (audited). */
  async adminCancel(adminId: string | null, id: string, reason: string) {
    const done = await this.cancel(id, reason, adminId, 'admin');
    await this.audit.record({ actorId: adminId, action: 'connect_transfer.cancelled', targetType: 'connect_transfer', targetId: id, before: { status: 'paid' }, after: { status: 'cancelled', reason } });
    return done;
  }

  private async cancel(id: string, reason: string, who: string | null, by: 'seller' | 'buyer' | 'admin') {
    const row = await this.load(id);
    if (row.status !== 'paid') throw conflict('transfer_not_waiting', 'Only a move not yet sent can be cancelled.');
    const total = row.shippingMinor + row.feeMinor;
    const back = total > 0n ? await this.release(row, 'cancelled', [{ account: { kind: row.paidFrom as Source, currency: row.currency, customerId: row.recipientId }, credit: total }]) : null;
    const { sellerCollectDays } = await this.settings(row.country);
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectTransfer.updateMany({ where: { id, status: 'paid' }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim().slice(0, 300), cancelledById: who } });
      if (!claimed.count) throw conflict('transfer_not_waiting', 'Only a move not yet sent can be cancelled.');
      if (back) await this.ledger.write(tx, back);
      // A return's free days to collect start again where it is.
      if (row.kind === 'return') await tx.connectReturnRequest.updateMany({ where: { id: row.returnId!, status: 'accepted', collectBy: null }, data: { collectBy: new Date(Date.now() + sellerCollectDays * dayMs) } });
      await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'note', reportedBy: by === 'seller' ? 'seller' : 'bitocard', note: `The move to ${row.toCentre.name} was cancelled.` } });
    });
    // The payer is told unless they cancelled it themselves.
    if (by === 'admin') {
      await this.tellRecipient(row, `cancelled:${id}`, `The move to ${row.toCentre.name} was cancelled`, `${total > 0n ? `${formatMoney(total, row.currency)} went back to your ${row.paidFrom === 'customer_wallet' ? 'wallet' : 'Udozo money'}. ` : ''}${reason}`);
    }
    if (row.fromCentreId) await this.tellCentre(row.fromCentreId, `cancelled:${id}`, `Do not send ${row.order.listing.title}`, `The move to ${row.toCentre.name} was cancelled: keep it here.`, `/connect/centre/${row.fromCentreId}/transfers`);
    return this.present(await this.load(id));
  }

  // ---- Lists ----

  /** A centre's moves: what it is to send, what is coming to it, what arrived for collection, and the latest done. */
  async forCentre(customer: CustomerWithStore, centreId: string) {
    await this.member(customer, centreId);
    const rows = await this.prisma.connectTransfer.findMany({
      where: { OR: [{ fromCentreId: centreId }, { toCentreId: centreId }], NOT: { status: 'cancelled', cancelledAt: { lt: new Date(Date.now() - 30 * dayMs) } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: transferInclude,
    });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  async forAdmin(filter: { status?: string; country?: string; kind?: string }) {
    const rows = await this.prisma.connectTransfer.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.country ? { country: filter.country.toUpperCase() } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: transferInclude,
    });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  /** The open move of an order, for its pages. */
  async ofOrder(orderId: string) {
    const row = await this.prisma.connectTransfer.findFirst({ where: { orderId, status: { in: [...openTransferStatuses, 'collected'] } }, orderBy: { createdAt: 'desc' }, include: transferInclude });
    return row ? this.present(row) : null;
  }

  private load(id: string) {
    return this.prisma.connectTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude }).catch(() => {
      throw notFound();
    });
  }

  private presentCentre(centre: CentreRow) {
    return { id: centre.id, number: centreNumber(centre.number), name: centre.name, address: centre.address, landmark: centre.landmark, area: centre.area.name, state: centre.state.name, hours: centre.hours, phone: centre.phone };
  }

  present(row: TransferRow) {
    return {
      object: 'connect_transfer' as const,
      id: row.id,
      number: transferNumber(row.number),
      kind: row.kind as 'return' | 'lot',
      status: row.status as 'paid' | 'sent' | 'arrived' | 'collected' | 'cancelled',
      order: { id: row.order.id, number: `SP-${row.order.number}`, title: row.order.listing.title },
      return: row.returnRequest ? { id: row.returnRequest.id, number: returnNumber(row.returnRequest.number) } : null,
      auction: row.auction ? { id: row.auction.id, number: `AU-${String(row.auction.number).padStart(6, '0')}` } : null,
      from: row.fromCentre
        ? { kind: 'centre' as const, id: row.fromCentre.id, name: row.fromCentre.name, address: row.fromCentre.address, state: row.fromCentre.state.name }
        : { kind: 'warehouse' as const, id: row.fromWarehouse!.id, name: row.fromWarehouse!.name, address: row.fromWarehouse!.address, state: row.fromWarehouse!.state.name },
      to: this.presentCentre(row.toCentre),
      recipient: { name: row.recipient.name },
      shipping: Number(row.shippingMinor),
      fee: Number(row.feeMinor),
      currency: row.currency,
      courier: row.courier,
      tracking_number: row.trackingNumber,
      shelf: row.shelf?.code ?? null,
      sent_at: row.sentAt?.toISOString() ?? null,
      arrived_at: row.arrivedAt?.toISOString() ?? null,
      collected_at: row.collectedAt?.toISOString() ?? null,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
      cancel_reason: row.cancelReason,
      created_at: row.createdAt.toISOString(),
    };
  }

  private async tellRecipient(row: TransferRow, subject: string, title: string, body: string) {
    const type = row.kind === 'return' ? 'customer.connect.return' : 'customer.connect.auction';
    const link = row.kind === 'return' ? `/account/orders/${row.orderId}` : `/account`;
    await this.inbox.customer({ customerId: row.recipient.id, storeId: row.recipient.storeId }, type, { subject: `connect_transfer:${subject}`, title, body, link }).catch(() => undefined);
  }

  private async tellCentre(centreId: string, subject: string, title: string, body: string, link: string) {
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId }, include: { customer: { select: { id: true, storeId: true } } } });
    for (const person of people) {
      await this.inbox.customer({ customerId: person.customer.id, storeId: person.customer.storeId }, 'customer.connect.centre', { subject: `connect_transfer:${centreId}:${subject}`, title, body, link }).catch(() => undefined);
    }
  }
}
