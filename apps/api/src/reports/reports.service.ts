import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import { type AccountKind, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';

/** A fixed, compile-time list of account kinds as an `IN (...)` clause: never user input, so each is its own bound parameter. */
const kindList = (kinds: AccountKind[]) => Prisma.join(kinds);

const day = 24 * 3600 * 1000;

/** Revenue BitoCard keeps for itself, in money (never the crypto-denominated kinds: no fiat price feed behind them here). */
const revenueKinds: AccountKind[] = ['platform_revenue', 'platform_fees', 'domain_revenue'];
/** What suppliers charge BitoCard for fulfilled orders. */
const costOfSalesKinds: AccountKind[] = ['cost_of_sales'];
/** Everything else BitoCard spends to run the business. */
const expenseKinds: AccountKind[] = ['processing_fees', 'chargebacks', 'promotions'];
const pnlKinds = [...revenueKinds, ...costOfSalesKinds, ...expenseKinds];

/** `kind`'s natural side for a P&L figure: revenue is recognised on its credits, an expense on its debits. */
const creditSided = new Set<AccountKind>(revenueKinds);

const labels: Record<AccountKind, string> = {
  platform_revenue: 'Platform revenue',
  platform_fees: "Fees on resellers' own suppliers",
  domain_revenue: 'Domain sales',
  cost_of_sales: 'Cost of sales',
  processing_fees: 'Payment processing fees',
  chargebacks: 'Chargebacks',
  promotions: 'Promotions',
} as Record<AccountKind, string>;

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** Ordinary least squares on (0, values[0]), (1, values[1])...: the line's slope and intercept. */
function linearFit(values: number[]) {
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + value * index, 0);
  const sumXX = values.reduce((sum, _value, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export type ReportMetric = 'gross_sales' | 'orders' | 'platform_revenue' | 'new_resellers';

/**
 * Platform-wide financial reporting: a P&L for a date range (every currency rolled into one via `FxService`'s
 * reference rates, or one market's own currency), growth with a simple linear-trend projection, and the flat,
 * dated ledger rows behind a P&L (the "statement"), for the CSV and PDF exports.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Revenue (`platform_revenue`, `platform_fees`, `domain_revenue`) less cost of sales (`cost_of_sales`) is gross
   * profit; less operating expenses (`processing_fees`, `chargebacks`, `promotions`) is net profit. `currency`
   * picks one market's own currency (no conversion, and only that currency's postings count, in its own minor
   * units); omitted, every currency involved is converted to USD cents at the reference rate.
   */
  async pnl(input: { mode: LedgerMode; from: Date; to: Date; currency?: string }) {
    const rows = await this.byKindAndCurrency(input.mode, input.from, input.to, pnlKinds);
    const scoped = input.currency ? rows.filter(row => row.currency === input.currency) : rows;
    const currencies = [...new Set(scoped.map(row => row.currency))];
    const reporting = input.currency ? null : await this.fx.reportingRates(currencies);
    const toUsdCents = reporting?.toUsdCents ?? null;
    const ratesAsOf = reporting?.ratesAsOf ?? null;
    const unconverted = reporting?.unconverted ?? [];

    const byKind = new Map<AccountKind, number>();
    for (const row of scoped) {
      // The kind's natural value: revenue is its net credit, an expense its net debit.
      const net = creditSided.has(row.kind) ? -row.net : row.net;
      const value = toUsdCents ? toUsdCents(net, row.currency) : minor(net);
      byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + value);
    }
    const sum = (kinds: AccountKind[]) => kinds.reduce((total, kind) => total + (byKind.get(kind) ?? 0), 0);
    const revenue = sum(revenueKinds);
    const costOfSales = sum(costOfSalesKinds);
    const expenses = sum(expenseKinds);
    const grossProfit = revenue - costOfSales;
    const netProfit = grossProfit - expenses;

    return {
      object: 'pnl_report' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      currency: input.currency ?? 'USD',
      revenue,
      cost_of_sales: costOfSales,
      gross_profit: grossProfit,
      operating_expenses: expenses,
      net_profit: netProfit,
      breakdown: pnlKinds
        .filter(kind => byKind.has(kind))
        .map(kind => ({
          kind,
          label: labels[kind],
          group: revenueKinds.includes(kind) ? ('revenue' as const) : costOfSalesKinds.includes(kind) ? ('cost_of_sales' as const) : ('expense' as const),
          amount: byKind.get(kind)!,
        })),
      rates_as_of: ratesAsOf?.toISOString() ?? null,
      unconverted,
    };
  }

  /**
   * Daily buckets of `metric` over the range, with the final buckets continued by a simple linear-trend
   * projection (flagged `projected: true`), plus the whole range's change against the immediately preceding range
   * of the same length.
   */
  async growth(input: { mode: LedgerMode; from: Date; to: Date; metric: ReportMetric; projectDays?: number }) {
    const span = input.to.getTime() - input.from.getTime();
    const previousFrom = new Date(input.from.getTime() - span);
    const dates: string[] = [];
    for (let at = input.from.getTime(); at < input.to.getTime(); at += day) dates.push(dateKey(new Date(at)));
    const previousDates: string[] = [];
    for (let at = previousFrom.getTime(); at < input.from.getTime(); at += day) previousDates.push(dateKey(new Date(at)));

    const byDay = await this.dailyValues(input.mode, previousFrom, input.to, input.metric);
    const current = dates.reduce((sum, date) => sum + (byDay.get(date) ?? 0), 0);
    const previous = previousDates.reduce((sum, date) => sum + (byDay.get(date) ?? 0), 0);
    const changePercent = previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

    const points = dates.map(date => ({ date, value: byDay.get(date) ?? 0, projected: false }));
    const projectDays = input.projectDays ?? Math.min(7, dates.length);
    if (projectDays > 0 && dates.length >= 3) {
      // The trend line fitted to the whole range, continued for `projectDays` more buckets.
      const { slope, intercept } = linearFit(points.map(point => point.value));
      for (let step = 0; step < projectDays; step++) {
        const index = dates.length + step;
        const date = dateKey(new Date(input.to.getTime() + step * day));
        points.push({ date, value: Math.max(0, Math.round(slope * index + intercept)), projected: true });
      }
    }

    return {
      object: 'growth_report' as const,
      mode: input.mode,
      metric: input.metric,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      current,
      previous,
      change_percent: changePercent,
      points,
    };
  }

  /** The dated ledger rows behind a P&L for the range: the source data for the CSV and PDF statement exports. */
  async statement(input: { mode: LedgerMode; from: Date; to: Date; currency?: string }) {
    const rows = await this.prisma.$queryRaw<Array<{ date: Date; reference: string; type: string; description: string; kind: AccountKind; currency: string; amount: bigint }>>`
      SELECT e.created_at AS date, e.reference, e.type, e.description, a.kind, a.currency, p.amount_minor AS amount
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      WHERE a.mode = ${input.mode}::"LedgerMode" AND a.kind IN (${kindList(pnlKinds)})
        AND e.created_at >= ${input.from} AND e.created_at < ${input.to}
      ORDER BY e.created_at ASC`;
    const filtered = input.currency ? rows.filter(row => row.currency === input.currency) : rows;
    return {
      object: 'statement' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      data: filtered.map(row => {
        // The literal posting: a positive amount_minor is a debit, negative is a credit (as it is stored).
        const isDebit = row.amount > 0n;
        const amount = minor(isDebit ? row.amount : -row.amount);
        return {
          date: row.date.toISOString(),
          reference: row.reference,
          type: row.type,
          description: row.description,
          kind: row.kind,
          label: labels[row.kind],
          currency: row.currency,
          debit: isDebit ? amount : null,
          credit: isDebit ? null : amount,
        };
      }),
    };
  }

  private async byKindAndCurrency(mode: LedgerMode, from: Date, to: Date, kinds: AccountKind[]) {
    return this.prisma.$queryRaw<Array<{ kind: AccountKind; currency: string; net: bigint }>>`
      SELECT a.kind, a.currency, SUM(p.amount_minor) AS net
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      WHERE a.mode = ${mode}::"LedgerMode" AND a.kind IN (${kindList(kinds)})
        AND e.created_at >= ${from} AND e.created_at < ${to}
      GROUP BY a.kind, a.currency`;
  }

  private async dailyValues(mode: LedgerMode, from: Date, to: Date, metric: ReportMetric): Promise<Map<string, number>> {
    if (metric === 'new_resellers') {
      const resellers = await this.prisma.reseller.findMany({ where: { house: false, createdAt: { gte: from, lt: to } }, select: { createdAt: true } });
      const byDay = new Map<string, number>();
      for (const reseller of resellers) {
        const key = dateKey(reseller.createdAt);
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      }
      return byDay;
    }
    if (metric === 'platform_revenue') {
      const rows = await this.prisma.$queryRaw<Array<{ day: Date; currency: string; net: bigint }>>`
        SELECT date_trunc('day', e.created_at) AS day, a.currency, SUM(p.amount_minor) AS net
        FROM ledger_postings p
        JOIN ledger_accounts a ON a.id = p.account_id
        JOIN journal_entries e ON e.id = p.entry_id
        WHERE a.mode = ${mode}::"LedgerMode" AND a.kind = 'platform_revenue' AND e.created_at >= ${from} AND e.created_at < ${to}
        GROUP BY 1, 2`;
      const { toUsdCents } = await this.fx.reportingRates([...new Set(rows.map(row => row.currency))]);
      const byDay = new Map<string, number>();
      for (const row of rows) {
        const key = dateKey(row.day);
        // platform_revenue is credit-sided: its net credit (the revenue) is -SUM(amount_minor).
        byDay.set(key, (byDay.get(key) ?? 0) + toUsdCents(-row.net, row.currency) / 100);
      }
      return byDay;
    }
    // gross_sales / orders: delivered orders (completed or refunded were still sales), every currency to USD.
    const orders = await this.prisma.order.findMany({ where: { mode, status: { in: ['completed', 'refunded'] }, completedAt: { gte: from, lt: to } }, select: { completedAt: true, priceMinor: true, currency: true } });
    const { toUsdCents } = await this.fx.reportingRates([...new Set(orders.map(order => order.currency))]);
    const byDay = new Map<string, number>();
    for (const order of orders) {
      const key = dateKey(order.completedAt!);
      const value = metric === 'orders' ? 1 : toUsdCents(order.priceMinor, order.currency) / 100;
      byDay.set(key, (byDay.get(key) ?? 0) + value);
    }
    return byDay;
  }
}
