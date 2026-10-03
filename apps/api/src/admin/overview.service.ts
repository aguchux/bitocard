import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import { receiptNumber } from '../orders/orders.service.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';

const day = 24 * 3600 * 1000;
/** A supplier whose catalogue has not synced for this long is shown as degraded. */
const staleSyncMs = 2 * day;
/** Reseller wallet balances: money BitoCard holds for resellers. */
const floatAccounts = ['reseller_funding', 'reseller_earnings', 'reseller_earnings_held', 'reseller_reserved', 'reseller_payouts_pending'] as const;

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** The admin dashboard: sales and orders by currency, money held for resellers, supplier health and what needs attention. */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: SupplierAdapters,
  ) {}

  async overview(input: { days: number; mode: LedgerMode }, now = new Date()) {
    const { days, mode } = input;
    const from = new Date(now.getTime() - days * day);
    const previousFrom = new Date(from.getTime() - days * day);

    // Sales count when the order is delivered (refunded orders were sales too, then refunded).
    const sold = await this.prisma.order.findMany({
      where: { mode, status: { in: ['completed', 'refunded'] }, completedAt: { gte: previousFrom, lte: now } },
      select: { completedAt: true, priceMinor: true, currency: true },
    });
    const currencies = [...new Set(sold.map(order => order.currency))].sort();
    const totals = new Map<string, { gross: bigint; orders: number; previousGross: bigint; previousOrders: number }>();
    const points = new Map<string, Map<string, { gross: bigint; orders: number }>>();
    for (const order of sold) {
      const total = totals.get(order.currency) ?? { gross: 0n, orders: 0, previousGross: 0n, previousOrders: 0 };
      if (order.completedAt! >= from) {
        total.gross += order.priceMinor;
        total.orders += 1;
        const byDay = points.get(order.currency) ?? new Map();
        const key = dateKey(order.completedAt!);
        const point = byDay.get(key) ?? { gross: 0n, orders: 0 };
        point.gross += order.priceMinor;
        point.orders += 1;
        byDay.set(key, point);
        points.set(order.currency, byDay);
      } else {
        total.previousGross += order.priceMinor;
        total.previousOrders += 1;
      }
      totals.set(order.currency, total);
    }
    const dates = Array.from({ length: days }, (_, index) => dateKey(new Date(from.getTime() + (index + 1) * day)));

    const float = await this.prisma.ledgerAccount.groupBy({ by: ['currency'], where: { mode, kind: { in: [...floatAccounts] } }, _sum: { balanceMinor: true } });
    const [active, pending, joined, previouslyJoined] = await Promise.all([
      this.prisma.reseller.count({ where: { status: 'active' } }),
      this.prisma.reseller.count({ where: { status: 'pending' } }),
      this.prisma.reseller.count({ where: { createdAt: { gte: from } } }),
      this.prisma.reseller.count({ where: { createdAt: { gte: previousFrom, lt: from } } }),
    ]);
    const [ordersNeedingReview, ordersProcessing, verificationsInReview] = await Promise.all([
      this.prisma.order.count({ where: { mode, needsReview: true, status: 'processing' } }),
      this.prisma.order.count({ where: { mode, status: 'processing' } }),
      this.prisma.identityVerification.count({ where: { status: 'in_review' } }),
    ]);
    const suppliers = await this.prisma.supplier.findMany({ where: { OR: [{ enabled: true }, { status: 'mvp_live' }] }, orderBy: { name: 'asc' } });
    const recent = await this.prisma.order.findMany({
      where: { mode },
      include: { product: true, reseller: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    const supplierHealth = suppliers.map(supplier => {
      const configured = this.adapters.get(supplier.code).configured();
      const stale = !supplier.lastSyncedAt || now.getTime() - supplier.lastSyncedAt.getTime() > staleSyncMs;
      const health = !supplier.enabled ? 'disabled' : supplier.lastSyncError || !configured || stale ? 'degraded' : 'operational';
      return {
        code: supplier.code,
        name: supplier.name,
        categories: supplier.categories,
        enabled: supplier.enabled,
        configured,
        health,
        last_synced_at: supplier.lastSyncedAt?.toISOString() ?? null,
        last_sync_error: supplier.lastSyncError,
      };
    });

    return {
      object: 'admin_overview' as const,
      mode,
      days,
      from: from.toISOString(),
      to: now.toISOString(),
      currencies,
      totals: currencies.map(currency => {
        const total = totals.get(currency)!;
        return { currency, gross: minor(total.gross), orders: total.orders, previous_gross: minor(total.previousGross), previous_orders: total.previousOrders };
      }),
      series: currencies.map(currency => ({
        currency,
        points: dates.map(date => {
          const point = points.get(currency)?.get(date);
          return { date, gross: minor(point?.gross ?? 0n), orders: point?.orders ?? 0 };
        }),
      })),
      wallet_float: float.map(row => ({ currency: row.currency, amount: minor(row._sum.balanceMinor ?? 0n) })).sort((a, b) => a.currency.localeCompare(b.currency)),
      resellers: { active, pending, joined, previously_joined: previouslyJoined },
      attention: {
        orders_needing_review: ordersNeedingReview,
        orders_processing: ordersProcessing,
        verifications_in_review: verificationsInReview,
        supplier_problems: supplierHealth.filter(supplier => supplier.health === 'degraded').length,
      },
      suppliers: supplierHealth,
      recent_orders: recent.map(order => ({
        id: order.id,
        receipt_number: receiptNumber(order.receiptNumber),
        reseller: order.reseller,
        product: { name: order.product.name, category: order.product.category, country: order.product.country },
        customer_reference: order.customerReference,
        price: minor(order.priceMinor),
        currency: order.currency,
        status: order.status,
        needs_review: order.needsReview,
        created_at: order.createdAt.toISOString(),
      })),
    };
  }
}
