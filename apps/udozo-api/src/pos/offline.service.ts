import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { heldUnits } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PosBy } from './actor.js';
import { PosCatalogueService } from './catalogue.service.js';
import { posCountedStatuses } from './catalogue-rules.js';
import { saleTotals } from './money.js';
import { checkPayments, maxLineQuantity, maxSaleLines, type PaymentInput, recordedPaymentMethods, type RecordedPaymentMethod, saleNumber } from './sale-rules.js';
import { openShiftOf, PosSalesService } from './sales.service.js';
import { PosStaffService } from './staff.service.js';
import { changeLevel, freeAtShop, levelsOf, pausedShops, shopPricesOf, shopsOf } from './stock-levels.js';

/** How long and how much a till may sell with no internet before it must sync (the till stops itself; warnings from `warn_hours`). */
export const offlineLimits = { hours: 72, sales: 500, warn_hours: 48 } as const;
/** Entries a till uploads at once. */
export const maxUploadEntries = 50;
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
export type OfflineEntry = OfflineSaleEntry | OfflineRefundEntry;

/** What to look at in an offline sale, as kept on it. */
export type OfflineFlag =
  | { code: 'oversold' | 'held'; listing_id: string; title: string; short: number }
  | { code: 'unticked'; listing_id: string; title: string }
  | { code: 'price_changed'; listing_id: string; title: string; sold_at: number; price: number | null }
  | { code: 'staff_suspended'; staff: string }
  | { code: 'device_unlinked' }
  | { code: 'beyond_offline_limit'; hours: number };

type Result = { client_id: string; kind: 'sale' | 'refund'; status: 'applied' | 'duplicate' | 'held' | 'rejected'; sale?: { id: string; number: string; client_number: string | null; flags: OfflineFlag[] }; error?: { code: string; message: string; param?: string } };
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
  ) {}

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
    await this.prisma.posDevice.update({ where: { id: device.id }, data: { lastSyncedAt: now, lastSeenAt: now } });
    const shop = till.shop;
    return {
      object: 'pos_offline_copy' as const,
      synced_at: now.toISOString(),
      limits: offlineLimits,
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
        blocked: product.blocked,
      })),
    };
  }

  // ---- Uploading ----

  /** A till's offline entries, in the order they happened: each applied once, its result answered. */
  async upload(device: DeviceRow, entries: OfflineEntry[]) {
    if (!Array.isArray(entries) || !entries.length || entries.length > maxUploadEntries) throw invalid('parameter_invalid', `Upload 1 to ${maxUploadEntries} entries at once.`, 'entries');
    const owner = await this.owner(device.accountId);
    const results: Result[] = [];
    for (const [index, entry] of entries.entries()) {
      const clientId = entry?.kind === 'refund' ? entry.client_id : entry?.client_sale_id;
      const kind = entry?.kind === 'refund' ? 'refund' : 'sale';
      try {
        if (entry?.kind !== 'sale' && entry?.kind !== 'refund') throw invalid('parameter_invalid', 'Each entry is a sale or a refund.', `entries[${index}].kind`);
        if (typeof clientId !== 'string' || !uuid.test(clientId)) throw invalid('parameter_invalid', 'Each entry has its own id.', `entries[${index}]`);
        if (device.revokedAt) {
          results.push(entry.kind === 'sale' ? await this.hold(device, entry) : { client_id: clientId, kind, status: 'rejected', error: { code: 'device_unlinked', message: 'This device was unlinked: refunds wait for a linked till.' } });
          continue;
        }
        results.push(entry.kind === 'sale' ? await this.applySale(owner, device, entry) : await this.applyRefund(owner, device, entry));
      } catch (error) {
        // A refusal is that entry's answer and the till moves on; anything else stops the upload, to be sent again.
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
  async applySale(owner: CustomerWithStore, device: { id: string; accountId: string; tillId: string | null; lastSyncedAt: Date | null }, entry: OfflineSaleEntry, extraFlags: OfflineFlag[] = []): Promise<Result> {
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
    if (device.lastSyncedAt && soldAt.getTime() - device.lastSyncedAt.getTime() > offlineLimits.hours * 3_600_000) flags.push({ code: 'beyond_offline_limit', hours: Math.floor((soldAt.getTime() - device.lastSyncedAt.getTime()) / 3_600_000) });

    // Who sold it: kept as they were, flagged if suspended or removed meanwhile.
    const seller = await this.prisma.posStaff.findFirst({ where: { id: entry.staff_id, accountId: account.id } });
    if (!seller) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    const by: PosBy = { customerId: null, staffId: seller.id, name: fullName(seller) };
    if (seller.status !== 'active') flags.push({ code: 'staff_suspended', staff: by.name });
    const approver = entry.approved_by_staff_id && uuid.test(entry.approved_by_staff_id) ? await this.prisma.posStaff.findFirst({ where: { id: entry.approved_by_staff_id, accountId: account.id }, select: { id: true, firstName: true, lastName: true } }) : null;

    const lines = entry.lines.map((line, index) => ({ ...line, unit: minorOf(line.unit_price, `lines[${index}].unit_price`), off: minorOf(line.discount, `lines[${index}].discount`) }));
    const totals = saleTotals(
      lines.map(line => ({ unit: line.unit, quantity: line.quantity, discount: line.off })),
      { discount: minorOf(entry.discount, 'discount'), vatBps: entry.vat_bps },
    );
    if (typeof entry.total !== 'number' || BigInt(entry.total) !== totals.total) throw conflict('totals_mismatch', 'The total does not add up from its lines. Export it and send it to Udozo.', 'total');
    const parts: PaymentInput[] = entry.payments.map((payment, index) => ({ method: payment.method as RecordedPaymentMethod, amount: minorOf(payment.amount, `payments[${index}].amount`), tendered: payment.tendered === undefined || payment.tendered === null ? null : minorOf(payment.tendered, `payments[${index}].tendered`), reference: payment.reference?.slice(0, 80) ?? null }));
    const paid = checkPayments(parts, totals.total);

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
          await tx.posStockMovement.create({ data: { accountId: account.id, listingId: row.id, shopId: till.shopId, reason: 'sale', delta: -take, stockAfter: stock, saleId: sale.id, note: 'Sold offline', byStaffId: by.staffId, byName: by.name } });
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
    const sale = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: device.accountId, clientSaleId: entry.sale_client_id } }, select: { id: true, number: true, clientNumber: true, flags: true, status: true, tillId: true } });
    if (!sale || sale.tillId !== device.tillId) throw notFound('sale at this till');
    const present = { id: sale.id, number: sale.number, client_number: sale.clientNumber, flags: sale.flags as OfflineFlag[] };
    if (sale.status === 'refunded') return { client_id: entry.client_id, kind: 'refund', status: 'duplicate', sale: present };
    const refunder = await this.prisma.posStaff.findFirst({ where: { id: entry.staff_id, accountId: device.accountId } });
    if (!refunder) throw invalid('parameter_invalid', 'That member of staff is not on this account.', 'staff_id');
    await this.sales.refund(owner, sale.id, { reason: entry.reason, restock: entry.restock }, { by: { customerId: null, staffId: refunder.id, name: fullName(refunder) }, tills: [device.tillId] });
    if (entry.approved_by_staff_id && uuid.test(entry.approved_by_staff_id)) {
      const approver = await this.prisma.posStaff.findFirst({ where: { id: entry.approved_by_staff_id, accountId: device.accountId }, select: { id: true, firstName: true, lastName: true } });
      if (approver) await this.prisma.posApproval.create({ data: { accountId: device.accountId, action: 'refund', subjectId: sale.id, requestedByStaffId: refunder.id, requestedByName: fullName(refunder), approvedByStaffId: approver.id, approvedByName: fullName(approver), tillId: device.tillId } });
    }
    return { client_id: entry.client_id, kind: 'refund', status: 'applied', sale: present };
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
