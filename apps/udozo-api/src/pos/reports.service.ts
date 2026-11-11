import { HttpStatus, Injectable } from '@nestjs/common';
import { heldUnits } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { formatMoney } from '../notifications/templates.js';
import { posCountedStatuses } from './catalogue-rules.js';
import { marketZone, zonedDay, zonedDayStart } from './collection-rules.js';
import { paymentWords } from './receipt-pdf.js';
import { reportPdf, type ReportSection } from './report-pdf.js';
import { PosShiftsService, type ShiftTotals } from './shifts.service.js';

export const reportPeriods = ['today', '7d', '30d', 'custom'] as const;
export type ReportPeriod = (typeof reportPeriods)[number];

/** A CSV export holds at most this many rows (choose a shorter period for more). */
export const maxExportRows = 50_000;
/** A custom period, an export or a summary covers at most this many days. */
export const maxReportDays = 366;

const dayMs = 86_400_000;
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs) + 1;
/** Current against previous, a whole percentage; null with nothing before. */
export const changePct = (current: number, previous: number) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

/**
 * A period in the shop's own day: today so far (against the same weekday a week before, to the same time), the last 7
 * or 30 days so far (against the 7 or 30 before), or two dates (against as many days before). Today and a one-day
 * period are drawn by the hour, longer ones by the day.
 */
export function periodRange(period: ReportPeriod, input: { from?: string; to?: string }, zone: string, now = new Date()) {
  const today = zonedDay(now, zone);
  let fromDay: string;
  let toDay: string;
  if (period === 'custom') {
    if (!isDay(input.from)) throw invalid('parameter_invalid', 'Give the first day as YYYY-MM-DD.', 'from');
    if (!isDay(input.to)) throw invalid('parameter_invalid', 'Give the last day as YYYY-MM-DD.', 'to');
    if (input.to < input.from) throw invalid('parameter_invalid', 'The last day comes after the first.', 'to');
    if (daysBetween(input.from, input.to) > maxReportDays) throw invalid('range_too_long', `Choose at most ${maxReportDays} days.`, 'to');
    fromDay = input.from;
    toDay = input.to;
  } else {
    const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
    fromDay = addDays(today, -(days - 1));
    toDay = today;
  }
  const days = daysBetween(fromDay, toDay);
  const start = zonedDayStart(fromDay, zone);
  const dayEnd = zonedDayStart(addDays(toDay, 1), zone);
  const end = dayEnd > now ? now : dayEnd;
  // Today against the same weekday a week before; longer periods against as many days just before.
  const back = (period === 'today' ? 7 : days) * dayMs;
  return { fromDay, toDay, days, start, end, previous: { start: new Date(start.getTime() - back), end: new Date(end.getTime() - back) }, by: days === 1 ? ('hour' as const) : ('day' as const) };
}

/** A CSV cell: quoted when it needs to be, and a formula's first character defused (spreadsheets run `=`, `+`, `-`, `@`). */
export function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const decimal = (minor: number | bigint) => (Number(minor) / 100).toFixed(2);

const saleSelect = {
  id: true,
  number: true,
  status: true,
  shopId: true,
  tillName: true,
  soldByName: true,
  createdAt: true,
  refundedAt: true,
  refundReason: true,
  subtotalMinor: true,
  discountMinor: true,
  vatBps: true,
  vatMinor: true,
  totalMinor: true,
  invoiceNumber: true,
  shop: { select: { name: true } },
  customer: { select: { name: true } },
  lines: { select: { listingId: true, title: true, sku: true, quantity: true, unitPriceMinor: true, discountMinor: true, totalMinor: true }, orderBy: { position: 'asc' } },
  payments: { select: { method: true, amountMinor: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.PosSaleSelect;

type Account = { id: string; customerId: string; country: string; currency: string };

/**
 * The overview, end of day and exports (docs/UDOZO_POS_PLAN.md, milestone 7). Every figure is read from the sales as
 * they were rung up (`pos_sales`, the shop's own record) and, for the owner's whole business, their completed sales on
 * udozo.com (`classified_purchases`, UdozoPay orders and buy orders), in the shop's own day. Takings are completed
 * sales; refunds count on the day they were made. Nothing here moves money.
 */
@Injectable()
export class PosReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: PosShiftsService,
  ) {}

  private async account(customer: CustomerWithStore): Promise<Account> {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true, customerId: true, country: true, currency: true } });
    if (!account) throw noAccount();
    return account;
  }

  private async shop(account: Account, shopId: string | undefined) {
    if (!shopId) return null;
    const shop = await this.prisma.posShop.findFirst({ where: { id: shopId, accountId: account.id }, select: { id: true, name: true } });
    if (!shop) throw notFound('shop');
    return shop;
  }

  private sales(account: Account, start: Date, end: Date, shopId?: string) {
    return this.prisma.posSale.findMany({ where: { accountId: account.id, createdAt: { gte: start, lt: end }, ...(shopId ? { shopId } : {}) }, select: saleSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  /** The owner's completed sales on udozo.com, in the shop's currency: what the buyer paid, units and the listing. */
  private async online(account: Account, start: Date, end: Date) {
    const rows = await this.prisma.classifiedPurchase.findMany({
      where: { sellerId: account.customerId, completedAt: { gte: start, lt: end } },
      select: { id: true, source: true, listingId: true, completedAt: true, listing: { select: { title: true } }, order: { select: { priceMinor: true, currency: true, quantity: true } }, buyOrder: { select: { priceMinor: true, currency: true, quantity: true } } },
      orderBy: { completedAt: 'asc' },
    });
    return rows.flatMap(row => {
      const paid = row.order ?? row.buyOrder;
      if (!paid || paid.currency !== account.currency) return [];
      return [{ id: row.id, source: row.source, listingId: row.listingId, title: row.listing.title ?? 'Untitled listing', at: row.completedAt, amount: Number(paid.priceMinor), quantity: paid.quantity }];
    });
  }

  private refunds(account: Account, start: Date, end: Date, shopId?: string) {
    return this.prisma.posSale.findMany({ where: { accountId: account.id, status: 'refunded', refundedAt: { gte: start, lt: end }, ...(shopId ? { shopId } : {}) }, select: saleSelect });
  }

  /**
   * The overview (S2): takings in the shop and on udozo.com against the period before, transactions, the average basket
   * and items; by the hour (a day) or by the day, POS against online; the channel split and payment methods; the top
   * sellers; the latest sales; and what needs restocking.
   */
  async overview(customer: CustomerWithStore, input: { period?: ReportPeriod; from?: string; to?: string; shop?: string }) {
    const account = await this.account(customer);
    const shop = await this.shop(account, input.shop);
    const zone = marketZone(account.country);
    const range = periodRange(input.period ?? 'today', input, zone);
    const [sold, online, previousSold, previousOnline, refunded] = await Promise.all([
      this.sales(account, range.start, range.end, shop?.id),
      this.online(account, range.start, range.end),
      this.sales(account, range.previous.start, range.previous.end, shop?.id),
      this.online(account, range.previous.start, range.previous.end),
      this.refunds(account, range.start, range.end, shop?.id),
    ]);
    const completed = sold.filter(sale => sale.status === 'completed');
    const previous = previousSold.filter(sale => sale.status === 'completed');
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const posTotal = sum(completed.map(sale => Number(sale.totalMinor)));
    const onlineTotal = sum(online.map(row => row.amount));
    const previousTotal = sum(previous.map(sale => Number(sale.totalMinor))) + sum(previousOnline.map(row => row.amount));
    const transactions = completed.length + online.length;
    const previousTransactions = previous.length + previousOnline.length;
    const items = sum(completed.flatMap(sale => sale.lines.map(line => line.quantity))) + sum(online.map(row => row.quantity));
    const previousItems = sum(previous.flatMap(sale => sale.lines.map(line => line.quantity))) + sum(previousOnline.map(row => row.quantity));
    const basket = transactions ? Math.round((posTotal + onlineTotal) / transactions) : 0;
    const previousBasket = previousTransactions ? Math.round(previousTotal / previousTransactions) : 0;

    // By the hour or the day.
    const hourOf = (at: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(at));
    const keys = range.by === 'hour' ? Array.from({ length: 24 }, (_, hour) => String(hour)) : Array.from({ length: range.days }, (_, index) => addDays(range.fromDay, index));
    const keyOf = (at: Date) => (range.by === 'hour' ? String(hourOf(at)) : zonedDay(at, zone));
    const series = new Map(keys.map(key => [key, { pos: 0, online: 0 }]));
    for (const sale of completed) series.get(keyOf(sale.createdAt))!.pos += Number(sale.totalMinor);
    for (const row of online) {
      const bucket = series.get(keyOf(row.at));
      if (bucket) bucket.online += row.amount;
    }
    const points = keys.map(key => ({ key, label: range.by === 'hour' ? `${key.padStart(2, '0')}:00` : key, ...series.get(key)! }));
    const busiest = points.reduce<(typeof points)[number] | null>((best, point) => (point.pos + point.online > (best ? best.pos + best.online : 0) ? point : best), null);

    // Payment methods (the shop's own sales).
    const methods = new Map<string, number>();
    for (const sale of completed) for (const payment of sale.payments) methods.set(payment.method, (methods.get(payment.method) ?? 0) + Number(payment.amountMinor));
    const paid = sum([...methods.values()]);

    // Top sellers, in the shop and online together.
    const products = new Map<string, { listing_id: string; title: string; quantity: number; revenue: number; pos_quantity: number; online_quantity: number }>();
    const product = (id: string, title: string) => {
      if (!products.has(id)) products.set(id, { listing_id: id, title, quantity: 0, revenue: 0, pos_quantity: 0, online_quantity: 0 });
      return products.get(id)!;
    };
    for (const sale of completed)
      for (const line of sale.lines) {
        const row = product(line.listingId, line.title);
        row.quantity += line.quantity;
        row.pos_quantity += line.quantity;
        row.revenue += Number(line.totalMinor);
      }
    for (const item of online) {
      const row = product(item.listingId, item.title);
      row.quantity += item.quantity;
      row.online_quantity += item.quantity;
      row.revenue += item.amount;
    }
    const top = [...products.values()].sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity).slice(0, 10);

    // The latest sales, both channels.
    const recent = [
      ...sold.map(sale => ({ channel: 'pos' as const, id: sale.id, number: sale.number, title: sale.lines.length === 1 ? sale.lines[0]!.title : `${sale.lines.reduce((total, line) => total + line.quantity, 0)} items`, meta: `${sale.tillName} · ${sale.soldByName}`, methods: [...new Set(sale.payments.map(payment => payment.method))], amount: Number(sale.totalMinor), status: sale.status, at: sale.createdAt })),
      ...online.map(row => ({ channel: 'online' as const, id: row.id, number: null, title: row.title, meta: row.source === 'buy_order' ? 'Buy order on udozo.com' : 'UdozoPay on udozo.com', methods: [], amount: row.amount, status: 'completed', at: row.at })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 8)
      .map(row => ({ ...row, at: row.at.toISOString() }));

    const restock = await this.restock(account);
    // Several shops: each one's takings (the shop filter shows one).
    const shops = await this.prisma.posShop.findMany({ where: { accountId: account.id }, select: { id: true, name: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const byShop = shops.length > 1 ? shops.map(item => { const mine = completed.filter(sale => sale.shopId === item.id); return { shop_id: item.id, name: item.name, sales: mine.length, total: sum(mine.map(sale => Number(sale.totalMinor))) }; }) : [];
    return {
      object: 'pos_overview' as const,
      currency: account.currency,
      period: input.period ?? 'today',
      from: range.fromDay,
      to: range.toDay,
      by: range.by,
      shop: shop ? { id: shop.id, name: shop.name } : null,
      totals: {
        sales: { value: posTotal + onlineTotal, previous: previousTotal, change_pct: changePct(posTotal + onlineTotal, previousTotal) },
        transactions: { value: transactions, previous: previousTransactions, change_pct: changePct(transactions, previousTransactions), pos: completed.length, online: online.length },
        average_basket: { value: basket, previous: previousBasket, change_pct: changePct(basket, previousBasket) },
        items: { value: items, previous: previousItems, change_pct: changePct(items, previousItems) },
        refunds: { count: refunded.length, amount: sum(refunded.map(sale => Number(sale.totalMinor))) },
        low_stock: restock.length,
      },
      channels: {
        pos: { amount: posTotal, share_pct: posTotal + onlineTotal ? Math.round((posTotal * 100) / (posTotal + onlineTotal)) : 0 },
        online: { amount: onlineTotal, share_pct: posTotal + onlineTotal ? 100 - Math.round((posTotal * 100) / (posTotal + onlineTotal)) : 0 },
      },
      series: points,
      busiest: busiest && busiest.pos + busiest.online > 0 ? { label: busiest.label, amount: busiest.pos + busiest.online } : null,
      payment_methods: [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([method, amount]) => ({ method, amount, share_pct: paid ? Math.round((amount * 100) / paid) : 0 })),
      /** Several shops: each one's sales and takings in the period. */
      by_shop: byShop,
      top_sellers: top,
      recent,
      restock,
    };
  }

  /**
   * What needs restocking: the owner's products at the till that are out of stock or at their reorder level, with how
   * fast they sold over the last 7 days (shop and online) and how many days that leaves, the emptiest first.
   */
  private async restock(account: Account) {
    const listings = await this.prisma.classifiedListing.findMany({
      where: { customerId: account.customerId, posEnabledAt: { not: null }, status: { in: posCountedStatuses } },
      select: { id: true, title: true, stock: true, reorderLevel: true },
    });
    const low = listings.filter(row => row.stock === 0 || (row.reorderLevel !== null && row.stock <= row.reorderLevel)).slice(0, 200);
    if (!low.length) return [];
    const since = new Date(Date.now() - 7 * dayMs);
    const ids = low.map(row => row.id);
    const [lines, online] = await Promise.all([
      this.prisma.posSaleLine.groupBy({ by: ['listingId'], where: { listingId: { in: ids }, sale: { accountId: account.id, status: 'completed', createdAt: { gte: since } } }, _sum: { quantity: true } }),
      this.online(account, since, new Date()),
    ]);
    const sold = new Map(lines.map(row => [row.listingId, row._sum.quantity ?? 0]));
    for (const row of online) if (ids.includes(row.listingId)) sold.set(row.listingId, (sold.get(row.listingId) ?? 0) + row.quantity);
    const rows = [];
    for (const row of low) {
      const held = await heldUnits(this.prisma, row.id);
      const perDay = (sold.get(row.id) ?? 0) / 7;
      rows.push({
        listing_id: row.id,
        title: row.title ?? 'Untitled listing',
        stock: row.stock,
        available: Math.max(0, row.stock - held),
        reorder_level: row.reorderLevel,
        /** Units a day over the last 7 days, shop and online, to one decimal place. */
        per_day: Math.round(perDay * 10) / 10,
        /** How many days the stock lasts at that rate (null when nothing sold). */
        days_left: perDay > 0 ? Math.floor(row.stock / perDay) : null,
      });
    }
    return rows.sort((a, b) => (a.stock === 0 ? -1 : 0) - (b.stock === 0 ? -1 : 0) || (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || a.stock - b.stock).slice(0, 20);
  }

  /**
   * End of day (the Z report): a shop's day, or every shop's. Sales rung up that day (gross, discounts, VAT, takings),
   * by payment method, till and member of staff; refunds made that day; what it came to; items and top products; the
   * shifts opened that day with their cash counted against expected; and udozo.com's sales that day beside them.
   */
  async day(customer: CustomerWithStore, input: { date?: string; shop?: string }) {
    const account = await this.account(customer);
    const shop = await this.shop(account, input.shop);
    const zone = marketZone(account.country);
    const date = input.date ?? zonedDay(new Date(), zone);
    if (!isDay(date)) throw invalid('parameter_invalid', 'Give the day as YYYY-MM-DD.', 'date');
    const start = zonedDayStart(date, zone);
    const end = zonedDayStart(addDays(date, 1), zone);
    const [sold, refunded, online, shifts] = await Promise.all([
      this.sales(account, start, end, shop?.id),
      this.refunds(account, start, end, shop?.id),
      this.online(account, start, end),
      this.prisma.posShift.findMany({ where: { accountId: account.id, openedAt: { gte: start, lt: end }, ...(shop ? { shopId: shop.id } : {}) }, include: { cash: true }, orderBy: { openedAt: 'asc' } }),
    ]);
    const completed = sold.filter(sale => sale.status === 'completed');
    const sum = (values: Array<number | bigint>) => values.reduce<number>((total, value) => total + Number(value), 0);
    const group = <T>(rows: T[], key: (row: T) => string, amount: (row: T) => number) => {
      const map = new Map<string, { name: string; sales: number; total: number }>();
      for (const row of rows) {
        const name = key(row);
        const entry = map.get(name) ?? { name, sales: 0, total: 0 };
        entry.sales += 1;
        entry.total += amount(row);
        map.set(name, entry);
      }
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const methods = new Map<string, number>();
    for (const sale of completed) for (const payment of sale.payments) methods.set(payment.method, (methods.get(payment.method) ?? 0) + Number(payment.amountMinor));
    const refundMethods = new Map<string, number>();
    for (const sale of refunded) for (const payment of sale.payments) refundMethods.set(payment.method, (refundMethods.get(payment.method) ?? 0) + Number(payment.amountMinor));
    const products = new Map<string, { title: string; quantity: number; revenue: number }>();
    for (const sale of completed)
      for (const line of sale.lines) {
        const row = products.get(line.listingId) ?? { title: line.title, quantity: 0, revenue: 0 };
        row.quantity += line.quantity;
        row.revenue += Number(line.totalMinor);
        products.set(line.listingId, row);
      }
    const total = sum(completed.map(sale => sale.totalMinor));
    const refundsTotal = sum(refunded.map(sale => sale.totalMinor));
    const shiftRows = [];
    for (const row of shifts) {
      const totals = row.status === 'open' ? await this.shifts.totals(row) : ((row.totals as ShiftTotals | null) ?? (await this.shifts.totals(row)));
      shiftRows.push(this.shifts.present(row, totals));
    }
    return {
      object: 'pos_day' as const,
      date,
      currency: account.currency,
      shop: shop ? { id: shop.id, name: shop.name } : null,
      sales: {
        count: completed.length,
        gross: sum(completed.map(sale => sale.subtotalMinor)),
        discounts: sum(completed.map(sale => sale.discountMinor)),
        vat: sum(completed.map(sale => sale.vatMinor)),
        total,
        items: sum(completed.flatMap(sale => sale.lines.map(line => line.quantity))),
      },
      refunds: { count: refunded.length, total: refundsTotal, by_method: Object.fromEntries(refundMethods) },
      /** Takings less the refunds made that day. */
      net: total - refundsTotal,
      by_method: [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([method, amount]) => ({ method, amount })),
      by_till: group(completed, sale => sale.tillName, sale => Number(sale.totalMinor)),
      by_staff: group(completed, sale => sale.soldByName, sale => Number(sale.totalMinor)),
      top_products: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      shifts: shiftRows,
      online: { count: online.length, total: sum(online.map(row => row.amount)) },
    };
  }

  /** The end of day as a PDF for the books. */
  async dayPdf(customer: CustomerWithStore, input: { date?: string; shop?: string }) {
    const day = await this.day(customer, input);
    const money = (minor: number) => formatMoney(minor, day.currency);
    const shopName = day.shop?.name ?? (await this.shopNames(customer)).join(', ');
    const sections: ReportSection[] = [
      {
        heading: 'Takings',
        rows: [
          ['Sales', String(day.sales.count)],
          ['Items sold', String(day.sales.items)],
          ['Gross (before discounts)', money(day.sales.gross)],
          ['Discounts', money(day.sales.discounts)],
          ['VAT', money(day.sales.vat)],
          ['Takings', money(day.sales.total), true],
          [`Refunds (${day.refunds.count})`, money(day.refunds.total)],
          ['Net', money(day.net), true],
        ],
      },
      { heading: 'By payment method', columns: [{ label: 'Method', width: 3 }, { label: 'Amount', width: 2, align: 'right' }], table: day.by_method.map(row => [paymentWords[row.method] ?? row.method, money(row.amount)]) },
      { heading: 'By till', columns: [{ label: 'Till', width: 3 }, { label: 'Sales', width: 1, align: 'right' }, { label: 'Takings', width: 2, align: 'right' }], table: day.by_till.map(row => [row.name, String(row.sales), money(row.total)]) },
      { heading: 'By member of staff', columns: [{ label: 'Sold by', width: 3 }, { label: 'Sales', width: 1, align: 'right' }, { label: 'Takings', width: 2, align: 'right' }], table: day.by_staff.map(row => [row.name, String(row.sales), money(row.total)]) },
      {
        heading: 'Shifts and cash-up',
        columns: [{ label: 'Till', width: 2 }, { label: 'Opened by', width: 2 }, { label: 'Closed by', width: 2 }, { label: 'Expected', width: 2, align: 'right' }, { label: 'Counted', width: 2, align: 'right' }, { label: 'Over or short', width: 2, align: 'right' }],
        table: day.shifts.map(row => [row.till.name, `${row.opened_by}`, row.closed_by ?? 'Still open', row.expected_cash === null ? '' : money(row.expected_cash), row.counted_cash === null ? '' : money(row.counted_cash), row.difference === null ? '' : money(row.difference)]),
        empty: 'No shift was opened.',
      },
      { heading: 'Top products', columns: [{ label: 'Product', width: 5 }, { label: 'Sold', width: 1, align: 'right' }, { label: 'Revenue', width: 2, align: 'right' }], table: day.top_products.map(row => [row.title, String(row.quantity), money(row.revenue)]) },
      { heading: 'On udozo.com the same day', rows: [['Sales', String(day.online.count)], ['Takings', money(day.online.total)]] },
    ];
    const bytes = await reportPdf({ title: `End of day · ${day.date}`, subtitle: shopName, meta: [`Amounts in ${day.currency}. Takings are sales rung up that day; refunds count on the day they were made.`], sections });
    return { bytes, name: `End-of-day-${day.date}.pdf`, contentType: 'application/pdf' as const };
  }

  private async shopNames(customer: CustomerWithStore) {
    const account = await this.account(customer);
    return (await this.prisma.posShop.findMany({ where: { accountId: account.id }, select: { name: true }, orderBy: { position: 'asc' } })).map(row => row.name);
  }

  private async exportRange(customer: CustomerWithStore, input: { from?: string; to?: string; shop?: string }) {
    const account = await this.account(customer);
    const shop = await this.shop(account, input.shop);
    const zone = marketZone(account.country);
    // Exports cover whole days, never cut at the present moment.
    const range = periodRange('custom', input, zone, new Date(8.64e15));
    return { account, shop, range };
  }

  /**
   * The period's sales as CSV for the bookkeeper: one row a sale (`sales`), or one a line (`lines`), with amounts in the
   * currency's units (two decimals) and the shop's local time. At most 50,000 rows (`export_too_large`).
   */
  async csv(customer: CustomerWithStore, input: { from?: string; to?: string; shop?: string; detail?: 'sales' | 'lines' }) {
    const { account, shop, range } = await this.exportRange(customer, input);
    const zone = marketZone(account.country);
    const sales = await this.sales(account, range.start, range.end, shop?.id);
    const rows = input.detail === 'lines' ? sales.reduce((total, sale) => total + sale.lines.length, 0) : sales.length;
    if (rows > maxExportRows) throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'invalid_request_error', 'export_too_large', `That is more than ${maxExportRows.toLocaleString('en-GB')} rows. Choose a shorter period.`, 'from');
    const local = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at).replace(', ', ' ');
    const table: Array<Array<string | number | null>> = [];
    if (input.detail === 'lines') {
      table.push(['Date', 'Sale', 'Shop', 'Till', 'SKU', 'Product', 'Quantity', 'Unit price', 'Line discount', 'Line total', 'Status', 'Currency']);
      for (const sale of sales) for (const line of sale.lines) table.push([local(sale.createdAt), sale.number, sale.shop.name, sale.tillName, line.sku, line.title, line.quantity, decimal(line.unitPriceMinor), decimal(line.discountMinor), decimal(line.totalMinor), sale.status, account.currency]);
    } else {
      table.push(['Date', 'Sale', 'Invoice', 'Shop', 'Till', 'Sold by', 'Customer', 'Items', 'Subtotal', 'Discount', 'VAT rate', 'VAT', 'Total', 'Paid by', 'Status', 'Refunded at', 'Refund reason', 'Currency']);
      for (const sale of sales)
        table.push([
          local(sale.createdAt),
          sale.number,
          sale.invoiceNumber,
          sale.shop.name,
          sale.tillName,
          sale.soldByName,
          sale.customer?.name ?? null,
          sale.lines.reduce((total, line) => total + line.quantity, 0),
          decimal(sale.subtotalMinor),
          decimal(sale.discountMinor),
          `${sale.vatBps / 100}%`,
          decimal(sale.vatMinor),
          decimal(sale.totalMinor),
          sale.payments.map(payment => `${paymentWords[payment.method] ?? payment.method} ${decimal(payment.amountMinor)}`).join('; '),
          sale.status,
          sale.refundedAt ? local(sale.refundedAt) : null,
          sale.refundReason,
          account.currency,
        ]);
    }
    const body = `${table.map(row => row.map(cell => csvCell(cell)).join(',')).join('\r\n')}\r\n`;
    return { bytes: Buffer.from(`\uFEFF${body}`, 'utf8'), name: `${input.detail === 'lines' ? 'sale-lines' : 'sales'}-${range.fromDay}-to-${range.toDay}.csv`, contentType: 'text/csv; charset=utf-8' as const };
  }

  /** A period's summary as a PDF for the accountant: takings, by method and by day, VAT, refunds, top products and the shifts' cash. */
  async summaryPdf(customer: CustomerWithStore, input: { from?: string; to?: string; shop?: string }) {
    const { account, shop, range } = await this.exportRange(customer, input);
    const zone = marketZone(account.country);
    const [sold, refunded, shifts] = await Promise.all([
      this.sales(account, range.start, range.end, shop?.id),
      this.refunds(account, range.start, range.end, shop?.id),
      this.prisma.posShift.findMany({ where: { accountId: account.id, status: 'closed', openedAt: { gte: range.start, lt: range.end }, ...(shop ? { shopId: shop.id } : {}) }, orderBy: { openedAt: 'asc' } }),
    ]);
    const completed = sold.filter(sale => sale.status === 'completed');
    const money = (minor: number | bigint) => formatMoney(minor, account.currency);
    const sum = (values: Array<number | bigint>) => values.reduce<number>((total, value) => total + Number(value), 0);
    const methods = new Map<string, number>();
    for (const sale of completed) for (const payment of sale.payments) methods.set(payment.method, (methods.get(payment.method) ?? 0) + Number(payment.amountMinor));
    const byDay = new Map<string, { sales: number; vat: number; total: number }>();
    for (const sale of completed) {
      const key = zonedDay(sale.createdAt, zone);
      const row = byDay.get(key) ?? { sales: 0, vat: 0, total: 0 };
      row.sales += 1;
      row.vat += Number(sale.vatMinor);
      row.total += Number(sale.totalMinor);
      byDay.set(key, row);
    }
    const products = new Map<string, { title: string; quantity: number; revenue: number }>();
    for (const sale of completed)
      for (const line of sale.lines) {
        const row = products.get(line.listingId) ?? { title: line.title, quantity: 0, revenue: 0 };
        row.quantity += line.quantity;
        row.revenue += Number(line.totalMinor);
        products.set(line.listingId, row);
      }
    const total = sum(completed.map(sale => sale.totalMinor));
    const refundsTotal = sum(refunded.map(sale => sale.totalMinor));
    const sections: ReportSection[] = [
      {
        heading: 'Takings',
        rows: [
          ['Sales', String(completed.length)],
          ['Gross (before discounts)', money(sum(completed.map(sale => sale.subtotalMinor)))],
          ['Discounts', money(sum(completed.map(sale => sale.discountMinor)))],
          ['VAT', money(sum(completed.map(sale => sale.vatMinor)))],
          ['Takings', money(total), true],
          [`Refunds (${refunded.length})`, money(refundsTotal)],
          ['Net', money(total - refundsTotal), true],
        ],
      },
      { heading: 'By payment method', columns: [{ label: 'Method', width: 3 }, { label: 'Amount', width: 2, align: 'right' }], table: [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([method, amount]) => [paymentWords[method] ?? method, money(amount)]) },
      { heading: 'By day', columns: [{ label: 'Day', width: 2 }, { label: 'Sales', width: 1, align: 'right' }, { label: 'VAT', width: 2, align: 'right' }, { label: 'Takings', width: 2, align: 'right' }], table: [...byDay.entries()].map(([key, row]) => [key, String(row.sales), money(row.vat), money(row.total)]) },
      {
        heading: 'Shifts and cash-up',
        columns: [{ label: 'Day', width: 2 }, { label: 'Till', width: 2 }, { label: 'Closed by', width: 2 }, { label: 'Expected', width: 2, align: 'right' }, { label: 'Counted', width: 2, align: 'right' }, { label: 'Over or short', width: 2, align: 'right' }],
        table: shifts.map(row => [zonedDay(row.openedAt, zone), row.tillName, row.closedByName ?? '', money(row.expectedCashMinor ?? 0n), money(row.countedCashMinor ?? 0n), money(row.differenceMinor ?? 0n)]),
        empty: 'No shift was closed.',
      },
      { heading: 'Top products', columns: [{ label: 'Product', width: 5 }, { label: 'Sold', width: 1, align: 'right' }, { label: 'Revenue', width: 2, align: 'right' }], table: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20).map(row => [row.title, String(row.quantity), money(row.revenue)]) },
    ];
    const shopName = shop?.name ?? (await this.shopNames(customer)).join(', ');
    const bytes = await reportPdf({ title: `Sales summary · ${range.fromDay} to ${range.toDay}`, subtitle: shopName, meta: [`Amounts in ${account.currency}. Takings are sales rung up in the period; refunds count on the day they were made.`], sections });
    return { bytes, name: `Sales-summary-${range.fromDay}-to-${range.toDay}.pdf`, contentType: 'application/pdf' as const };
  }
}
