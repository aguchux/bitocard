import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SafePayService } from './safe-pay.service.js';

const dayMs = 86_400_000;
const codeTries = 5;
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const pickupNumber = (number: number) => `PU-${String(number).padStart(6, '0')}`;
const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;
const orderNumber = (number: bigint | number) => `SP-${number}`;
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);

export type WarehouseInput = { country?: string; state_id?: string; name?: string; address?: string; hours?: string; phone?: string; contact_name?: string | null; active?: boolean };

const warehouseInclude = { state: { select: { id: true, name: true } } } as const;
const pickupInclude = {
  centre: { select: { id: true, number: true, name: true, address: true } },
  warehouse: { include: warehouseInclude },
  items: { orderBy: { id: 'asc' as const }, include: { order: { select: { id: true, number: true, listing: { select: { title: true } }, connectShelf: { select: { code: true } } } } } },
} satisfies Prisma.ConnectPickupInclude;
type PickupRow = Prisma.ConnectPickupGetPayload<{ include: typeof pickupInclude }>;

/**
 * Udozo's warehouses and the journey of abandoned items to them (docs/UDOZO_CONNECT_PLAN.md, phase 7a).
 *
 * Udozo runs warehouses (`connect_warehouses`), and each centre's **Final Return Address** is one of them
 * (`connect_centres.fra_warehouse_id`, set by operations). An item a seller left in Loss of care for the market's
 * `abandoned_after_days` is **abandoned** (the `classifieds` job; seller, centre and Udozo told) and waits for Udozo's
 * pickup (`connect_place: awaiting_pickup`). Operations schedule a **pickup** of a centre's abandoned items to its Final
 * Return Address (`connect_pickups`, `PU-000123`, a sealed 6-digit code for Udozo's collector); the centre hands over
 * what it gives the collector by entering that code (`in_transit`, the centre's liability for it ended), and Udozo checks
 * each one in at the warehouse (`udozo_warehouse`). Storage keeps running, Udozo's alone once handed over; until it is
 * auctioned the seller can still collect it at the centre or the warehouse after paying what is owed.
 */
@Injectable()
export class ConnectWarehousesService {
  private readonly logger = new Logger(ConnectWarehousesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly safePay: SafePayService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- Warehouses and Final Return Addresses ----

  presentWarehouse(row: { id: string; country: string; name: string; address: string; hours: string; phone: string; contactName: string | null; active: boolean; createdAt: Date; state: { id: string; name: string } }) {
    return { object: 'connect_warehouse' as const, id: row.id, country: row.country, state: row.state, name: row.name, address: row.address, hours: row.hours, phone: row.phone, contact_name: row.contactName, active: row.active, created_at: row.createdAt.toISOString() };
  }

  async warehouses(country?: string) {
    const rows = await this.prisma.connectWarehouse.findMany({ where: country ? { country: country.toUpperCase() } : {}, orderBy: [{ country: 'asc' }, { name: 'asc' }], include: { ...warehouseInclude, _count: { select: { centres: true, orders: { where: { connectPlace: 'udozo_warehouse' } } } } } });
    return { object: 'list' as const, data: rows.map(row => ({ ...this.presentWarehouse(row), centres: row._count.centres, holding: row._count.orders })) };
  }

  private async checkState(country: string, stateId: string) {
    const state = await this.prisma.classifiedArea.findFirst({ where: { id: stateId, country, kind: 'state' } });
    if (!state) throw invalid('parameter_invalid', 'Choose a state of the warehouse’s country.', 'state_id');
  }

  async createWarehouse(adminId: string | null, input: WarehouseInput) {
    const country = input.country?.toUpperCase();
    const fields = { name: text(input.name, 120), address: text(input.address, 300), hours: text(input.hours, 120), phone: text(input.phone, 40) };
    if (!country || !/^[A-Z]{2}$/.test(country)) throw invalid('parameter_missing', 'Choose the warehouse’s country.', 'country');
    for (const [key, value] of Object.entries(fields)) if (!value) throw invalid('parameter_missing', `Give the warehouse’s ${key}.`, key);
    if (!input.state_id) throw invalid('parameter_missing', 'Choose the warehouse’s state.', 'state_id');
    await this.checkState(country, input.state_id);
    const row = await this.prisma.connectWarehouse.create({
      data: { country, stateId: input.state_id, name: fields.name!, address: fields.address!, hours: fields.hours!, phone: fields.phone!, contactName: text(input.contact_name, 120), active: input.active ?? true },
      include: warehouseInclude,
    });
    await this.audit.record({ actorId: adminId, action: 'connect_warehouse.created', targetType: 'connect_warehouse', targetId: row.id, before: null, after: { name: row.name, country } });
    return this.presentWarehouse(row);
  }

  async updateWarehouse(adminId: string | null, id: string, input: WarehouseInput) {
    const before = await this.prisma.connectWarehouse.findUnique({ where: { id } });
    if (!before) throw notFound('warehouse');
    if (input.state_id) await this.checkState(before.country, input.state_id);
    const data = {
      ...(input.state_id ? { stateId: input.state_id } : {}),
      ...(input.name !== undefined ? { name: text(input.name, 120) ?? before.name } : {}),
      ...(input.address !== undefined ? { address: text(input.address, 300) ?? before.address } : {}),
      ...(input.hours !== undefined ? { hours: text(input.hours, 120) ?? before.hours } : {}),
      ...(input.phone !== undefined ? { phone: text(input.phone, 40) ?? before.phone } : {}),
      ...(input.contact_name !== undefined ? { contactName: text(input.contact_name, 120) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
    const row = await this.prisma.connectWarehouse.update({ where: { id }, data, include: warehouseInclude });
    await this.audit.record({ actorId: adminId, action: 'connect_warehouse.updated', targetType: 'connect_warehouse', targetId: id, before: { name: before.name, active: before.active }, after: { name: row.name, active: row.active } });
    return this.presentWarehouse(row);
  }

  /** Sets a centre's Final Return Address: an active warehouse of its country, or none. */
  async setFra(adminId: string | null, centreId: string, warehouseId: string | null) {
    const centre = await this.prisma.connectCentre.findUnique({ where: { id: centreId } });
    if (!centre) throw notFound('centre');
    if (warehouseId) {
      const warehouse = await this.prisma.connectWarehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse || !warehouse.active || warehouse.country !== centre.country) throw invalid('parameter_invalid', 'Choose an open Udozo warehouse in the centre’s country.', 'warehouse_id');
    }
    await this.prisma.connectCentre.update({ where: { id: centreId }, data: { fraWarehouseId: warehouseId } });
    await this.audit.record({ actorId: adminId, action: 'connect_centre.fra_set', targetType: 'connect_centre', targetId: centreId, before: { warehouse: centre.fraWarehouseId }, after: { warehouse: warehouseId } });
    return this.fraOf(centreId);
  }

  /** A centre's Final Return Address and its next pickup, for the centre and Udozo. */
  async fraOf(centreId: string) {
    const centre = await this.prisma.connectCentre.findUniqueOrThrow({ where: { id: centreId }, include: { fraWarehouse: { include: warehouseInclude } } });
    const [awaiting, next] = await Promise.all([
      this.prisma.classifiedOrder.count({ where: { connectCentreId: centreId, connectPlace: 'awaiting_pickup' } }),
      this.prisma.connectPickup.findFirst({ where: { centreId, status: 'scheduled' }, orderBy: { day: 'asc' }, select: { id: true, number: true, day: true, collector: true } }),
    ]);
    return {
      object: 'connect_final_return_address' as const,
      warehouse: centre.fraWarehouse ? this.presentWarehouse(centre.fraWarehouse) : null,
      awaiting_pickup: awaiting,
      next_pickup: next ? { id: next.id, number: pickupNumber(next.number), day: next.day.toISOString().slice(0, 10), collector: next.collector } : null,
    };
  }

  // ---- Abandonment (the classifieds job) ----

  private async tellCentre(centreId: string, subject: string, title: string, body: string, link: string) {
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId }, include: { customer: { select: { id: true, storeId: true } } } });
    for (const person of people) await this.inbox.customer({ customerId: person.customer.id, storeId: person.customer.storeId }, 'customer.connect.centre', { subject, title, body, link }).catch(() => undefined);
  }

  /** Marks items a month (the market's days) into Loss of care as abandoned, waiting for Udozo's pickup. */
  async abandon(now = new Date()) {
    const settings = new Map((await this.prisma.connectSettings.findMany({ select: { country: true, abandonedAfterDays: true } })).map(row => [row.country, row.abandonedAfterDays]));
    const rows = await this.prisma.connectReturnRequest.findMany({
      where: { status: 'accepted', abandonedAt: null, lossOfCareAt: { not: null, lt: new Date(now.getTime() - dayMs) } },
      take: 200,
      select: { id: true, centreId: true, lossOfCareAt: true, orderId: true, order: { select: { country: true } } },
    });
    let abandoned = 0;
    for (const row of rows) {
      const days = settings.get(row.order.country) ?? 30;
      if (row.lossOfCareAt!.getTime() > now.getTime() - days * dayMs) continue;
      const done = await this.prisma.$transaction(async tx => {
        const claimed = await tx.connectReturnRequest.updateMany({ where: { id: row.id, abandonedAt: null, status: 'accepted' }, data: { abandonedAt: now } });
        if (!claimed.count) return false;
        await tx.classifiedOrder.updateMany({ where: { id: row.orderId, connectPlace: null }, data: { connectPlace: 'awaiting_pickup' } });
        await tx.classifiedShipmentEvent.create({ data: { orderId: row.orderId, status: 'note', reportedBy: 'centre', note: 'Abandoned: Udozo will pick it up to its warehouse.' } });
        return true;
      });
      if (!done) continue;
      abandoned += 1;
      const order = await this.safePay.load(row.orderId);
      await this.safePay.tellParty(order, 'seller', 'customer.connect.return', `"${order.listing.title}" is abandoned`, `You did not collect it in ${days} days of Loss of care. Udozo will take it to its warehouse, and may auction it to cover the storage owed. You can still collect it after paying what is owed.`);
      await this.tellCentre(row.centreId, `connect_abandoned:${row.orderId}`, `${orderNumber(order.number)} is abandoned`, 'Keep it safe until Udozo’s pickup collects it with its pickup code.', `/connect/centre/${row.centreId}/pickups`);
      await this.inbox.admins('admin.connect.alert', { subject: `connect_abandoned:${row.orderId}`, title: `${orderNumber(order.number)} is abandoned`, body: `"${order.listing.title}" waits for a pickup.`, link: '/connect/pickups' });
    }
    if (abandoned) this.logger.log({ abandoned }, 'Connect items abandoned');
    return { abandoned };
  }

  // ---- Pickups ----

  presentPickup(row: PickupRow, withCode: boolean) {
    return {
      object: 'connect_pickup' as const,
      id: row.id,
      number: pickupNumber(row.number),
      day: row.day.toISOString().slice(0, 10),
      collector: row.collector,
      status: row.status as 'scheduled' | 'collected' | 'delivered' | 'cancelled',
      note: row.note,
      ...(withCode ? { code: row.status === 'scheduled' ? this.safePay.unseal(row.pickupCode) : null } : {}),
      centre: { id: row.centre.id, number: centreNumber(row.centre.number), name: row.centre.name, address: row.centre.address },
      warehouse: this.presentWarehouse(row.warehouse),
      items: row.items.map(item => ({ order_id: item.order.id, number: orderNumber(item.order.number), title: item.order.listing.title ?? 'An item', shelf: item.order.connectShelf?.code ?? null, status: item.status, handed_over_at: item.handedOverAt?.toISOString() ?? null, received_at: item.receivedAt?.toISOString() ?? null })),
      collected_at: row.collectedAt?.toISOString() ?? null,
      delivered_at: row.deliveredAt?.toISOString() ?? null,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Every centre with abandoned items waiting for a pickup, for operations to schedule. */
  async awaiting(country?: string) {
    const orders = await this.prisma.classifiedOrder.findMany({
      where: { connectPlace: 'awaiting_pickup', ...(country ? { country: country.toUpperCase() } : {}) },
      select: { id: true, connectCentreId: true, connectPickupItems: { where: { status: 'waiting', pickup: { status: 'scheduled' } }, select: { id: true } } },
      take: 2000,
    });
    const centres = await this.prisma.connectCentre.findMany({ where: { id: { in: [...new Set(orders.map(order => order.connectCentreId!))] } }, include: { fraWarehouse: { select: { id: true, name: true } } } });
    return {
      object: 'list' as const,
      data: centres.map(centre => {
        const mine = orders.filter(order => order.connectCentreId === centre.id);
        return { centre: { id: centre.id, number: centreNumber(centre.number), name: centre.name, country: centre.country }, final_return_address: centre.fraWarehouse, awaiting: mine.length, scheduled: mine.filter(order => order.connectPickupItems.length).length };
      }),
    };
  }

  async pickups(filter: { status?: string; country?: string }) {
    const rows = await this.prisma.connectPickup.findMany({ where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.country ? { centre: { country: filter.country.toUpperCase() } } : {}) }, orderBy: [{ day: 'desc' }, { number: 'desc' }], take: 200, include: pickupInclude });
    return { object: 'list' as const, data: rows.map(row => this.presentPickup(row, true)) };
  }

  async pickup(id: string) {
    const row = await this.prisma.connectPickup.findUnique({ where: { id }, include: pickupInclude });
    if (!row) throw notFound('pickup');
    return this.presentPickup(row, true);
  }

  /** Operations schedule a pickup of every abandoned item at a centre not on another pickup, to its Final Return Address. */
  async schedule(adminId: string | null, input: { centre_id: string; day: string; collector: string; note?: string | null }) {
    if (!adminId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'admin_session_required', 'Sign in as an admin to schedule a pickup.');
    const centre = await this.prisma.connectCentre.findUnique({ where: { id: input.centre_id } });
    if (!centre) throw notFound('centre');
    if (!centre.fraWarehouseId) throw conflict('fra_missing', 'Set the centre’s Final Return Address first.');
    const day = new Date(`${input.day}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.getTime() < Date.now() - dayMs) throw invalid('parameter_invalid', 'Choose today or a later day.', 'day');
    const collector = text(input.collector, 120);
    if (!collector) throw invalid('parameter_missing', 'Say who collects.', 'collector');
    const orders = await this.prisma.classifiedOrder.findMany({
      where: { connectCentreId: centre.id, connectPlace: 'awaiting_pickup', connectPickupItems: { none: { status: 'waiting', pickup: { status: 'scheduled' } } } },
      select: { id: true },
    });
    if (!orders.length) throw conflict('nothing_to_pick_up', 'No abandoned items are waiting at this centre.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.prisma.connectPickup.create({
      data: { centreId: centre.id, warehouseId: centre.fraWarehouseId, day, collector, note: text(input.note, 300), scheduledById: adminId, pickupCode: this.safePay.seal(code), items: { create: orders.map(order => ({ orderId: order.id })) } },
      include: pickupInclude,
    });
    await this.audit.record({ actorId: adminId, action: 'connect_pickup.scheduled', targetType: 'connect_pickup', targetId: row.id, before: null, after: { centre: centre.id, items: orders.length, day: input.day } });
    await this.tellCentre(centre.id, `connect_pickup:${row.id}`, `Udozo picks up ${orders.length === 1 ? '1 item' : `${orders.length} items`} on ${input.day}`, `${collector} collects them for ${row.warehouse.name}. Hand them over against the collector’s pickup code.`, `/connect/centre/${centre.id}/pickups`);
    return this.presentPickup(row, true);
  }

  async cancel(adminId: string | null, id: string, reason: string) {
    const done = await this.prisma.connectPickup.updateMany({ where: { id, status: 'scheduled' }, data: { status: 'cancelled', cancelledAt: new Date(), note: text(reason, 300) } });
    if (!done.count) throw conflict('pickup_not_scheduled', 'Only a pickup not collected yet can be cancelled.');
    await this.prisma.connectPickupItem.updateMany({ where: { pickupId: id, status: 'waiting' }, data: { status: 'removed' } });
    await this.audit.record({ actorId: adminId, action: 'connect_pickup.cancelled', targetType: 'connect_pickup', targetId: id, before: { status: 'scheduled' }, after: { status: 'cancelled', reason } });
    return this.pickup(id);
  }

  /** Checks items in at the warehouse: those named arrive; those named missing never did (flagged); delivered once every handed-over item is either. */
  async receive(adminId: string | null, id: string, input: { order_ids: string[]; missing?: string[] }) {
    const row = await this.prisma.connectPickup.findUnique({ where: { id }, include: { items: true } });
    if (!row) throw notFound('pickup');
    if (row.status !== 'collected') throw conflict('pickup_not_collected', 'Items are checked in once the centre has handed them over.');
    const handed = new Set(row.items.filter(item => item.status === 'handed_over').map(item => item.orderId));
    const missing = input.missing ?? [];
    if ([...input.order_ids, ...missing].some(orderId => !handed.has(orderId))) throw invalid('parameter_invalid', 'Name only items handed over on this pickup and not checked in yet.', 'order_ids');
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      if (input.order_ids.length) {
        await tx.connectPickupItem.updateMany({ where: { pickupId: id, orderId: { in: input.order_ids }, status: 'handed_over' }, data: { status: 'received', receivedAt: now } });
        await tx.classifiedOrder.updateMany({ where: { id: { in: input.order_ids }, connectPlace: 'in_transit' }, data: { connectPlace: 'udozo_warehouse', connectWarehouseId: row.warehouseId, warehouseReceivedAt: now } });
        await tx.classifiedShipmentEvent.createMany({ data: input.order_ids.map(orderId => ({ orderId, status: 'note', reportedBy: 'bitocard', note: 'Checked in at Udozo’s warehouse.' })) });
      }
      if (missing.length) {
        await tx.connectPickupItem.updateMany({ where: { pickupId: id, orderId: { in: missing }, status: 'handed_over' }, data: { status: 'missing' } });
        await tx.classifiedOrder.updateMany({ where: { id: { in: missing } }, data: { connectMissingAt: now } });
      }
      const left = await tx.connectPickupItem.count({ where: { pickupId: id, status: 'handed_over' } });
      if (!left) await tx.connectPickup.updateMany({ where: { id, status: 'collected' }, data: { status: 'delivered', deliveredAt: now } });
    });
    await this.audit.record({ actorId: adminId, action: 'connect_pickup.received', targetType: 'connect_pickup', targetId: id, before: null, after: { received: input.order_ids.length, missing: missing.length } });
    if (missing.length) await this.inbox.admins('admin.connect.missing', { subject: `pickup_missing:${id}`, title: `${missing.length === 1 ? 'An item' : `${missing.length} items`} did not reach the warehouse`, body: `From pickup ${pickupNumber(row.number)}.`, link: `/connect/pickups/${id}` });
    return this.pickup(id);
  }

  /** What Udozo's warehouses hold now. */
  async warehouseItems(warehouseId?: string) {
    const rows = await this.prisma.classifiedOrder.findMany({
      where: { connectPlace: 'udozo_warehouse', ...(warehouseId ? { connectWarehouseId: warehouseId } : {}) },
      orderBy: { warehouseReceivedAt: 'asc' },
      take: 500,
      select: { id: true, number: true, priceMinor: true, currency: true, warehouseReceivedAt: true, listing: { select: { title: true } }, connectWarehouse: { select: { id: true, name: true } }, connectReturn: { select: { id: true, number: true, lossOfCareAt: true, abandonedAt: true } }, connectCentre: { select: { id: true, name: true } } },
    });
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        object: 'connect_warehouse_item' as const,
        order_id: row.id,
        number: orderNumber(row.number),
        title: row.listing.title,
        price: Number(row.priceMinor),
        currency: row.currency,
        warehouse: row.connectWarehouse,
        centre: row.connectCentre,
        return_id: row.connectReturn?.id ?? null,
        loss_of_care_at: row.connectReturn?.lossOfCareAt?.toISOString() ?? null,
        abandoned_at: row.connectReturn?.abandonedAt?.toISOString() ?? null,
        received_at: row.warehouseReceivedAt?.toISOString() ?? null,
      })),
    };
  }

  // ---- The centre's side ----

  private async member(customer: CustomerWithStore, centreId: string) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    return member;
  }

  /** The centre's pickups: scheduled ones to hand over, and the latest done. */
  async centrePickups(customer: CustomerWithStore, centreId: string) {
    await this.member(customer, centreId);
    const rows = await this.prisma.connectPickup.findMany({ where: { centreId }, orderBy: [{ day: 'desc' }], take: 30, include: pickupInclude });
    return { object: 'list' as const, data: rows.map(row => this.presentPickup(row, false)), final_return_address: await this.fraOf(centreId) };
  }

  /** The centre hands over the items it gives Udozo's collector, against the collector's pickup code. */
  async handOver(customer: CustomerWithStore, centreId: string, id: string, input: { code: string; order_ids: string[] }) {
    const member = await this.member(customer, centreId);
    const row = await this.prisma.connectPickup.findUnique({ where: { id }, include: { items: true } });
    if (!row || row.centreId !== centreId) throw notFound('pickup');
    if (row.status !== 'scheduled') throw conflict('pickup_not_scheduled', 'This pickup was already collected or cancelled.');
    const waiting = new Set(row.items.filter(item => item.status === 'waiting').map(item => item.orderId));
    if (!input.order_ids.length || input.order_ids.some(orderId => !waiting.has(orderId))) throw invalid('parameter_invalid', 'Tick the items you give the collector.', 'order_ids');
    const tried = await this.prisma.connectPickup.updateMany({ where: { id, status: 'scheduled', codeAttempts: { lt: codeTries } }, data: { codeAttempts: { increment: 1 } } });
    if (!tried.count) throw conflict('pickup_locked', 'The code was entered wrongly too many times. Ask Udozo for a new pickup.');
    const expected = Buffer.from(this.safePay.unseal(row.pickupCode));
    const given = Buffer.from(input.code.replace(/\s/g, ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const left = codeTries - row.codeAttempts - 1;
      throw invalid('pickup_code_wrong', left > 0 ? `That is not the pickup code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That is not the pickup code, and no tries are left.', 'code');
    }
    const now = new Date();
    const given_ = input.order_ids;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectPickup.updateMany({ where: { id, status: 'scheduled' }, data: { status: 'collected', collectedAt: now } });
      if (!claimed.count) throw conflict('pickup_not_scheduled', 'This pickup was already collected or cancelled.');
      await tx.connectPickupItem.updateMany({ where: { pickupId: id, orderId: { in: given_ }, status: 'waiting' }, data: { status: 'handed_over', handedOverAt: now } });
      // Left out (not found, or kept back): off this pickup, still waiting for the next one.
      await tx.connectPickupItem.updateMany({ where: { pickupId: id, status: 'waiting' }, data: { status: 'removed' } });
      await tx.classifiedOrder.updateMany({ where: { id: { in: given_ }, connectPlace: 'awaiting_pickup' }, data: { connectPlace: 'in_transit', connectWithUdozoAt: now, connectShelfId: null, connectMissingAt: null } });
      await tx.classifiedShipmentEvent.createMany({ data: given_.map(orderId => ({ orderId, status: 'note', reportedBy: 'centre', note: `Handed to Udozo’s pickup ${pickupNumber(row.number)}.` })) });
    });
    await this.audit.record({ actorId: member.customerId, action: 'connect_pickup.handed_over', targetType: 'connect_pickup', targetId: id, before: { status: 'scheduled' }, after: { status: 'collected', items: given_.length } });
    await this.inbox.admins('admin.connect.alert', { subject: `connect_pickup_collected:${id}`, title: `Pickup ${pickupNumber(row.number)} collected`, body: `${given_.length === 1 ? '1 item' : `${given_.length} items`} on the way to the warehouse.`, link: `/connect/pickups/${id}` });
    const full = await this.prisma.connectPickup.findUniqueOrThrow({ where: { id }, include: pickupInclude });
    return this.presentPickup(full, false);
  }
}
