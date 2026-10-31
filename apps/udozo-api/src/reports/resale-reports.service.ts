import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';

/** Orders whose money has been released (wholly or after a part refund). */
const settled = ['released', 'partly_refunded'];
const open = ['locked', 'paid', 'sent', 'disputed'];

const sum = (value: bigint | null | undefined) => minor(value ?? 0n);

/**
 * B2B reselling, stage 5: reports on resale orders. A reseller's own (`/v1/reports/resale`): their orders by state,
 * sales, margin, BitoCard's fee and their earnings from the orders released in the period, per store and per listing.
 * BitoCard's (`/v1/admin/reports/resale`): Safe pay's fees by market, BitoCard Shop's own sales beside resale, each
 * side's fee told apart. Built from the orders' own fixed figures, so a later price or rule change never moves them.
 */
@Injectable()
export class ResaleReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async reseller(input: { resellerId: string; mode: LedgerMode; from: Date; to: Date; storeId?: string }) {
    const base: Prisma.ClassifiedOrderWhereInput = { kind: 'resale', resellerId: input.resellerId, mode: input.mode, ...(input.storeId ? { storeId: input.storeId } : {}) };
    const releasedIn: Prisma.ClassifiedOrderWhereInput = { ...base, status: { in: settled }, releasedAt: { gte: input.from, lt: input.to } };
    const [byStatus, totals, refunded, byStore, byListing] = await Promise.all([
      this.prisma.classifiedOrder.groupBy({ by: ['status'], where: { ...base, createdAt: { gte: input.from, lt: input.to } }, _count: { _all: true } }),
      this.prisma.classifiedOrder.groupBy({
        by: ['currency'],
        where: releasedIn,
        _count: { _all: true },
        _sum: { priceMinor: true, resellerMarginMinor: true, resellerFeeMinor: true, resellerPayoutMinor: true, refundMinor: true },
      }),
      this.prisma.classifiedOrder.groupBy({ by: ['currency'], where: { ...base, status: 'refunded', refundedAt: { gte: input.from, lt: input.to } }, _count: { _all: true }, _sum: { priceMinor: true } }),
      this.prisma.classifiedOrder.groupBy({ by: ['storeId', 'currency'], where: releasedIn, _count: { _all: true }, _sum: { priceMinor: true, resellerPayoutMinor: true } }),
      this.prisma.classifiedOrder.groupBy({ by: ['listingId', 'currency'], where: releasedIn, _count: { _all: true }, _sum: { priceMinor: true, resellerPayoutMinor: true }, orderBy: { _sum: { resellerPayoutMinor: 'desc' } }, take: 10 }),
    ]);
    const [stores, listings] = await Promise.all([
      this.prisma.store.findMany({ where: { id: { in: byStore.map(row => row.storeId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.classifiedListing.findMany({ where: { id: { in: byListing.map(row => row.listingId) } }, select: { id: true, ref: true, title: true } }),
    ]);
    const count = (statuses: string[]) => byStatus.filter(row => statuses.includes(row.status)).reduce((total, row) => total + row._count._all, 0);
    return {
      object: 'reseller_resale_report' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      store_id: input.storeId ?? null,
      orders: {
        placed: count(byStatus.map(row => row.status)),
        open: count(open),
        completed: count(settled),
        refunded: count(['refunded']),
        not_accepted: count(['declined', 'lapsed', 'cancelled']),
      },
      totals: totals.map(row => ({
        currency: row.currency,
        orders: row._count._all,
        sales: sum(row._sum.priceMinor),
        margin: sum(row._sum.resellerMarginMinor),
        reseller_fees: sum(row._sum.resellerFeeMinor),
        earnings: sum(row._sum.resellerPayoutMinor),
        part_refunds: sum(row._sum.refundMinor),
      })),
      refunded: refunded.map(row => ({ currency: row.currency, orders: row._count._all, sales: sum(row._sum.priceMinor) })),
      by_store: byStore.map(row => ({ store: { id: row.storeId!, name: stores.find(store => store.id === row.storeId)?.name ?? '' }, currency: row.currency, orders: row._count._all, sales: sum(row._sum.priceMinor), earnings: sum(row._sum.resellerPayoutMinor) })),
      top_listings: byListing.map(row => {
        const listing = listings.find(item => item.id === row.listingId);
        return { listing: { id: row.listingId, ref: listing ? Number(listing.ref) : null, title: listing?.title ?? '' }, currency: row.currency, orders: row._count._all, sales: sum(row._sum.priceMinor), earnings: sum(row._sum.resellerPayoutMinor) };
      }),
    };
  }

  /** BitoCard's Safe pay and resale fees in a period, by market and kind (BitoCard Shop's own sales, resale). */
  async platform(input: { mode: LedgerMode; from: Date; to: Date; country?: string }) {
    const where: Prisma.ClassifiedOrderWhereInput = { mode: input.mode, status: { in: settled }, releasedAt: { gte: input.from, lt: input.to }, ...(input.country ? { country: input.country } : {}) };
    const [rows, refunded, resellers] = await Promise.all([
      this.prisma.classifiedOrder.groupBy({
        by: ['country', 'currency', 'kind'],
        where,
        _count: { _all: true },
        _sum: { priceMinor: true, deliveryFeeMinor: true, buyerFeeMinor: true, sellerFeeMinor: true, resellerFeeMinor: true, refundMinor: true },
      }),
      this.prisma.classifiedOrder.groupBy({
        by: ['country', 'currency', 'kind'],
        where: { mode: input.mode, status: 'refunded', refundedAt: { gte: input.from, lt: input.to }, ...(input.country ? { country: input.country } : {}) },
        _count: { _all: true },
        _sum: { priceMinor: true },
      }),
      this.prisma.classifiedOrder.groupBy({ by: ['resellerId', 'currency'], where: { ...where, kind: 'resale' }, _count: { _all: true }, _sum: { priceMinor: true, resellerFeeMinor: true }, orderBy: { _sum: { resellerFeeMinor: 'desc' } }, take: 10 }),
    ]);
    const names = await this.prisma.reseller.findMany({ where: { id: { in: resellers.map(row => row.resellerId!).filter(Boolean) } }, select: { id: true, name: true } });
    return {
      object: 'resale_fees_report' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      markets: rows.map(row => {
        const buyer = sum(row._sum.buyerFeeMinor);
        const seller = sum(row._sum.sellerFeeMinor);
        const reseller = sum(row._sum.resellerFeeMinor);
        return {
          country: row.country,
          currency: row.currency,
          kind: row.kind as 'direct' | 'resale',
          orders: row._count._all,
          sales: sum(row._sum.priceMinor),
          delivery: sum(row._sum.deliveryFeeMinor),
          part_refunds: sum(row._sum.refundMinor),
          buyer_fees: buyer,
          seller_fees: seller,
          reseller_fees: reseller,
          fees: buyer + seller + reseller,
        };
      }),
      refunded: refunded.map(row => ({ country: row.country, currency: row.currency, kind: row.kind as 'direct' | 'resale', orders: row._count._all, sales: sum(row._sum.priceMinor) })),
      top_resellers: resellers.map(row => ({ reseller: { id: row.resellerId!, name: names.find(item => item.id === row.resellerId)?.name ?? '' }, currency: row.currency, orders: row._count._all, sales: sum(row._sum.priceMinor), reseller_fees: sum(row._sum.resellerFeeMinor) })),
    };
  }
}
