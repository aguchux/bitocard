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

/** Minor-unit digits of a currency (2 for NGN, GHS, KES and USD; 0 for JPY). */
const digitsOf = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

/** Rates for reporting: the reference (mid-market) rate, else Flutterwave's offered rate. Never the charged rate. */
const rateSources = ['open_exchange_rates', 'flutterwave'];

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
    const usd = await this.usdView([...new Set([...currencies, ...float.map(row => row.currency)])], { totals, points, dates, float });
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
      usd,
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

  /**
   * Every market in USD, BitoCard's base currency: each currency's totals converted at its latest reference rate (for
   * reporting only; no margin). Currencies without a rate are left out and listed in `unconverted`.
   */
  private async usdView(
    currencies: string[],
    data: {
      totals: Map<string, { gross: bigint; orders: number; previousGross: bigint; previousOrders: number }>;
      points: Map<string, Map<string, { gross: bigint; orders: number }>>;
      dates: string[];
      float: Array<{ currency: string; _sum: { balanceMinor: bigint | null } }>;
    },
  ) {
    const others = currencies.filter(currency => currency !== 'USD');
    const rows = others.length ? await this.prisma.exchangeRate.findMany({ where: { currency: { in: others }, source: { in: rateSources } } }) : [];
    const rates = new Map<string, { unitsPerUsd: number; fetchedAt: Date }>([['USD', { unitsPerUsd: 1, fetchedAt: new Date(0) }]]);
    for (const source of [...rateSources].reverse()) {
      for (const row of rows.filter(item => item.source === source)) rates.set(row.currency, { unitsPerUsd: row.unitsPerUsd.toNumber(), fetchedAt: row.fetchedAt });
    }
    const unconverted = currencies.filter(currency => !rates.has(currency));
    const toCents = (amount: bigint, currency: string) => {
      const rate = rates.get(currency);
      return rate ? Math.round((Number(amount) / 10 ** digitsOf(currency) / rate.unitsPerUsd) * 100) : 0;
    };
    const used = others.filter(currency => rates.has(currency)).map(currency => rates.get(currency)!.fetchedAt.getTime());

    const total = { gross: 0, orders: 0, previous_gross: 0, previous_orders: 0 };
    for (const [currency, item] of data.totals) {
      total.gross += toCents(item.gross, currency);
      total.previous_gross += toCents(item.previousGross, currency);
      total.orders += item.orders;
      total.previous_orders += item.previousOrders;
    }
    return {
      currency: 'USD' as const,
      /** The oldest rate used, so the dashboard can say how current the conversion is (null when only USD was involved). */
      rates_as_of: used.length ? new Date(Math.min(...used)).toISOString() : null,
      unconverted,
      total,
      series: data.dates.map(date => {
        let gross = 0;
        let orders = 0;
        for (const [currency, byDay] of data.points) {
          const point = byDay.get(date);
          if (!point) continue;
          gross += toCents(point.gross, currency);
          orders += point.orders;
        }
        return { date, gross, orders };
      }),
      wallet_float: data.float.reduce((sum, row) => sum + toCents(row._sum.balanceMinor ?? 0n, row.currency), 0),
    };
  }
}
