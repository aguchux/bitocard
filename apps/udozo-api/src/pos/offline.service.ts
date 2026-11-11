import { createPublicKey, verify } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { houseStoreId } from '../checkout/house-ids.js';
import { heldUnits } from '../classifieds/rules.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AccountNotices } from '../notifications/account-notices.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PosBy } from './actor.js';
import { PosCatalogueService } from './catalogue.service.js';
import { posCountedStatuses } from './catalogue-rules.js';
import { saleTotals } from './money.js';
import { discountBps, levelOf, type ResolvedRole } from './permissions.js';
import { PosReceiptsService } from './receipts.service.js';
import { PosShiftsService } from './shifts.service.js';
import { checkPayments, maxLineQuantity, maxSaleLines, type PaymentInput, recordedPaymentMethods, type RecordedPaymentMethod, saleNumber } from './sale-rules.js';
import { openShiftOf, PosSalesService } from './sales.service.js';
import { PosStaffService } from './staff.service.js';
import { changeLevel, freeAtShop, levelsOf, pausedShops, shopPricesOf, shopsOf } from './stock-levels.js';

/** How long and how much a till may sell with no internet before it must sync, unless its plan says otherwise. */
export const offlineLimits = { hours: 72, sales: 500, warn_hours: 48 } as const;
/** The plan's offline limits (admins set them per plan), warnings from two thirds of the hours. */
export const limitsFor = (plan: { offlineHours: number; offlineSales: number }) => ({ hours: plan.offlineHours, sales: plan.offlineSales, warn_hours: Math.max(1, Math.floor((plan.offlineHours * 2) / 3)) });
/** A till that has not synced for this long is told to the owner (once until it syncs). */
export const unsyncedAfterMs = 24 * 3_600_000;
/** Entries a till uploads at once. */
export const maxUploadEntries = 50;
/** Entries in one file of unsent sales. */
export const maxImportEntries = 2000;
/** An unlinked device may upload what it sold for this long after it was unlinked, its sales held for the owner. */
export const unlinkedUploadDays = 30;
/** Sales an unlinked device may leave waiting for the owner. */
export const maxHeldPerDevice = 500;
/** An offline sale's time is kept as the till gave it, within this many days before it arrived. */
const backdateDays = 7;

export type OfflineSaleEntry = {
  kind: 'sale';
  client_sale_id: string;
  /** Its number on the paper receipt (`T2-0042`). */
  client_number?: string | null;
  client_created_at: string;
  staff_id: string;
  /** A manager who gave their PIN on the till (a bigger discount, or selling past the copy's stock). */
  approved_by_staff_id?: string | null;
  lines: Array<{ listing_id: string; quantity: number; unit_price: number; discount?: number }>;
  discount?: number;
  vat_bps: number;
  payments: Array<{ method: string; amount: number; tendered?: number | null; reference?: string | null }>;
  customer_id?: string | null;
  note?: string | null;
  total: number;
  /** Receipts asked for at the till, sent once the sale is uploaded. */
  receipt?: { whatsapp?: string | null; email?: string | null } | null;
};
export type OfflineRefundEntry = {
  kind: 'refund';
  /** The refund's own id, made on the till. */
  client_id: string;
  /** The sale it refunds: its `client_sale_id`. */
  sale_client_id: string;
  reason: string;
  restock?: boolean;
  staff_id: string;
  approved_by_staff_id?: string | null;
};
/** A shift opened offline at the till (its own id), with the cash in the drawer. */
export type OfflineShiftOpenEntry = { kind: 'shift_open'; client_id: string; staff_id: string; at: string; opening_float: number; note?: string | null };
/** Cash paid into or out of a shift offline: the shift opened offline (`shift_client_id`) or online (`shift_id`). */
export type OfflineShiftCashEntry = { kind: 'shift_cash'; client_id: string; staff_id: string; at: string; shift_client_id?: string | null; shift_id?: string | null; cash_kind: 'in' | 'out'; amount: number; reason: string };
/** A shift closed offline with the cash counted. */
export type OfflineShiftCloseEntry = { kind: 'shift_close'; client_id: string; staff_id: string; at: string; shift_client_id?: string | null; shift_id?: string | null; counted: number; note?: string | null };
/** New stock in, a shelf count, or units damaged, made offline (a manager's PIN where the role needs it). */
export type OfflineStockEntry = { kind: 'stock'; client_id: string; staff_id: string; at: string; listing_id: string; adjustment: 'restock' | 'count' | 'damage'; quantity: number; note?: string | null; approved_by_staff_id?: string | null };
export type OfflineEntry = OfflineSaleEntry | OfflineRefundEntry | OfflineShiftOpenEntry | OfflineShiftCashEntry | OfflineShiftCloseEntry | OfflineStockEntry;
export const offlineEntryKinds = ['sale', 'refund', 'shift_open', 'shift_cash', 'shift_close', 'stock'] as const;
type EntryKind = (typeof offlineEntryKinds)[number];

/** What to look at in an offline sale, as kept on it. */
export type OfflineFlag =
  | { code: 'oversold' | 'held'; listing_id: string; title: string; short: number }
  | { code: 'unticked'; listing_id: string; title: string }
  | { code: 'price_changed'; listing_id: string; title: string; sold_at: number; price: number | null }
  | { code: 'staff_suspended'; staff: string }
  | { code: 'staff_not_on_till'; staff: string }
  | { code: 'device_unlinked' }
  | { code: 'beyond_offline_limit'; hours: number }
  | { code: 'discount_over_limit'; staff: string; bps: number }
  | { code: 'refund_unapproved'; staff: string };

type Result = {
  client_id: string;
  kind: EntryKind;
  status: 'applied' | 'duplicate' | 'held' | 'rejected';
  sale?: { id: string; number: string; client_number: string | null; flags: OfflineFlag[] };
  /** The shift a shift entry made or changed. */
  shift?: { id: string; status: string };
  /** Receipts sent after the sale arrived. */
  receipts?: Array<{ via: 'whatsapp' | 'email'; ok: boolean; message?: string }>;
  error?: { code: string; message: string; param?: string };
};
type DeviceRow = { id: string; accountId: string; tillId: string; revokedAt: Date | null; lastSyncedAt: Date | null; name: string | null };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const minorOf = (value: unknown, param: string) => {
  if (value === undefined || value === null) return 0n;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid('parameter_invalid', 'Amounts are whole minor units, never negative.', param);
  return BigInt(value);
};
const fullName = (staff: { firstName: string; lastName: string }) => `${staff.firstName} ${staff.lastName}`.trim();
/** An optional piece of text from the till: a string of at most `max` characters, or nothing. */
const optionalText = (value: unknown, max: number, param: string) => {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.length > max) throw invalid('parameter_invalid', `Text of up to ${max} characters.`, param);
};
const requiredId = (value: unknown, param: string) => {
  if (typeof value !== 'string' || !uuid.test(value)) throw invalid('parameter_invalid', 'Give its id.', param);
};

/**
 * What every entry must look like before anything is read: ids are ids and text is text of bounded length. A malformed
 * entry is refused on its own (never left to fail in the database, which would stop the till's whole queue).
 */
function checkShape(entry: OfflineEntry) {
  switch (entry.kind) {
    case 'sale':
      optionalText(entry.client_number, 40, 'client_number');
      optionalText(entry.note, 300, 'note');
      optionalText(entry.client_created_at, 40, 'client_created_at');
      if (entry.customer_id !== undefined && entry.customer_id !== null) requiredId(entry.customer_id, 'customer_id');
      if (entry.approved_by_staff_id !== undefined && entry.approved_by_staff_id !== null) requiredId(entry.approved_by_staff_id, 'approved_by_staff_id');
      if (entry.receipt !== undefined && entry.receipt !== null) {
        if (typeof entry.receipt !== 'object') throw invalid('parameter_invalid', 'A receipt is a WhatsApp number or an email.', 'receipt');
        optionalText(entry.receipt.whatsapp, 32, 'receipt.whatsapp');
        optionalText(entry.receipt.email, 254, 'receipt.email');
      }
      if (Array.isArray(entry.payments)) entry.payments.forEach((payment, index) => optionalText(payment?.reference, 80, `payments[${index}].reference`));
      return;
    case 'refund':
      requiredId(entry.sale_client_id, 'sale_client_id');
      requiredId(entry.staff_id, 'staff_id');
      optionalText(entry.reason, 300, 'reason');
      if (entry.restock !== undefined && typeof entry.restock !== 'boolean') throw invalid('parameter_invalid', 'Say whether it goes back on the shelf.', 'restock');
      if (entry.approved_by_staff_id !== undefined && entry.approved_by_staff_id !== null) requiredId(entry.approved_by_staff_id, 'approved_by_staff_id');
      return;
    case 'shift_open':
    case 'shift_cash':
    case 'shift_close':
      requiredId(entry.staff_id, 'staff_id');
      optionalText(entry.at, 40, 'at');
      if (typeof entry.at !== 'string') throw invalid('parameter_invalid', 'Give the time as an ISO date.', 'at');
      if ('note' in entry) optionalText(entry.note, 300, 'note');
      if ('reason' in entry) optionalText(entry.reason, 200, 'reason');
      if ('shift_client_id' in entry && entry.shift_client_id !== undefined && entry.shift_client_id !== null) requiredId(entry.shift_client_id, 'shift_client_id');
      if ('shift_id' in entry && entry.shift_id !== undefined && entry.shift_id !== null) requiredId(entry.shift_id, 'shift_id');
      return;
    case 'stock':
      requiredId(entry.staff_id, 'staff_id');
      requiredId(entry.listing_id, 'listing_id');
      optionalText(entry.at, 40, 'at');
      if (typeof entry.at !== 'string') throw invalid('parameter_invalid', 'Give the time as an ISO date.', 'at');
      optionalText(entry.note, 200, 'note');
      if (entry.approved_by_staff_id !== undefined && entry.approved_by_staff_id !== null) requiredId(entry.approved_by_staff_id, 'approved_by_staff_id');
      return;
  }
}

/**
 * Selling with no internet (docs/UDOZO_POS_PLAN.md, Selling with no internet; milestone 9). A linked till keeps a copy
 * of what it needs (`copy`: its shop, the products ticked with their price there and what is free to sell, who may sign
 * in, the limits) and, back online, uploads what it did in order (`upload`): each sale applied as it was made, at the
 * prices it was sold at, by the member of staff who sold it, at the time it happened. **A sale is never undone**: where
 * stock ran out it stands and takes what was there (never below nothing, never what online buyers hold) and is flagged
 * (`oversold`, `held`), as is a sale by someone suspended meanwhile, of a product unticked meanwhile, or at an older
 * price. Every entry carries its own id, so an upload sent twice applies once. An unlinked device's sales are held for the
 * owner to accept or reject, never applied by themselves.
 */
@Injectable()
export class PosOfflineService {
  private readonly logger = new Logger('PosOffline');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: PosSalesService,
    private readonly catalogue: PosCatalogueService,
    private readonly staff: PosStaffService,
    private readonly shifts: PosShiftsService,
    private readonly receipts: PosReceiptsService,
    private readonly inbox: InboxService,
    private readonly notices: AccountNotices,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * A member of staff of the account with their role (null when not one of theirs), whether they are active and whether
   * they may work at the till (`tillId`): only those are offered on its device, so anyone else named by an upload is
   * either stale or forged.
   */
  private async member(accountId: string, staffId: string | null | undefined, tillId?: string | null) {
    if (typeof staffId !== 'string' || !uuid.test(staffId)) return null;
    const row = await this.prisma.posStaff.findFirst({ where: { id: staffId, accountId }, include: { role: true, tills: { select: { tillId: true } } } });
    if (!row) return null;
    const role: ResolvedRole = this.staff.resolveRole(row);
    const onTill = !tillId || row.allTills || row.tills.some(till => till.tillId === tillId);
    return { row, role, by: { customerId: null, staffId: row.id, name: fullName(row) } satisfies PosBy, active: row.status === 'active', onTill, trusted: row.status === 'active' && onTill };
  }

  /** The owner's Udozo account (still active), as the till's services take it. */
  private async owner(accountId: string): Promise<CustomerWithStore> {
    const account = await this.prisma.posAccount.findUniqueOrThrow({ where: { id: accountId }, select: { customerId: true } });
    const owner = await this.prisma.customer.findUnique({ where: { id: account.customerId }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
    if (!owner || owner.status !== 'active') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_account_unavailable', 'This shop cannot sell on Udozo POS just now.');
    return owner;
  }

  // ---- The device's copy ----

  /** What a linked till keeps to sell offline: its shop, every product at its price there with what is free, who may sign in, and the limits. */
  async copy(device: { id: string; accountId: string; tillId: string }) {
    const till = await this.prisma.posTill.findUniqueOrThrow({ where: { id: device.tillId }, include: { shop: true } });
    const account = await this.prisma.posAccount.findUniqueOrThrow({ where: { id: device.accountId }, include: { plan: true } });
    const owner = await this.owner(device.accountId);
    const { shops } = await shopsOf(this.prisma, account.id);
    const products = await this.catalogue.catalogue(owner, { shop: till.shopId, limit: 5000, show: 'all' });
    const now = new Date();
    await this.prisma.posDevice.update({ where: { id: device.id }, data: { lastSyncedAt: now, lastSeenAt: now, unsyncedNotifiedAt: null } });
    const shop = till.shop;
    // The till's shift open now, to carry on offline, and its latest sales, to refund offline.
    const shift = await this.prisma.posShift.findFirst({ where: { tillId: till.id, status: 'open' }, include: { cash: true } });
    const recent = await this.prisma.posSale.findMany({
      where: { tillId: till.id, status: 'completed', createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      include: { lines: { orderBy: { position: 'asc' } }, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      object: 'pos_offline_copy' as const,
      synced_at: now.toISOString(),
      /** This device, named in a file of its unsent sales; `key` is whether it registered its signing key. */
      device: { id: device.id, key: Boolean((await this.prisma.posDevice.findUnique({ where: { id: device.id }, select: { publicKey: true } }))?.publicKey) },
      limits: limitsFor(account.plan),
      shift: shift
        ? { id: shift.id, client_id: shift.clientId, opened_at: shift.openedAt.toISOString(), opened_by: shift.openedByName, opening_float: Number(shift.openingFloatMinor), totals: await this.shifts.totals(shift) }
        : null,
      recent_sales: recent.map(sale => ({
        id: sale.id,
        client_sale_id: sale.clientSaleId,
        number: sale.number,
        client_number: sale.clientNumber,
        created_at: sale.createdAt.toISOString(),
        sold_by: sale.soldByName,
        total: Number(sale.totalMinor),
        lines: sale.lines.map(line => ({ listing_id: line.listingId, title: line.title, quantity: line.quantity, unit_price: Number(line.unitPriceMinor) })),
        payments: sale.payments.map(payment => ({ method: payment.method, amount: Number(payment.amountMinor) })),
        /** Refunded offline only when paid in ways the shop handles itself (never the Udozo wallet, a Udozo account or pay later). */
        refundable_offline: sale.payments.every(payment => (recordedPaymentMethods as readonly string[]).includes(payment.method)),
      })),
      account: { id: account.id, currency: account.currency, country: account.country, plan: { code: account.plan.code, name: account.plan.name } },
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        tin: shop.tin,
        email: shop.email,
        shop_code: shop.shopCode,
        vat_bps: shop.vatBps,
        receipt_footer: shop.receiptFooter,
        receipt_qr: shop.receiptQr,
        bank: shop.bankName || shop.bankAccountName || shop.bankAccountNumber ? { name: shop.bankName, account_name: shop.bankAccountName, account_number: shop.bankAccountNumber } : null,
        /** A paused or closed shop sells nothing, offline either. */
        paused: pausedShops(shops, account.plan).has(shop.id),
        closed: Boolean(shop.closedAt),
      },
      till: { id: till.id, name: till.name, printer_width: till.printerWidth, auto_print: till.autoPrint },
      /** Offline: cash, card, transfers to the shop's own account and other methods, recorded. */
      payment_methods: recordedPaymentMethods,
      staff: await this.staff.offlineStaff(device.id),
      categories: products.categories,
      products: products.data.map(product => ({
        id: product.id,
        ref: product.ref,
        sku: product.sku,
        title: product.title,
        barcode: product.barcode,
        price: product.price.amount,
        category: product.category,
        photo_url: product.photo_url,
        /** Free to sell at this till's shop when synced. */
        available: product.available,
        /** On the shelf at this shop (its level, or the stock with one shop), for counts offline. */
        on_hand: product.levels ? (product.levels.shops.find(level => level.shop_id === till.shopId)?.quantity ?? 0) : product.stock,
        blocked: product.blocked,
      })),
    };
  }

  // ---- Uploading ----

  /** A till's offline entries, in the order they happened: each applied once, its result answered. */
  async upload(device: DeviceRow, entries: OfflineEntry[]) {
    if (!Array.isArray(entries) || !entries.length || entries.length > maxUploadEntries) throw invalid('parameter_invalid', `Upload 1 to ${maxUploadEntries} entries at once.`, 'entries');
    // A device unlinked long ago (lost, stolen) uploads nothing more.
    if (device.revokedAt && Date.now() - device.revokedAt.getTime() > unlinkedUploadDays * 86_400_000) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'device_not_linked', 'This device is not linked to a till.');
    const owner = await this.owner(device.accountId);
    const results: Result[] = [];
    const plan = (await this.prisma.posAccount.findUniqueOrThrow({ where: { id: device.accountId }, include: { plan: true } })).plan;
    for (const [index, entry] of entries.entries()) {
      const kind: EntryKind = (offlineEntryKinds as readonly string[]).includes(entry?.kind) ? entry.kind : 'sale';
      const clientId = entry?.kind === 'sale' ? entry.client_sale_id : (entry as { client_id?: string })?.client_id;
      try {
        if (!(offlineEntryKinds as readonly string[]).includes(entry?.kind)) throw invalid('parameter_invalid', 'Each entry is a sale, a refund, a shift step or a stock change.', `entries[${index}].kind`);
        if (typeof clientId !== 'string' || !uuid.test(clientId)) throw invalid('parameter_invalid', 'Each entry has its own id.', `entries[${index}]`);
        checkShape(entry);
        if (device.revokedAt) {
          results.push(entry.kind === 'sale' ? await this.hold(device, entry) : { client_id: clientId, kind, status: 'rejected', error: { code: 'device_unlinked', message: 'This device was unlinked: only its sales are kept, for the owner to decide.' } });
          continue;
        }
        switch (entry.kind) {
          case 'sale':
            results.push(await this.sendReceipts(owner, entry, await this.applySale(owner, { ...device, limitHours: plan.offlineHours }, entry)));
            break;
          case 'refund':
            results.push(await this.applyRefund(owner, device, entry));
            break;
          case 'shift_open':
            results.push(await this.applyShiftOpen(owner, device, entry));
            break;
          case 'shift_cash':
            results.push(await this.applyShiftCash(owner, device, entry));
            break;
          case 'shift_close':
            results.push(await this.applyShiftClose(owner, device, entry));
            break;
          case 'stock':
            results.push(await this.applyStock(owner, device, entry));
            break;
        }
      } catch (error) {
        // A refusal is that entry's answer and the till moves on. The same step sent twice at once: the first made it.
        // Data the database could not take is that entry's refusal too (never retried for ever, holding the queue).
        // Anything else (the database unreachable) stops the upload, to be sent again.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && kind !== 'sale') {
          results.push({ client_id: String(clientId), kind, status: 'duplicate' });
          continue;
        }
        if (error instanceof Prisma.PrismaClientValidationError || error instanceof TypeError || (error instanceof Prisma.PrismaClientKnownRequestError && ['P2000', 'P2006', 'P2007', 'P2023'].includes(error.code))) {
          this.logger.warn(`Offline ${kind} ${String(clientId)} refused: ${error instanceof Error ? error.message.split('\n')[0] : 'bad data'}`);
          results.push({ client_id: String(clientId), kind, status: 'rejected', error: { code: 'entry_invalid', message: 'Udozo could not read this entry. Export it and send it to Udozo.' } });
          continue;
        }
        if (!(error instanceof ApiError)) throw error;
        results.push({ client_id: String(clientId), kind, status: 'rejected', error: { code: error.code, message: error.message, ...(error.param ? { param: error.param } : {}) } });
      }
    }
    await this.prisma.posDevice.update({ where: { id: device.id }, data: { lastUploadAt: new Date(), lastSeenAt: new Date() } });
    return { object: 'pos_offline_upload' as const, results };
  }

  /** An unlinked device's sale, held for the owner (once per sale). */
  private async hold(device: DeviceRow, entry: OfflineSaleEntry): Promise<Result> {
    const done = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.client_sale_id } }, select: { id: true, number: true, clientNumber: true, flags: true } });
    if (done) return { client_id: entry.client_sale_id, kind: 'sale', status: 'duplicate', sale: { id: done.id, number: done.number, client_number: done.clientNumber, flags: done.flags as OfflineFlag[] } };
    // Only what could be a sale is kept, and only so much from one device.
    this.checkSale(entry);
    const waiting = await this.prisma.posOfflineHeld.count({ where: { deviceId: device.id, status: 'held' } });
    if (waiting >= maxHeldPerDevice) throw conflict('held_limit', `This device has ${maxHeldPerDevice} sales waiting for the owner. They must accept or reject them first.`);
    await this.prisma.posOfflineHeld.upsert({
      where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.client_sale_id } },
      create: { accountId: device.accountId, deviceId: device.id, tillId: device.tillId, clientSaleId: entry.client_sale_id, entry: entry as unknown as Prisma.InputJsonValue },
      update: {},
    });
    return { client_id: entry.client_sale_id, kind: 'sale', status: 'held' };
  }

  /** Checks an offline sale's shape before anything is read. */
  private checkSale(entry: OfflineSaleEntry) {
    if (!Array.isArray(entry.lines) || !entry.lines.length || entry.lines.length > maxSaleLines) throw invalid('parameter_invalid', `A sale holds 1 to ${maxSaleLines} products.`, 'lines');
    const ids = entry.lines.map(line => line.listing_id);
    if (ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) throw invalid('parameter_invalid', 'Each product once, by its id.', 'lines');
    entry.lines.forEach((line, index) => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxLineQuantity) throw invalid('parameter_invalid', 'A quantity is a whole number from 1.', `lines[${index}].quantity`);
      minorOf(line.unit_price, `lines[${index}].unit_price`);
      minorOf(line.discount, `lines[${index}].discount`);
    });
    if (!Number.isInteger(entry.vat_bps) || entry.vat_bps < 0 || entry.vat_bps > 10_000) throw invalid('parameter_invalid', 'VAT is in basis points, 0 to 10000.', 'vat_bps');
    if (typeof entry.staff_id !== 'string' || !uuid.test(entry.staff_id)) throw invalid('parameter_invalid', 'Say who sold it.', 'staff_id');
    if (!Array.isArray(entry.payments) || !entry.payments.length) throw invalid('parameter_missing', 'Say how it was paid.', 'payments');
    entry.payments.forEach((payment, index) => {
      if (!(recordedPaymentMethods as readonly string[]).includes(payment.method)) throw invalid('payment_method_offline', 'Offline, a sale is paid in cash, by card, by transfer to the shop or another way the shop records.', `payments[${index}].method`);
    });
  }

  /** When the sale happened: as the till said, never in the future nor more than a week before it arrived. */
  private soldAt(value: string, now: Date) {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) throw invalid('parameter_invalid', 'Give the time as an ISO date.', 'client_created_at');
    return new Date(Math.min(now.getTime(), Math.max(at.getTime(), now.getTime() - backdateDays * 86_400_000)));
  }

  /**
   * Applies one offline sale, in one transaction with its listings locked (as online): its own number, the prices it
   * was sold at, and from each line what was there to take (the shop's level, never what online buyers hold), flagged
   * where it was short. `extraFlags` are added (`device_unlinked` for a held sale the owner accepted).
   */
  async applySale(owner: CustomerWithStore, device: { id: string; accountId: string; tillId: string | null; lastSyncedAt: Date | null; limitHours?: number }, entry: OfflineSaleEntry, extraFlags: OfflineFlag[] = []): Promise<Result> {
    const done = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.client_sale_id } }, select: { id: true, number: true, clientNumber: true, flags: true } });
    if (done) return { client_id: entry.client_sale_id, kind: 'sale', status: 'duplicate', sale: { id: done.id, number: done.number, client_number: done.clientNumber, flags: done.flags as OfflineFlag[] } };
    this.checkSale(entry);
    if (!device.tillId) throw conflict('till_removed', 'The till this was sold at has been removed.');
    const till = await this.prisma.posTill.findFirst({ where: { id: device.tillId, shop: { accountId: device.accountId } }, include: { shop: true } });
    if (!till) throw conflict('till_removed', 'The till this was sold at has been removed.');
    const account = await this.prisma.posAccount.findUniqueOrThrow({ where: { id: device.accountId } });
    const now = new Date();
    const soldAt = this.soldAt(entry.client_created_at, now);
    const flags: OfflineFlag[] = [...extraFlags];
    if (device.lastSyncedAt && soldAt.getTime() - device.lastSyncedAt.getTime() > (device.limitHours ?? offlineLimits.hours) * 3_600_000) flags.push({ code: 'beyond_offline_limit', hours: Math.floor((soldAt.getTime() - device.lastSyncedAt.getTime()) / 3_600_000) });

    // Who sold it: kept as they were, flagged if suspended or removed meanwhile.
    const member = await this.member(account.id, entry.staff_id, device.tillId);
    if (!member) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    const seller = member.row;
    const by: PosBy = member.by;
    if (seller.status !== 'active') flags.push({ code: 'staff_suspended', staff: by.name });
    if (!member.onTill) flags.push({ code: 'staff_not_on_till', staff: by.name });
    // A colleague's PIN counts only from someone active who works at this till.
    const approval = await this.member(account.id, entry.approved_by_staff_id, device.tillId);
    const approver = approval && approval.trusted && approval.row.id !== seller.id ? approval.row : null;

    const lines = entry.lines.map((line, index) => ({ ...line, unit: minorOf(line.unit_price, `lines[${index}].unit_price`), off: minorOf(line.discount, `lines[${index}].discount`) }));
    const totals = saleTotals(
      lines.map(line => ({ unit: line.unit, quantity: line.quantity, discount: line.off })),
      { discount: minorOf(entry.discount, 'discount'), vatBps: entry.vat_bps },
    );
    if (typeof entry.total !== 'number' || BigInt(entry.total) !== totals.total) throw conflict('totals_mismatch', 'The total does not add up from its lines. Export it and send it to Udozo.', 'total');
    const parts: PaymentInput[] = entry.payments.map((payment, index) => ({ method: payment.method as RecordedPaymentMethod, amount: minorOf(payment.amount, `payments[${index}].amount`), tendered: payment.tendered === undefined || payment.tendered === null ? null : minorOf(payment.tendered, `payments[${index}].tendered`), reference: payment.reference?.slice(0, 80) ?? null }));
    const paid = checkPayments(parts, totals.total);
    // A discount past the seller's role limit stands (the customer has the goods) but is flagged unless a colleague whose
    // own limit covers it gave their PIN on the till.
    const share = discountBps(totals.discount, totals.subtotal);
    const covers = (role: ResolvedRole) => levelOf(role, 'sell') === 'yes' && (role.discountLimitBps === null || share <= role.discountLimitBps);
    if (member.role.discountLimitBps !== null && share > member.role.discountLimitBps && !(approver && approval && covers(approval.role))) flags.push({ code: 'discount_over_limit', staff: by.name, bps: share });

    try {
      const saleId = await this.prisma.$transaction(async tx => {
        const ids = lines.map(line => line.listing_id);
        await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${[...ids].sort()}::uuid[]) ORDER BY "id" FOR UPDATE`;
        const rows = await tx.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, customerId: true, title: true, sku: true, barcode: true, status: true, priceMinor: true, stock: true, posEnabledAt: true, onShop: true, resale: true, outOfStockAt: true, expiresAt: true, country: true } });
        const byId = new Map(rows.map(row => [row.id, row]));
        const { shops, split } = await shopsOf(tx, account.id);
        const shopRow = shops.find(shop => shop.id === till.shopId);
        const levels = split && shopRow ? await levelsOf(tx, ids) : null;
        const prices = await shopPricesOf(tx, ids, till.shopId);
        const taken = new Map<string, number>();
        for (const [index, line] of lines.entries()) {
          const row = byId.get(line.listing_id);
          // A product the owner never had is a forged sale, not a stale copy.
          if (!row || row.customerId !== owner.id) throw invalid('product_unavailable', 'This product is not one of the shop’s.', `lines[${index}].listing_id`);
          const title = row.title ?? 'Untitled listing';
          const counted = Boolean(row.posEnabledAt) && posCountedStatuses.includes(row.status);
          if (!counted) flags.push({ code: 'unticked', listing_id: row.id, title });
          const price = prices.get(row.id) ?? row.priceMinor;
          if (price !== line.unit) flags.push({ code: 'price_changed', listing_id: row.id, title, sold_at: Number(line.unit), price: price === null ? null : Number(price) });
          if (!counted) {
            taken.set(row.id, 0);
            continue;
          }
          const held = await heldUnits(tx, row.id);
          const free = levels && shopRow ? freeAtShop({ stock: row.stock, held, levels: levels.get(row.id), shopId: shopRow.id, fulfilsOnline: shopRow.fulfilsOnline }) : Math.max(0, row.stock - held);
          const take = Math.min(line.quantity, free);
          const short = line.quantity - take;
          // Units there but held for online buyers are the owner's to decide; none there at all is oversold.
          if (short) flags.push({ code: held > 0 && row.stock - take >= short ? 'held' : 'oversold', listing_id: row.id, title, short });
          taken.set(row.id, take);
        }

        const [counter] = await tx.$queryRaw<Array<{ n: number }>>`UPDATE "pos_shops" SET "sale_next" = "sale_next" + 1 WHERE "id" = ${till.shopId}::uuid RETURNING "sale_next" - 1 AS "n"`;
        // The till's shift, if one was open when it was sold.
        const openShift = await openShiftOf(tx, till.id);
        const shiftId = openShift && (await tx.posShift.findUnique({ where: { id: openShift }, select: { openedAt: true } }))!.openedAt <= soldAt ? openShift : null;
        const customer = entry.customer_id && uuid.test(entry.customer_id) ? await tx.posCustomer.findFirst({ where: { id: entry.customer_id, accountId: account.id }, select: { id: true } }) : null;
        const sale = await tx.posSale.create({
          data: {
            accountId: account.id,
            shopId: till.shopId,
            tillId: till.id,
            tillName: till.name,
            number: saleNumber(Number(counter!.n)),
            clientSaleId: entry.client_sale_id,
            currency: account.currency,
            subtotalMinor: totals.subtotal,
            discountMinor: totals.discount,
            vatBps: entry.vat_bps,
            vatMinor: totals.vat,
            totalMinor: totals.total,
            changeMinor: paid.change,
            soldByName: by.name,
            soldByStaffId: by.staffId,
            shiftId,
            customerId: customer?.id ?? null,
            note: entry.note?.trim() ? entry.note.trim().slice(0, 300) : null,
            clientCreatedAt: new Date(entry.client_created_at),
            createdAt: soldAt,
            offline: true,
            clientNumber: entry.client_number?.trim() ? entry.client_number.trim().slice(0, 20) : null,
            deviceId: device.id,
            uploadedAt: now,
            flags: flags as unknown as Prisma.InputJsonValue,
            lines: {
              create: lines.map((line, position) => {
                const row = byId.get(line.listing_id)!;
                const gross = line.unit * BigInt(line.quantity);
                const off = line.off > gross ? gross : line.off;
                return { listingId: row.id, position, title: row.title ?? 'Untitled listing', sku: row.sku, barcode: row.barcode, quantity: line.quantity, unitPriceMinor: line.unit, discountMinor: off, totalMinor: gross - off };
              }),
            },
            payments: { create: paid.payments.map((payment, position) => ({ position, method: payment.method, amountMinor: payment.amount, tenderedMinor: payment.tendered, changeMinor: payment.change, reference: payment.reference })) },
          },
        });
        if (customer) await tx.$executeRaw`UPDATE "pos_customers" SET "sales_count" = "sales_count" + 1, "spent_minor" = "spent_minor" + ${totals.total}, "last_sale_at" = GREATEST(COALESCE("last_sale_at", ${soldAt}), ${soldAt}), "updated_at" = ${now} WHERE "id" = ${customer.id}::uuid`;
        for (const line of lines) {
          const row = byId.get(line.listing_id)!;
          const take = taken.get(row.id) ?? 0;
          if (!take) continue;
          const stock = row.stock - take;
          if (levels) await changeLevel(tx, row.id, till.shopId, -take, now);
          await this.sales.setStock(tx, row, stock, now);
          row.stock = stock;
          // Dated when it was sold, so a shelf count made offline later is worked out against it.
          await tx.posStockMovement.create({ data: { accountId: account.id, listingId: row.id, shopId: till.shopId, reason: 'sale', delta: -take, stockAfter: stock, saleId: sale.id, note: 'Sold offline', byStaffId: by.staffId, byName: by.name, createdAt: soldAt } });
        }
        if (approver) await tx.posApproval.create({ data: { accountId: account.id, action: 'offline_sale', subjectId: sale.id, requestedByStaffId: seller.id, requestedByName: by.name, approvedByStaffId: approver.id, approvedByName: fullName(approver), tillId: till.id } });
        return sale.id;
      });
      const sale = await this.prisma.posSale.findUniqueOrThrow({ where: { id: saleId }, select: { id: true, number: true, clientNumber: true, flags: true } });
      if (flags.length) this.logger.log(`Offline sale ${sale.number} flagged: ${flags.map(flag => flag.code).join(', ')}`);
      return { client_id: entry.client_sale_id, kind: 'sale', status: 'applied', sale: { id: sale.id, number: sale.number, client_number: sale.clientNumber, flags: sale.flags as OfflineFlag[] } };
    } catch (error) {
      // The same sale sent twice at once: the one that won is the sale.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const won = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.client_sale_id } }, select: { id: true, number: true, clientNumber: true, flags: true } });
        if (won) return { client_id: entry.client_sale_id, kind: 'sale', status: 'duplicate', sale: { id: won.id, number: won.number, client_number: won.clientNumber, flags: won.flags as OfflineFlag[] } };
      }
      throw error;
    }
  }

  /** A refund made offline of one of this till's sales (a manager's PIN given on the till). */
  private async applyRefund(owner: CustomerWithStore, device: DeviceRow, entry: OfflineRefundEntry): Promise<Result> {
    if (typeof entry.sale_client_id !== 'string' || !uuid.test(entry.sale_client_id)) throw invalid('parameter_invalid', 'Say which sale it refunds.', 'sale_client_id');
    if (typeof entry.staff_id !== 'string' || !uuid.test(entry.staff_id)) throw invalid('parameter_invalid', 'Say who refunded it.', 'staff_id');
    const sale = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.sale_client_id } }, select: { id: true, number: true, clientNumber: true, flags: true, status: true, tillId: true, payments: { select: { method: true } } } });
    if (!sale || sale.tillId !== device.tillId) throw notFound('sale at this till');
    const present = { id: sale.id, number: sale.number, client_number: sale.clientNumber, flags: sale.flags as OfflineFlag[] };
    if (sale.status === 'refunded') return { client_id: entry.client_id, kind: 'refund', status: 'duplicate', sale: present };
    // Money Udozo moved (the Udozo wallet, a Udozo account) or pay later is refunded online only, with the role's own
    // checks: an offline refund is taken on trust and only flagged, so it never moves money through Udozo.
    if (!sale.payments.every(payment => (recordedPaymentMethods as readonly string[]).includes(payment.method))) throw conflict('refund_online_only', `${sale.number} was paid through Udozo or on credit. Refund it at the till once it is online.`);
    const member = await this.member(device.accountId, entry.staff_id, device.tillId);
    if (!member) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    const refunder = member.row;
    await this.sales.refund(owner, sale.id, { reason: entry.reason, restock: entry.restock }, { by: member.by, tills: [device.tillId] });
    // The refund stands (the money went back at the counter) but is flagged unless the role refunds, or a colleague who
    // refunds gave their PIN.
    const approval = await this.member(device.accountId, entry.approved_by_staff_id, device.tillId);
    const level = levelOf(member.role, 'refund');
    const approved = Boolean(approval && approval.trusted && approval.row.id !== refunder.id && levelOf(approval.role, 'refund') === 'yes');
    if ((level !== 'yes' && !(level === 'approval' && approved)) || !member.trusted) {
      const flagged = [...(sale.flags as OfflineFlag[]), { code: 'refund_unapproved' as const, staff: member.by.name }];
      await this.prisma.posSale.update({ where: { id: sale.id }, data: { flags: flagged as unknown as Prisma.InputJsonValue, flagsResolvedAt: null, flagsResolvedBy: null } });
      present.flags = flagged;
    }
    if (approved && approval) await this.prisma.posApproval.create({ data: { accountId: device.accountId, action: 'refund', subjectId: sale.id, requestedByStaffId: refunder.id, requestedByName: fullName(refunder), approvedByStaffId: approval.row.id, approvedByName: approval.by.name, tillId: device.tillId } });
    return { client_id: entry.client_id, kind: 'refund', status: 'applied', sale: present };
  }

  /** The time an offline step happened: as the till gave it, never in the future nor more than a week back. */
  private at(value: string, now = new Date()) {
    return this.soldAt(value, now);
  }

  /** A shift step's time, never before the shift opened. */
  private atOrAfter(value: string, from: Date) {
    const at = this.at(value);
    return at < from ? from : at;
  }

  /** A member of staff who may open, count and close shifts (`till` or `cash_up`), else refused. */
  private async shiftWorker(accountId: string, staffId: string, tillId: string) {
    const member = await this.member(accountId, staffId, tillId);
    if (!member) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    if (!member.trusted) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_permission_required', `${member.by.name} cannot work at this till.`, 'staff_id');
    if (levelOf(member.role, 'till') !== 'yes' && levelOf(member.role, 'cash_up') !== 'yes') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_permission_required', `${member.by.name}'s role does not open or close tills.`, 'staff_id');
    return member;
  }

  /** The shift an offline step is about: one this till opened offline (`shift_client_id`) or online (`shift_id`). */
  private async shiftFor(device: DeviceRow, entry: { shift_client_id?: string | null; shift_id?: string | null }) {
    const where = entry.shift_client_id && uuid.test(entry.shift_client_id) ? { accountId: device.accountId, clientId: entry.shift_client_id } : entry.shift_id && uuid.test(entry.shift_id) ? { accountId: device.accountId, id: entry.shift_id } : null;
    const shift = where ? await this.prisma.posShift.findFirst({ where: { ...where, tillId: device.tillId } }) : null;
    if (!shift) throw notFound('shift at this till');
    return shift;
  }

  private async applyShiftOpen(owner: CustomerWithStore, device: DeviceRow, entry: OfflineShiftOpenEntry): Promise<Result> {
    const done = await this.prisma.posShift.findFirst({ where: { accountId: device.accountId, clientId: entry.client_id } });
    if (done) return { client_id: entry.client_id, kind: 'shift_open', status: 'duplicate', shift: { id: done.id, status: done.status } };
    const member = await this.shiftWorker(device.accountId, entry.staff_id, device.tillId);
    const made = await this.shifts.open(owner, { till_id: device.tillId, opening_float: entry.opening_float, note: entry.note ?? null }, { by: member.by, at: this.at(entry.at), clientId: entry.client_id });
    return { client_id: entry.client_id, kind: 'shift_open', status: 'applied', shift: { id: made.id, status: made.status } };
  }

  private async applyShiftCash(owner: CustomerWithStore, device: DeviceRow, entry: OfflineShiftCashEntry): Promise<Result> {
    const done = await this.prisma.posShiftCash.findFirst({ where: { clientId: entry.client_id }, include: { shift: { select: { id: true, status: true, accountId: true } } } });
    if (done && done.shift.accountId === device.accountId) return { client_id: entry.client_id, kind: 'shift_cash', status: 'duplicate', shift: { id: done.shift.id, status: done.shift.status } };
    const member = await this.shiftWorker(device.accountId, entry.staff_id, device.tillId);
    const shift = await this.shiftFor(device, entry);
    const after = await this.shifts.cash(owner, shift.id, { kind: entry.cash_kind, amount: entry.amount, reason: entry.reason }, { by: member.by, at: this.atOrAfter(entry.at, shift.openedAt), clientId: entry.client_id });
    return { client_id: entry.client_id, kind: 'shift_cash', status: 'applied', shift: { id: after.id, status: after.status } };
  }

  private async applyShiftClose(owner: CustomerWithStore, device: DeviceRow, entry: OfflineShiftCloseEntry): Promise<Result> {
    const shift = await this.shiftFor(device, entry);
    if (shift.status === 'closed') return { client_id: entry.client_id, kind: 'shift_close', status: 'duplicate', shift: { id: shift.id, status: shift.status } };
    const member = await this.shiftWorker(device.accountId, entry.staff_id, device.tillId);
    const after = await this.shifts.close(owner, shift.id, { counted: entry.counted, note: entry.note ?? null }, { by: member.by, at: this.atOrAfter(entry.at, shift.openedAt) });
    return { client_id: entry.client_id, kind: 'shift_close', status: 'applied', shift: { id: after.id, status: after.status } };
  }

  /** New stock, a count or damage made offline: `stock_adjust` outright, or with a PIN from a colleague who has it. */
  private async applyStock(owner: CustomerWithStore, device: DeviceRow, entry: OfflineStockEntry): Promise<Result> {
    const done = await this.prisma.posStockMovement.findFirst({ where: { accountId: device.accountId, clientId: entry.client_id }, select: { id: true } });
    if (done) return { client_id: entry.client_id, kind: 'stock', status: 'duplicate' };
    const member = await this.member(device.accountId, entry.staff_id, device.tillId);
    if (!member) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    if (!member.trusted) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_permission_required', `${member.by.name} cannot work at this till.`, 'staff_id');
    const level = levelOf(member.role, 'stock_adjust');
    const approval = await this.member(device.accountId, entry.approved_by_staff_id, device.tillId);
    const approved = Boolean(approval && approval.trusted && approval.row.id !== member.row.id && levelOf(approval.role, 'stock_adjust') === 'yes');
    if (level !== 'yes' && !(level === 'approval' && approved)) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', level === 'approval' ? 'approval_required' : 'pos_permission_required', level === 'approval' ? "This stock change needed a manager's PIN." : `${member.by.name}'s role does not change stock.`, 'staff_id');
    if (!['restock', 'count', 'damage'].includes(entry.adjustment)) throw invalid('parameter_invalid', 'A stock change is new stock, a count or damage.', 'adjustment');
    const till = await this.prisma.posTill.findUniqueOrThrow({ where: { id: device.tillId }, select: { shopId: true } });
    const at = this.at(entry.at);
    let quantity = entry.quantity;
    if (entry.adjustment === 'count' && Number.isInteger(quantity) && quantity >= 0) {
      // A count is what was on the shelf when it was made: what moved since (sales online and at other tills, deliveries)
      // is added to it, so counting offline never undoes them.
      const { split } = await shopsOf(this.prisma, device.accountId);
      const since = await this.prisma.posStockMovement.aggregate({ _sum: { delta: true }, where: { accountId: device.accountId, listingId: entry.listing_id, createdAt: { gt: at }, ...(split ? { shopId: till.shopId } : {}) } });
      quantity = Math.max(0, quantity + (since._sum.delta ?? 0));
    }
    await this.sales.adjustStock(owner, entry.listing_id, { kind: entry.adjustment, quantity, note: entry.note ?? 'Changed offline', shop_id: till.shopId, client_id: entry.client_id, at }, member.by);
    if (approved && approval) await this.prisma.posApproval.create({ data: { accountId: device.accountId, action: 'offline_stock', subjectId: entry.listing_id, requestedByStaffId: member.row.id, requestedByName: member.by.name, approvedByStaffId: approval.row.id, approvedByName: approval.by.name, tillId: device.tillId } });
    return { client_id: entry.client_id, kind: 'stock', status: 'applied' };
  }

  /** Receipts the till was asked to send while offline, sent once the sale is uploaded (never for a duplicate). */
  private async sendReceipts(owner: CustomerWithStore, entry: OfflineSaleEntry, result: Result): Promise<Result> {
    if (result.status !== 'applied' || !result.sale || !entry.receipt) return result;
    const sent: NonNullable<Result['receipts']> = [];
    const attempt = async (via: 'whatsapp' | 'email', work: () => Promise<unknown>) => {
      try {
        await work();
        sent.push({ via, ok: true });
      } catch (error) {
        sent.push({ via, ok: false, message: error instanceof ApiError ? error.message : 'It could not be sent.' });
      }
    };
    const by: PosBy = { customerId: null, staffId: entry.staff_id, name: 'Offline till' };
    if (entry.receipt.whatsapp?.trim()) await attempt('whatsapp', () => this.receipts.sendWhatsapp(owner, result.sale!.id, { phone: entry.receipt!.whatsapp!.trim() }, { by }));
    if (entry.receipt.email?.trim()) await attempt('email', () => this.receipts.sendEmail(owner, result.sale!.id, { email: entry.receipt!.email!.trim() }, { by }));
    return { ...result, receipts: sent };
  }

  // ---- The device's key and files of unsent sales ----

  /** Keeps the device's own public key (ECDSA P-256, JWK), so a file of its unsent sales can be checked against it. */
  async setKey(device: { id: string }, key: unknown) {
    const jwk = key as { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown };
    const part = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{40,50}$/.test(value);
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !part(jwk.x) || !part(jwk.y)) throw invalid('parameter_invalid', 'Send the device key as an EC P-256 public key.', 'public_key');
    const clean = { kty: 'EC', crv: 'P-256', x: jwk.x as string, y: jwk.y as string };
    try {
      createPublicKey({ key: clean, format: 'jwk' });
    } catch {
      throw invalid('parameter_invalid', 'That is not a usable key.', 'public_key');
    }
    await this.prisma.posDevice.update({ where: { id: device.id }, data: { publicKey: clean } });
    return { object: 'pos_device_key' as const, saved: true };
  }

  /**
   * A file of a till's unsent sales, saved on the till and brought to a signed-in device (the browser's data was at risk,
   * or the till cannot get online): checked against the till's own key, then applied like its upload, each entry once.
   */
  async importFile(customer: CustomerWithStore, file: { payload: string; signature: string }) {
    const account = await this.sales.account(customer);
    let body: { object?: string; device_id?: string; entries?: OfflineEntry[] };
    try {
      body = JSON.parse(file.payload);
    } catch {
      throw invalid('parameter_invalid', 'This is not a file of unsent sales from Udozo POS.', 'payload');
    }
    if (body.object !== 'pos_offline_export' || typeof body.device_id !== 'string' || !uuid.test(body.device_id) || !Array.isArray(body.entries) || !body.entries.length) throw invalid('parameter_invalid', 'This is not a file of unsent sales from Udozo POS.', 'payload');
    if (body.entries.length > maxImportEntries) throw invalid('parameter_invalid', `A file holds at most ${maxImportEntries} entries. Save the rest to another file.`, 'payload');
    const device = await this.prisma.posDevice.findFirst({ where: { id: body.device_id, accountId: account.id, linkedAt: { not: null } } });
    if (!device) throw notFound('till device');
    if (!device.publicKey) throw conflict('device_key_missing', 'This till never registered its key, so its file cannot be checked. Upload its sales from the till itself.');
    let valid = false;
    try {
      valid = verify('sha256', Buffer.from(file.payload), { key: createPublicKey({ key: device.publicKey as never, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(file.signature, 'base64'));
    } catch {
      valid = false;
    }
    if (!valid) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_request_error', 'file_signature_invalid', 'This file was changed or did not come from that till.', 'signature');
    const results: Result[] = [];
    for (let at = 0; at < body.entries.length; at += maxUploadEntries) {
      const chunk = await this.upload({ id: device.id, accountId: device.accountId, tillId: device.tillId, revokedAt: device.revokedAt, lastSyncedAt: device.lastSyncedAt, name: device.name }, body.entries.slice(at, at + maxUploadEntries));
      results.push(...chunk.results);
    }
    return { object: 'pos_offline_import' as const, device: { id: device.id, name: device.name }, results };
  }

  // ---- Tills gone quiet ----

  /** Tells each owner once when a linked till has not synced for a day (again only after it syncs). */
  async notifyUnsynced(now = new Date()) {
    const before = new Date(now.getTime() - unsyncedAfterMs);
    const quiet = await this.prisma.posDevice.findMany({
      where: { revokedAt: null, linkedAt: { not: null, lt: before }, unsyncedNotifiedAt: null, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: before } }] },
      include: { till: { select: { name: true, shop: { select: { name: true } } } }, account: { select: { id: true, customerId: true } } },
      take: 200,
    });
    let told = 0;
    for (const device of quiet) {
      const claimed = await this.prisma.posDevice.updateMany({ where: { id: device.id, unsyncedNotifiedAt: null }, data: { unsyncedNotifiedAt: now } });
      if (!claimed.count) continue;
      told += 1;
      const title = `${device.till.name} has not synced for a day`;
      const body = `${device.name ?? 'The device'} at ${device.till.shop.name}'s ${device.till.name} has not been online with Udozo POS since ${(device.lastSyncedAt ?? device.linkedAt!).toISOString().slice(0, 16).replace('T', ' ')} UTC. Sales made there offline wait on it until it is back online; it stops selling after your plan's offline limit.`;
      void this.inbox.customer({ customerId: device.account.customerId, storeId: houseStoreId }, 'customer.pos.till', { subject: `pos:till:${device.id}:${now.toISOString().slice(0, 10)}`, title, body, link: '/app/offline' }).catch(() => undefined);
      this.notices.customerAt(device.account.customerId, { title, body, path: '/app/offline', action: 'Open Udozo POS' }, this.config.POS_URL);
    }
    return { told };
  }

  // ---- What the owner looks at ----

  /** Offline sales with something to look at, newest first. */
  async flagged(customer: CustomerWithStore, filter: { resolved?: boolean; limit?: number; offset?: number }) {
    const account = await this.sales.account(customer);
    const where: Prisma.PosSaleWhereInput = { accountId: account.id, NOT: { flags: { equals: [] } }, flagsResolvedAt: filter.resolved ? { not: null } : null };
    const take = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    const skip = Math.max(filter.offset ?? 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.posSale.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, skip, select: { id: true, number: true, clientNumber: true, tillName: true, soldByName: true, totalMinor: true, currency: true, flags: true, createdAt: true, uploadedAt: true, flagsResolvedAt: true, flagsResolvedBy: true } }),
      this.prisma.posSale.count({ where }),
    ]);
    return {
      object: 'list' as const,
      total,
      has_more: skip + take < total,
      data: rows.map(row => ({
        object: 'pos_flagged_sale' as const,
        id: row.id,
        number: row.number,
        client_number: row.clientNumber,
        till: row.tillName,
        sold_by: row.soldByName,
        total: Number(row.totalMinor),
        currency: row.currency,
        flags: row.flags as OfflineFlag[],
        sold_at: row.createdAt.toISOString(),
        uploaded_at: row.uploadedAt ? row.uploadedAt.toISOString() : null,
        resolved_at: row.flagsResolvedAt ? row.flagsResolvedAt.toISOString() : null,
        resolved_by: row.flagsResolvedBy,
      })),
    };
  }

  /** Marks an offline sale's flags looked at (the stock put right by a count, transfer or restock). */
  async resolve(customer: CustomerWithStore, saleId: string, by: PosBy) {
    const account = await this.sales.account(customer);
    const sale = await this.prisma.posSale.findFirst({ where: { id: saleId, accountId: account.id }, select: { id: true, flags: true, flagsResolvedAt: true } });
    if (!sale || !(sale.flags as unknown[]).length) throw notFound('flagged sale');
    if (!sale.flagsResolvedAt) await this.prisma.posSale.update({ where: { id: sale.id }, data: { flagsResolvedAt: new Date(), flagsResolvedBy: by.name.slice(0, 120) } });
    return (await this.flagged(customer, { resolved: true, limit: 100 })).data.find(row => row.id === sale.id)!;
  }

  /** What unlinked devices uploaded, waiting for the owner. */
  async held(customer: CustomerWithStore, status: 'held' | 'accepted' | 'rejected' = 'held') {
    const account = await this.sales.account(customer);
    const rows = await this.prisma.posOfflineHeld.findMany({ where: { accountId: account.id, status }, orderBy: { createdAt: 'asc' }, take: 200 });
    const devices = new Map((await this.prisma.posDevice.findMany({ where: { id: { in: rows.map(row => row.deviceId) } }, select: { id: true, name: true, till: { select: { name: true } } } })).map(row => [row.id, row]));
    return { object: 'list' as const, currency: account.currency, data: rows.map(row => this.presentHeld(row, devices.get(row.deviceId))) };
  }

  private presentHeld(row: { id: string; deviceId: string; entry: Prisma.JsonValue; status: string; decidedBy: string | null; decidedAt: Date | null; saleId: string | null; createdAt: Date }, device?: { name: string | null; till: { name: string } }) {
    const entry = row.entry as unknown as OfflineSaleEntry;
    return {
      object: 'pos_offline_held' as const,
      id: row.id,
      device: { id: row.deviceId, name: device?.name ?? null, till: device?.till.name ?? null },
      client_number: entry.client_number ?? null,
      sold_at: entry.client_created_at,
      items: (entry.lines ?? []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
      total: Number(entry.total) || 0,
      payments: (entry.payments ?? []).map(payment => ({ method: payment.method, amount: Number(payment.amount) || 0 })),
      status: row.status,
      decided_by: row.decidedBy,
      decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
      sale_id: row.saleId,
      uploaded_at: row.createdAt.toISOString(),
    };
  }

  /** The owner accepts a held sale (it becomes a sale, flagged as from an unlinked device) or rejects it. */
  async decide(customer: CustomerWithStore, id: string, decision: 'accept' | 'reject', by: PosBy) {
    const account = await this.sales.account(customer);
    const row = await this.prisma.posOfflineHeld.findFirst({ where: { id, accountId: account.id } });
    if (!row) throw notFound('held sale');
    if (row.status !== 'held') throw conflict('held_decided', `This sale was ${row.status} already.`);
    let saleId: string | null = null;
    if (decision === 'accept') {
      const result = await this.applySale(customer, { id: row.deviceId, accountId: account.id, tillId: row.tillId, lastSyncedAt: null }, row.entry as unknown as OfflineSaleEntry, [{ code: 'device_unlinked' }]);
      saleId = result.sale?.id ?? null;
    }
    const claimed = await this.prisma.posOfflineHeld.updateMany({ where: { id, status: 'held' }, data: { status: decision === 'accept' ? 'accepted' : 'rejected', decidedBy: by.name.slice(0, 120), decidedAt: new Date(), saleId } });
    if (!claimed.count) throw conflict('held_decided', 'This sale was decided meanwhile.');
    const fresh = await this.prisma.posOfflineHeld.findUniqueOrThrow({ where: { id } });
    const device = await this.prisma.posDevice.findUnique({ where: { id: fresh.deviceId }, select: { name: true, till: { select: { name: true } } } });
    return this.presentHeld(fresh, device ?? undefined);
  }
}
