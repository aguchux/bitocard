import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AccountKind, LedgerMode } from '../generated/prisma/client.js';
import { WalletService } from '../ledger/wallet.service.js';
import { minor } from '../ledger/mode.js';
import { buildTrend, dateKey } from './trend.js';

export type ResellerReportMetric = 'earnings' | 'gross_sales' | 'orders';

const typeLabels: Record<string, string> = {
  earnings: 'Earnings from a sale',
  order_refund: 'Sale refunded',
  platform_fee: 'BitoCard fee',
  platform_fee_refund: 'BitoCard fee refunded',
  usage_charge: 'Usage charge',
  adjustment: 'Adjustment',
};

/**
 * A reseller's own earnings and growth, built only from their own ledger postings (never BitoCard's supplier costs,
 * wholesale prices or another reseller's data — a reseller's `reseller_earnings`/`reseller_earnings_held` balance is
 * profit only; `OrdersService.settle()` never credits it with the wholesale cost). "Revenue" here means profit
 * earned on sales, not sales volume.
 */
@Injectable()
export class ResellerReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  /**
   * Earnings (profit from delivered sales, less refunded sales) less platform fees, subscription charges and
   * chargebacks borne, plus any admin adjustment, is net profit. In the reseller's own wallet currency (their
   * country's, or US dollars) — never converted, since a reseller holds at most these two.
   */
  async pnl(input: { resellerId: string; mode: LedgerMode; from: Date; to: Date; currency?: string }) {
    const { currency } = await this.wallets.walletCurrency(input.resellerId, input.currency);
    const where = (types: string[], kinds: AccountKind[]) => ({
      entry: { resellerId: input.resellerId, mode: input.mode, type: { in: types }, createdAt: { gte: input.from, lt: input.to } },
      account: { resellerId: input.resellerId, currency, kind: { in: kinds } },
    });
    const sumOf = async (types: string[], kinds: AccountKind[]) => {
      const result = await this.prisma.ledgerPosting.aggregate({ where: where(types, kinds), _sum: { amountMinor: true } });
      return result._sum.amountMinor ?? 0n;
    };

    // Earnings are credited (negative amount_minor); net revenue is the negated sum.
    const revenue = minor(-(await sumOf(['earnings', 'order_refund'], ['reseller_earnings', 'reseller_earnings_held'])));
    // Fees are debited (positive); a refund credits part back.
    const platformFees = minor(await sumOf(['platform_fee', 'platform_fee_refund'], ['reseller_funding', 'reseller_earnings']));
    const usageCharges = minor(await sumOf(['usage_charge'], ['reseller_funding', 'reseller_earnings']));
    // Admin adjustments can go either way; shown as a signed line, positive meaning credited to the reseller.
    const adjustments = minor(-(await sumOf(['adjustment'], ['reseller_funding', 'reseller_earnings'])));
    const { subscription, chargebacks } = await this.holdCaptures({ resellerId: input.resellerId, mode: input.mode, from: input.from, to: input.to, currency });

    const expenses = platformFees + subscription + chargebacks + usageCharges;
    const netProfit = revenue - expenses + adjustments;

    return {
      object: 'reseller_pnl_report' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      currency,
      revenue,
      operating_expenses: expenses,
      net_profit: netProfit,
      breakdown: [
        { kind: 'earnings', label: 'Earnings from sales', group: 'revenue' as const, amount: revenue },
        { kind: 'platform_fee', label: 'BitoCard fees', group: 'expense' as const, amount: platformFees },
        { kind: 'subscription', label: 'Plan subscription', group: 'expense' as const, amount: subscription },
        { kind: 'chargeback', label: 'Chargebacks', group: 'expense' as const, amount: chargebacks },
        { kind: 'usage_charge', label: 'Usage charges', group: 'expense' as const, amount: usageCharges },
        ...(adjustments !== 0 ? [{ kind: 'adjustment', label: 'Adjustments', group: 'adjustment' as const, amount: adjustments }] : []),
      ].filter(row => row.amount !== 0),
    };
  }

  /** Subscription charges and chargebacks borne: both are `hold_capture`s, told apart by the hold's own reference. */
  private async holdCaptures(input: { resellerId: string; mode: LedgerMode; from: Date; to: Date; currency: string }) {
    const rows = await this.prisma.$queryRaw<Array<{ reference: string; amount: bigint }>>`
      SELECT h.reference, p.amount_minor AS amount
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      JOIN holds h ON h.id = (e.metadata->>'hold_id')::uuid
      WHERE e.reseller_id = ${input.resellerId}::uuid AND e.mode = ${input.mode}::"LedgerMode" AND e.type = 'hold_capture'
        AND a.kind = 'reseller_reserved' AND a.currency = ${input.currency}
        AND e.created_at >= ${input.from} AND e.created_at < ${input.to}`;
    let subscription = 0;
    let chargebacks = 0;
    for (const row of rows) {
      if (row.reference.startsWith('plan:')) subscription += minor(row.amount);
      else if (row.reference.startsWith('chargeback:')) chargebacks += minor(row.amount);
    }
    return { subscription, chargebacks };
  }

  /** Daily earnings or sales, with a simple trend projection and the change against the preceding equal range. */
  async growth(input: { resellerId: string; mode: LedgerMode; from: Date; to: Date; metric: ResellerReportMetric; currency?: string }) {
    const { currency } = await this.wallets.walletCurrency(input.resellerId, input.currency);
    const span = input.to.getTime() - input.from.getTime();
    const previousFrom = new Date(input.from.getTime() - span);
    const byDay = await this.dailyValues(input, previousFrom, currency);
    const { current, previous, changePercent, points } = buildTrend(byDay, input.from, input.to);
    return { object: 'reseller_growth_report' as const, mode: input.mode, metric: input.metric, from: input.from.toISOString(), to: input.to.toISOString(), currency, current, previous, change_percent: changePercent, points };
  }

  private async dailyValues(input: { resellerId: string; mode: LedgerMode; metric: ResellerReportMetric }, from: Date, currency: string): Promise<Map<string, number>> {
    if (input.metric === 'earnings') {
      const rows = await this.prisma.$queryRaw<Array<{ day: Date; net: bigint }>>`
        SELECT date_trunc('day', e.created_at) AS day, SUM(p.amount_minor) AS net
        FROM ledger_postings p
        JOIN ledger_accounts a ON a.id = p.account_id
        JOIN journal_entries e ON e.id = p.entry_id
        WHERE e.reseller_id = ${input.resellerId}::uuid AND e.mode = ${input.mode}::"LedgerMode" AND e.type IN ('earnings', 'order_refund')
          AND a.kind IN ('reseller_earnings', 'reseller_earnings_held') AND a.currency = ${currency}
        GROUP BY 1`;
      const byDay = new Map<string, number>();
      for (const row of rows) byDay.set(dateKey(row.day), minor(-row.net));
      return byDay;
    }
    const orders = await this.prisma.order.findMany({
      where: { resellerId: input.resellerId, mode: input.mode, status: { in: ['completed', 'refunded'] }, currency, completedAt: { gte: from } },
      select: { completedAt: true, priceMinor: true, resellerProfitMinor: true },
    });
    const byDay = new Map<string, number>();
    for (const order of orders) {
      const key = dateKey(order.completedAt!);
      const value = input.metric === 'orders' ? 1 : minor(order.priceMinor) / 100;
      byDay.set(key, (byDay.get(key) ?? 0) + value);
    }
    return byDay;
  }

  /**
   * The dated rows behind the P&L above, in the same categories: positive means money credited to the reseller
   * (earnings, a fee refunded, a positive adjustment), negative means money taken from them (a fee, a subscription
   * charge, a chargeback, a refund reversing a sale). The row source for the CSV and PDF exports.
   */
  async statement(input: { resellerId: string; mode: LedgerMode; from: Date; to: Date; currency?: string }) {
    const { currency } = await this.wallets.walletCurrency(input.resellerId, input.currency);
    const base = { resellerId: input.resellerId, mode: input.mode, createdAt: { gte: input.from, lt: input.to } };
    const rows: Array<{ date: Date; type: string; description: string; amount: number }> = [];

    const sign = (entries: Array<{ createdAt: Date; type: string; description: string; postings: Array<{ amountMinor: bigint; account: { kind: AccountKind; currency: string } }> }>, kinds: AccountKind[], credited: boolean) => {
      for (const entry of entries) {
        const net = entry.postings.filter(p => kinds.includes(p.account.kind) && p.account.currency === currency).reduce((sum, p) => sum + p.amountMinor, 0n);
        if (net === 0n) continue;
        rows.push({ date: entry.createdAt, type: entry.type, description: typeLabels[entry.type] ?? entry.description, amount: minor(credited ? -net : net) });
      }
    };

    const entriesOf = (types: string[]) => this.prisma.journalEntry.findMany({ where: { ...base, type: { in: types } }, include: { postings: { include: { account: true } } } });

    sign(await entriesOf(['earnings', 'order_refund']), ['reseller_earnings', 'reseller_earnings_held'], true);
    sign(await entriesOf(['platform_fee', 'platform_fee_refund']), ['reseller_funding', 'reseller_earnings'], false);
    sign(await entriesOf(['usage_charge']), ['reseller_funding', 'reseller_earnings'], false);
    sign(await entriesOf(['adjustment']), ['reseller_funding', 'reseller_earnings'], true);

    const holdRows = await this.prisma.$queryRaw<Array<{ date: Date; reference: string; amount: bigint }>>`
      SELECT e.created_at AS date, h.reference, p.amount_minor AS amount
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p.account_id
      JOIN journal_entries e ON e.id = p.entry_id
      JOIN holds h ON h.id = (e.metadata->>'hold_id')::uuid
      WHERE e.reseller_id = ${input.resellerId}::uuid AND e.mode = ${input.mode}::"LedgerMode" AND e.type = 'hold_capture'
        AND a.kind = 'reseller_reserved' AND a.currency = ${currency}
        AND e.created_at >= ${input.from} AND e.created_at < ${input.to}`;
    for (const row of holdRows) {
      if (row.reference.startsWith('plan:')) rows.push({ date: row.date, type: 'subscription', description: 'Plan subscription charge', amount: -minor(row.amount) });
      else if (row.reference.startsWith('chargeback:')) rows.push({ date: row.date, type: 'chargeback', description: 'Chargeback', amount: -minor(row.amount) });
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return {
      object: 'reseller_statement' as const,
      mode: input.mode,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      currency,
      data: rows.map(row => ({ date: row.date.toISOString(), type: row.type, description: row.description, currency, amount: row.amount })),
    };
  }
}
