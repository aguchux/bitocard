import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import { type AccountKind, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import { statementTooLarge } from './range.js';
import { buildTrend, dateKey } from './trend.js';

/** A fixed, compile-time list as an `IN (...)` clause: never user input, so each is its own bound parameter. */
const kindList = (kinds: string[]) => Prisma.join(kinds);

/**
 * BitoCard's retail margin: what its own stores (bitocard.com and each market's country store) keep on a sale. Those
 * stores sell through house accounts, so the margin is posted as the house account's earnings, not as platform
 * revenue (which already holds the wholesale they paid).
 */
const retailMargin = 'retail_margin';
type ReportLine = AccountKind | typeof retailMargin;

/** Revenue BitoCard keeps for itself, in money (never the crypto-denominated kinds: no fiat price feed behind them here). */
const revenueLines: ReportLine[] = ['platform_revenue', retailMargin, 'platform_fees', 'domain_revenue', 'classifieds_revenue'];
/** What suppliers charge BitoCard for fulfilled orders. */
const costOfSalesLines: ReportLine[] = ['cost_of_sales'];
/** Everything else BitoCard spends to run the business; `adjustments` is what finance credited (or took back) by hand. */
const expenseLines: ReportLine[] = ['processing_fees', 'chargebacks', 'promotions', 'adjustments'];
const ledgerKinds = [...revenueLines, ...costOfSalesLines, ...expenseLines].filter((line): line is AccountKind => line !== retailMargin);
const allLines = [...revenueLines, ...costOfSalesLines, ...expenseLines];

/** The house accounts' earnings, posted by a sale and reversed by its refund. */
const houseEarningKinds = ['reseller_earnings_held', 'reseller_earnings'];
const houseEarningTypes = ['earnings', 'order_refund'];

const labels: Record<ReportLine, string> = {
  platform_revenue: 'Platform revenue',
  retail_margin: "Retail margin on BitoCard's own stores",
  platform_fees: "Fees on resellers' own suppliers",
  domain_revenue: 'Domain sales',
  classifieds_revenue: 'BitoCard Shop fees',
  cost_of_sales: 'Cost of sales',
  processing_fees: 'Payment processing fees',
  chargebacks: 'Chargebacks',
  promotions: 'Promotions',
  adjustments: 'Adjustments and goodwill',
} as Record<ReportLine, string>;

/** Revenue is recognised on its credits, an expense on its debits. */
const isRevenue = (line: ReportLine) => revenueLines.includes(line);

/** The most lines one statement holds: past it, a shorter period is asked for. */
export const statementMaxRows = 50_000;

export type ReportMetric = 'gross_sales' | 'orders' | 'platform_revenue' | 'new_resellers';

/**
 * Platform-wide financial reporting: a P&L for a date range (every currency rolled into one via `FxService`'s
 * reference rates, or one market's own currency), growth with a simple linear-trend projection, and the flat,
 * dated ledger rows behind a P&L (the "statement"), for the CSV and PDF exports. Money only: postings in a crypto
 * asset's units (a seized coin goes to `adjustments`) are left out.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Revenue (platform revenue, the retail margin of BitoCard's own stores, own-supplier fees, domains) less cost of
   * sales is gross profit; less operating expenses (processing fees, chargebacks, promotions, adjustments) is net
   * profit. `currency` picks one market's own currency (no conversion, and only that currency's postings count, in
   * its own minor units); omitted, every currency involved is converted to USD cents at the reference rate.
   */
  async pnl(input: { mode: LedgerMode; from: Date; to: Date; currency?: string }) {
    const rows = await this.byLineAndCurrency(input.mode, input.from, input.to);
    const scoped = input.currency ? rows.filter(row => row.currency === input.currency) : rows;
    const currencies = [...new Set(scoped.map(row => row.currency))];
    const reporting = input.currency ? null : await this.fx.reportingRates(currencies);
    const toUsdCents = reporting?.toUsdCents ?? null;

    const byLine = new Map<ReportLine, number>();
    for (const row of scoped) {
      // The line's natural value: revenue is its net credit, an expense its net debit.
      const net = isRevenue(row.line) ? -row.net : row.net;
      const value = toUsdCents ? toUsdCents(net, row.currency) : minor(net);
      byLine.set(row.line, (byLine.get(row.line) ?? 0) + value);
    }
    const sum = (lines: ReportLine[]) => lines.reduce((total, line) => total + (byLine.get(line) ?? 0), 0);
    const revenue = sum(revenueLines);
    const costOfSales = sum(costOfSalesLines);
    const expenses = sum(expenseLines);
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
      breakdown: allLines
        .filter(line => byLine.has(line))
        .map(line => ({
          kind: line,
          label: labels[line],
          group: isRevenue(line) ? ('revenue' as const) : costOfSalesLines.includes(line) ? ('cost_of_sales' as const) : ('expense' as const),
          amount: byLine.get(line)!,
        })),
      rates_as_of: reporting?.ratesAsOf?.toISOString() ?? null,
      unconverted: reporting?.unconverted ?? [],
    };
  }

  /**
   * Daily buckets of `metric` over the range, with the final buckets continued by a simple linear-trend
   * projection (flagged `projected: true`), plus the whole range's change against the immediately preceding range
   * of the same length. Money metrics are in US dollars; `platform_revenue` is the P&L's revenue.
   */
  async growth(input: { mode: LedgerMode; from: Date; to: Date; metric: ReportMetric; projectDays?: number }) {
    const span = input.to.getTime() - input.from.getTime();
    const previousFrom = new Date(input.from.getTime() - span);
    const byDay = await this.dailyValues(input.mode, previousFrom, input.to, input.metric);
    const { current, previous, changePercent, points } = buildTrend(byDay, input.from, input.to, input.projectDays);

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

  /**
   * The dated ledger rows behind a P&L for the range: the source data for the CSV and PDF statement exports. More
   * than `maxRows` lines is refused (`statement_too_large`) rather than cut short.
   */
  async statement(input: { mode: LedgerMode; from: Date; to: Date; currency?: string; maxRows?: number }) {
    const maxRows = input.maxRows ?? statementMaxRows;
    const currency = input.currency ? Prisma.sql`AND a.currency = ${input.currency}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ date: Date; reference: string; type: string; description: string; line: ReportLine; currency: string; amount: bigint }>>`
      SELECT e.created_at AS date, e.reference, e.type, e.description,
        CASE WHEN r.house THEN ${retailMargin} ELSE a.kind::text END AS line, a.currency, p.amount_minor AS amount
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      LEFT JOIN resellers r ON r.id = a.reseller_id
      WHERE a.mode = ${input.mode}::"LedgerMode" AND ${this.reportedPostings()} ${currency}
        AND e.created_at >= ${input.from} AND e.created_at < ${input.to}
      ORDER BY e.created_at ASC, e.reference ASC
      LIMIT ${maxRows + 1}`;
    if (rows.length > maxRows) throw statementTooLarge(maxRows);
    return {
      object: 'statement' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      data: rows.map(row => {
        // The literal posting: a positive amount_minor is a debit, negative is a credit (as it is stored).
        const isDebit = row.amount > 0n;
        const amount = minor(isDebit ? row.amount : -row.amount);
        return {
          date: row.date.toISOString(),
          reference: row.reference,
          type: row.type,
          description: row.description,
          kind: row.line,
          label: labels[row.line],
          currency: row.currency,
          debit: isDebit ? amount : null,
          credit: isDebit ? null : amount,
        };
      }),
    };
  }

  /**
   * The postings a P&L counts: BitoCard's own revenue and expense accounts, and the house accounts' earnings (the
   * retail margin), in money only.
   */
  private reportedPostings() {
    return Prisma.sql`(
        (a.kind::text IN (${kindList(ledgerKinds)}))
        OR (r.house AND a.kind::text IN (${kindList(houseEarningKinds)}) AND e.type IN (${kindList(houseEarningTypes)}))
      )
      AND a.currency NOT IN (SELECT code FROM crypto_assets)`;
  }

  private async byLineAndCurrency(mode: LedgerMode, from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<{ line: ReportLine; currency: string; net: bigint }>>`
      SELECT CASE WHEN r.house THEN ${retailMargin} ELSE a.kind::text END AS line, a.currency, SUM(p.amount_minor) AS net
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      LEFT JOIN resellers r ON r.id = a.reseller_id
      WHERE a.mode = ${mode}::"LedgerMode" AND ${this.reportedPostings()}
        AND e.created_at >= ${from} AND e.created_at < ${to}
      GROUP BY 1, 2`;
  }

  private async dailyValues(mode: LedgerMode, from: Date, to: Date, metric: ReportMetric): Promise<Map<string, number>> {
    if (metric === 'new_resellers') {
      const resellers = await this.prisma.reseller.findMany({ where: { house: false, platform: 'bitocard', createdAt: { gte: from, lt: to } }, select: { createdAt: true } });
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
        LEFT JOIN resellers r ON r.id = a.reseller_id
        WHERE a.mode = ${mode}::"LedgerMode" AND ${this.reportedPostings()}
          AND (a.kind::text IN (${kindList(revenueLines.filter(line => line !== retailMargin))}) OR r.house)
          AND e.created_at >= ${from} AND e.created_at < ${to}
        GROUP BY 1, 2`;
      const { toUsdCents } = await this.fx.reportingRates([...new Set(rows.map(row => row.currency))]);
      const byDay = new Map<string, number>();
      for (const row of rows) {
        const key = dateKey(row.day);
        // Revenue is credit-sided: its net credit (the revenue) is -SUM(amount_minor).
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
