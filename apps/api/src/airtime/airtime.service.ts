import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type AirtimeCollectorLine, type AirtimeNetwork, type AirtimePurchase, type AirtimeSale, type LedgerMode } from '../generated/prisma/client.js';
import { LedgerService, type PreparedEntry } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * The airtime exchange (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md, built 15 November 2026 at the owner's request): BitoCard
 * buys customers' unused airtime into a pool per network and sells it from the pool at a discount, the pool shown to
 * everyone.
 *
 * - **Selling:** the seller says the network and amount; BitoCard gives one of its collector lines on that network with
 *   room in its daily limit, and the seller sends the airtime from their own confirmed number with the network's own
 *   transfer service, within the hour. Staff (or later an SMS forwarder) confirm it arrived; the airtime joins the pool
 *   at once, and the seller's wallet is credited at the network's sell rate once the hold has passed
 *   (`credit_hold_hours`, 24 by default), so a transfer the network reverses costs nothing.
 * - **Buying:** the buyer pays the network's buy rate from their wallet (locked, `customer_wallet_locked`) for airtime
 *   the pool has free; staff send it from a collector line within the hour, or the buyer is refunded.
 *
 * The books: received airtime is `airtime_inventory` (at what BitoCard pays, one account per network) against
 * `airtime_payable` (owed to the seller until credited); a delivery takes the pool's average cost out of inventory and
 * the rest of the price is `platform_revenue`. Behind the `airtime_exchange` switch (country), off by default; root
 * bitocard.com only.
 */

/** Every trade is settled within this: sellers send in it, staff send buyers theirs in it, else it ends. */
export /** A transfer staff find on the line counts even after the seller's hour ended (the airtime is ours either way). */
const receivable = ['awaiting_transfer', 'sent', 'expired'];
/** Strikes (a "sent" that never arrived, or a transfer the network reversed) pause selling at this many in the window. */
export const strikeLimit = 3;
const strikeWindowMs = 90 * 24 * 60 * 60_000;
const tradeWindowMs = 60 * 60_000;
const maxOpenPerCustomer = 3;
const dayMs = 24 * 60 * 60_000;

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const saleMissing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such airtime sale.');
const purchaseMissing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such airtime purchase.');

export const saleNumber = (n: number) => `AS-${String(n).padStart(6, '0')}`;
export const purchaseNumber = (n: number) => `AP-${String(n).padStart(6, '0')}`;

/** A rate (basis points of face value) applied to an amount: rounded down for what sellers get, up for what buyers pay. */
export const sellerGets = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10_000n;
export const buyerPays = (amount: bigint, bps: number) => (amount * BigInt(bps) + 9_999n) / 10_000n;

/** The network's transfer steps with the line's number and the amount filled in (the PIN stays the seller's). */
export function transferSteps(steps: string, number: string, amountMinor: bigint) {
  const local = number.startsWith('+234') ? `0${number.slice(4)}` : number;
  return steps.replaceAll('{number}', local).replaceAll('{amount}', String(amountMinor / 100n)).replaceAll('{pin}', 'PIN');
}

const num = (value: bigint | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

type Tx = Prisma.TransactionClient;
type LineWithRoom = { id: string; number: string; room: bigint };

@Injectable()
export class AirtimeExchangeService {
  private readonly logger = new Logger(AirtimeExchangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly stores: StoreSellers,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // Networks and the pool.

  private networks(country: string) {
    return this.prisma.airtimeNetwork.findMany({ where: { country }, orderBy: [{ position: 'asc' }, { network: 'asc' }] });
  }

  private async network(country: string, network: string) {
    const found = await this.prisma.airtimeNetwork.findUnique({ where: { country_network: { country, network } } });
    if (!found) throw invalid('network_unknown', 'Choose one of the networks shown.', 'network');
    return found;
  }

  /** The inventory account of a network (one per network, by its place in the list). */
  private inventory(network: AirtimeNetwork) {
    return { kind: 'airtime_inventory' as const, currency: network.currency, shard: network.position || 1 };
  }

  /** The mode bitocard.com's pool and trades run in: the root store's (its checkout sandbox switch). */
  private async mode(): Promise<LedgerMode> {
    return this.stores.mode(await this.stores.resolve(null));
  }

  /**
   * The pool everyone sees (public): per network what is available to buy now, what BitoCard bought and sold in all
   * and in the last 24 hours, and its rates. Never the collector lines or their limits.
   */
  async pool(countryCode = 'NG') {
    const country = countryCode.toUpperCase();
    const [mode, networks, open] = await Promise.all([this.mode(), this.networks(country), this.settings.isOnForCountry('airtime_exchange', country)]);
    const since = new Date(Date.now() - dayMs);
    const [pools, lines, bought, sold] = await Promise.all([
      this.prisma.airtimePool.findMany({ where: { mode, country } }),
      this.prisma.airtimeCollectorLine.groupBy({ by: ['network'], where: { country, active: true }, _count: { _all: true } }),
      this.prisma.airtimeSale.groupBy({ by: ['network'], where: { mode, country, receivedAt: { gte: since }, status: { in: ['received', 'credited'] } }, _sum: { amountMinor: true } }),
      this.prisma.airtimePurchase.groupBy({ by: ['network'], where: { mode, country, deliveredAt: { gte: since }, status: 'delivered' }, _sum: { amountMinor: true } }),
    ]);
    const rows = networks.map(network => {
      const pool = pools.find(item => item.network === network.network);
      const available = pool ? pool.availableMinor - pool.reservedMinor : 0n;
      return {
        object: 'airtime_network' as const,
        network: network.network,
        name: network.name,
        open: open && network.enabled && lines.some(line => line.network === network.network),
        sell_rate_bps: network.sellRateBps,
        buy_rate_bps: network.buyRateBps,
        min_amount: num(network.minAmountMinor),
        max_amount: num(network.maxAmountMinor),
        available: num(available),
        bought_total: num(pool?.boughtMinor ?? 0n),
        sold_total: num(pool?.soldMinor ?? 0n),
        bought_24h: num(bought.find(item => item.network === network.network)?._sum.amountMinor ?? 0n),
        sold_24h: num(sold.find(item => item.network === network.network)?._sum.amountMinor ?? 0n),
      };
    });
    const sum = (key: 'available' | 'bought_total' | 'sold_total' | 'bought_24h' | 'sold_24h') => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
    const updated = pools.reduce((latest, pool) => (pool.updatedAt > latest ? pool.updatedAt : latest), new Date(0));
    return {
      object: 'airtime_pool' as const,
      country,
      currency: networks[0]?.currency ?? null,
      mode,
      open,
      networks: rows,
      totals: { available: sum('available'), bought_total: sum('bought_total'), sold_total: sum('sold_total'), bought_24h: sum('bought_24h'), sold_24h: sum('sold_24h') },
      updated_at: pools.length ? updated.toISOString() : null,
    };
  }

  // Customers.

  /** bitocard.com's own customers, email confirmed, where the exchange is open for the network's country. */
  private async gate(customer: CustomerWithStore, network: AirtimeNetwork) {
    if (!this.stores.isRoot(customer.store)) throw conflict('airtime_unavailable', 'The airtime exchange is only on bitocard.com.');
    if (!customer.emailVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    if (!(await this.settings.isOnForCountry('airtime_exchange', network.country))) throw conflict('airtime_unavailable', 'The airtime exchange is not open yet.');
    if (!network.enabled) throw conflict('network_closed', `${network.name} airtime is not being traded right now.`, 'network');
    return this.mode();
  }

  private checkAmount(network: AirtimeNetwork, amount: bigint) {
    if (amount < network.minAmountMinor || amount > network.maxAmountMinor) {
      throw invalid('amount_out_of_range', `Choose between ${formatMoney(network.minAmountMinor, network.currency)} and ${formatMoney(network.maxAmountMinor, network.currency)}.`, 'amount');
    }
    if (amount % 100n !== 0n) throw invalid('amount_invalid', 'Choose a whole amount, with no kobo.', 'amount');
  }

  /**
   * Starts a sale: checks the seller's own confirmed number, their limits, and finds a collector line on the network
   * with room today (the lines are locked while the room is counted, so two sellers never overfill one).
   */
  async sell(customer: CustomerWithStore, input: { network: string; amount: number; from_phone?: string; preview?: boolean }) {
    const country = customer.country ?? 'NG';
    const network = await this.network(country, input.network.toLowerCase());
    const mode = await this.gate(customer, network);
    const amount = BigInt(input.amount);
    this.checkAmount(network, amount);
    if (customer.country !== network.country) throw conflict('country_mismatch', `Only customers in ${network.country} can sell ${network.name} airtime.`);
    const fromPhone = await this.confirmedNumber(customer, input.from_phone, 'from_phone', 'You can sell only from one of your confirmed numbers. Add and confirm it on your profile first.');
    const payout = sellerGets(amount, network.sellRateBps);
    const quote = { network: network.network, amount: num(amount), currency: network.currency, rate_bps: network.sellRateBps, payout: num(payout), from_phone: fromPhone };
    if (input.preview) return { object: 'airtime_sale_quote' as const, ...quote };

    const open = await this.prisma.airtimeSale.count({ where: { customerId: customer.id, status: { in: ['awaiting_transfer', 'sent'] } } });
    if (open >= maxOpenPerCustomer) throw conflict('too_many_open', 'Finish the airtime sales you started first.');
    const standing = await this.standing(customer.id);
    if (standing.paused) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'selling_paused', `Selling airtime is paused on your account: ${strikeLimit} of your sales were not received or were reversed. Contact us if you think this is wrong.`);
    }
    const isNew = standing.completed < network.establishedAfter;
    const daily = isNew ? network.newSellerDailyMinor : network.sellerDailyMinor;
    const soldToday = await this.soldToday(customer.id);
    if (soldToday + amount > daily) {
      throw conflict(
        isNew ? 'new_seller_limit' : 'seller_limit',
        isNew
          ? `As a new seller you can sell up to ${formatMoney(daily, network.currency)} of airtime a day, until ${network.establishedAfter} of your sales are complete.`
          : `You can sell up to ${formatMoney(daily, network.currency)} of airtime a day.`,
        'amount',
      );
    }
    const sale = await this.prisma.$transaction(async tx => {
      const line = await this.lineWithRoom(tx, network, amount);
      if (!line) throw conflict('airtime_busy', `We cannot take more ${network.name} airtime right now. Try a smaller amount, or later.`, 'amount');
      return tx.airtimeSale.create({
        data: {
          mode,
          customerId: customer.id,
          storeId: customer.storeId,
          country: network.country,
          network: network.network,
          lineId: line.id,
          fromPhone,
          amountMinor: amount,
          currency: network.currency,
          rateBps: network.sellRateBps,
          payoutMinor: payout,
          expiresAt: new Date(Date.now() + tradeWindowMs),
        },
        include: { line: true },
      });
    });
    return this.presentSale(sale, { network });
  }

  /**
   * One of the customer's confirmed numbers: the one asked for, else their default. Airtime only ever moves to or from
   * a confirmed number, so the collector's "received from" message can be matched to its owner.
   */
  private async confirmedNumber(customer: CustomerWithStore, raw: string | undefined, param: string, refusal: string) {
    const phones = await this.prisma.customerPhone.findMany({ where: { customerId: customer.id }, select: { phone: true } });
    if (!phones.length) throw conflict('phone_required', 'Confirm a mobile number on your profile first: airtime moves only to and from your confirmed numbers.', param);
    const wanted = raw ? normalisePhone(raw, customer.country ?? 'NG') : customer.phoneVerifiedAt ? customer.phone : phones[0].phone;
    if (!wanted || !phones.some(item => item.phone === wanted)) throw conflict('phone_not_verified', refusal, param);
    return wanted;
  }

  /** Airtime the customer has sold, or is selling, in the last 24 hours. */
  private async soldToday(customerId: string) {
    const today = await this.prisma.airtimeSale.aggregate({
      where: { customerId, createdAt: { gte: new Date(Date.now() - dayMs) }, status: { in: ['awaiting_transfer', 'sent', 'received', 'credited'] } },
      _sum: { amountMinor: true },
    });
    return today._sum.amountMinor ?? 0n;
  }

  /**
   * A seller's standing: completed (credited) sales, and strikes in the last 90 days since operations last cleared
   * them. At the limit their selling is paused.
   */
  async standing(customerId: string) {
    const record = await this.prisma.airtimeSellerStanding.findUnique({ where: { customerId } });
    const windowStart = new Date(Date.now() - strikeWindowMs);
    const from = record?.clearedAt && record.clearedAt > windowStart ? record.clearedAt : windowStart;
    const [strikes, completed] = await Promise.all([
      this.prisma.airtimeSale.findMany({ where: { customerId, struckAt: { gt: from } }, orderBy: { struckAt: 'asc' }, select: { struckAt: true } }),
      this.prisma.airtimeSale.count({ where: { customerId, status: 'credited' } }),
    ]);
    const paused = strikes.length >= strikeLimit;
    return {
      strikes: strikes.length,
      completed,
      paused,
      cleared_at: record?.clearedAt ?? null,
      /** When the oldest strike counting now leaves the 90 days. */
      oldest_expires_at: strikes[0]?.struckAt ? new Date(strikes[0].struckAt.getTime() + strikeWindowMs) : null,
    };
  }

  /** The seller's own view: where they stand, and each network's daily limit for them today. */
  async sellerStatus(customer: CustomerWithStore) {
    const [standing, soldToday, networks] = await Promise.all([
      this.standing(customer.id),
      this.soldToday(customer.id),
      this.prisma.airtimeNetwork.findMany({ where: { country: customer.country ?? 'NG' }, orderBy: { position: 'asc' } }),
    ]);
    return {
      object: 'airtime_seller' as const,
      completed_sales: standing.completed,
      strikes: standing.strikes,
      strike_limit: strikeLimit,
      paused: standing.paused,
      strikes_expire_at: standing.oldest_expires_at?.toISOString() ?? null,
      sold_today: num(soldToday),
      networks: networks.map(network => {
        const isNew = standing.completed < network.establishedAfter;
        return {
          network: network.network,
          new_seller: isNew,
          established_after: network.establishedAfter,
          daily_limit: num(isNew ? network.newSellerDailyMinor : network.sellerDailyMinor),
          seller_daily: num(network.sellerDailyMinor),
        };
      }),
    };
  }

  /** A strike was recorded: at the limit, selling pauses (the seller and operations told once). */
  private async afterStrike(sale: AirtimeSale) {
    const standing = await this.standing(sale.customerId);
    if (!standing.paused) return;
    const now = new Date();
    const record = await this.prisma.airtimeSellerStanding.upsert({ where: { customerId: sale.customerId }, create: { customerId: sale.customerId }, update: {} });
    const claimed = await this.prisma.airtimeSellerStanding.updateMany({
      where: { customerId: sale.customerId, OR: [{ pausedAt: null }, ...(record.clearedAt ? [{ pausedAt: { lt: record.clearedAt } }] : [])] },
      data: { pausedAt: now },
    });
    if (!claimed.count) return;
    await this.inbox.customer({ customerId: sale.customerId, storeId: sale.storeId }, 'customer.airtime.selling_paused', {
      subject: `${sale.customerId}:paused:${now.toISOString()}`,
      title: 'Selling airtime is paused',
      body: `${strikeLimit} of your airtime sales were not received or were reversed, so you cannot sell airtime for now. Contact us if you think this is wrong.`,
      link: '/account/airtime/sell',
      mode: sale.mode,
    });
    await this.inbox.admins('admin.airtime.seller_paused', {
      subject: `${sale.customerId}:${now.toISOString()}`,
      title: 'An airtime seller was paused',
      body: `${strikeLimit} strikes, the latest ${saleNumber(sale.number)} (${sale.fromPhone}). Check their sales before clearing them.`,
      link: '/orders/airtime?tab=sales',
      mode: sale.mode,
    });
  }

  /** Operations clear a seller's strikes (audited): earlier strikes stop counting and selling resumes. */
  async clearStrikes(adminId: string, customerId: string, reason: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, storeId: true } });
    if (!customer) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');
    const before = await this.standing(customerId);
    const now = new Date();
    await this.prisma.airtimeSellerStanding.upsert({
      where: { customerId },
      create: { customerId, clearedAt: now, clearedBy: adminId, clearReason: reason },
      update: { clearedAt: now, clearedBy: adminId, clearReason: reason, pausedAt: null },
    });
    await this.audit.record({ actorId: adminId, action: 'airtime.strikes_cleared', targetType: 'customer', targetId: customerId, before: { strikes: before.strikes, paused: before.paused }, after: { strikes: 0, paused: false, reason } });
    if (before.paused) {
      await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.airtime.selling_paused', {
        subject: `${customerId}:resumed:${now.toISOString()}`,
        title: 'You can sell airtime again',
        body: 'We looked at your sales and lifted the pause.',
        link: '/account/airtime/sell',
        mode: await this.mode(),
      });
    }
    return { object: 'airtime_seller_standing' as const, customer_id: customerId, ...this.plainStanding(await this.standing(customerId)) };
  }

  private plainStanding(standing: Awaited<ReturnType<AirtimeExchangeService['standing']>>) {
    return { strikes: standing.strikes, strike_limit: strikeLimit, paused: standing.paused, completed_sales: standing.completed, cleared_at: standing.cleared_at?.toISOString() ?? null };
  }

  async adminStanding(customerId: string) {
    return { object: 'airtime_seller_standing' as const, customer_id: customerId, ...this.plainStanding(await this.standing(customerId)) };
  }

  /** The active line with the most room left today (its own limit less what it received and what sellers are sending it). */
  private async lineWithRoom(tx: Tx, network: AirtimeNetwork, amount: bigint): Promise<LineWithRoom | null> {
    await this.rollDay(tx, network);
    const rows = await tx.$queryRaw<LineWithRoom[]>`
      SELECT l.id, l.number,
        l.daily_receive_minor - l.received_today_minor - COALESCE((
          SELECT SUM(s.amount_minor) FROM airtime_sales s WHERE s.line_id = l.id AND s.status IN ('awaiting_transfer', 'sent')
        ), 0)::bigint AS room
      FROM airtime_collector_lines l
      WHERE l.country = ${network.country} AND l.network = ${network.network} AND l.active
      ORDER BY room DESC, l.created_at ASC
      LIMIT 1`;
    const line = rows[0];
    return line && BigInt(line.room) >= amount ? line : null;
  }

  /** Starts a new day's counts on the network's lines (and locks them for the rest of the transaction). */
  private rollDay(tx: Tx, network: Pick<AirtimeNetwork, 'country' | 'network'>) {
    return tx.$executeRaw`
      UPDATE airtime_collector_lines SET
        received_today_minor = CASE WHEN counter_day = CURRENT_DATE THEN received_today_minor ELSE 0 END,
        sent_today_minor = CASE WHEN counter_day = CURRENT_DATE THEN sent_today_minor ELSE 0 END,
        counter_day = CURRENT_DATE,
        updated_at = NOW()
      WHERE country = ${network.country} AND network = ${network.network}`;
  }

  private async ownSale(customer: CustomerWithStore, id: string) {
    const sale = await this.prisma.airtimeSale.findFirst({ where: { id, customerId: customer.id } });
    if (!sale) throw saleMissing();
    return sale;
  }

  /** The seller says they sent it: staff are asked to check the line. */
  async markSent(customer: CustomerWithStore, id: string) {
    const sale = await this.ownSale(customer, id);
    const claimed = await this.prisma.airtimeSale.updateMany({ where: { id, status: 'awaiting_transfer', expiresAt: { gt: new Date() } }, data: { status: 'sent', sentAt: new Date() } });
    if (!claimed.count) {
      if (sale.status === 'sent') return this.presentSale(sale);
      throw conflict('sale_closed', 'This sale has ended. Start a new one.');
    }
    const after = await this.prisma.airtimeSale.findUniqueOrThrow({ where: { id }, include: { line: true } });
    await this.inbox.admins('admin.airtime.sale_sent', {
      subject: id,
      title: `${saleNumber(after.number)}: check ${after.line.number}`,
      body: `${formatMoney(after.amountMinor, after.currency)} of ${after.network.toUpperCase()} airtime from ${after.fromPhone}.`,
      link: '/orders/airtime?tab=sales',
      mode: after.mode,
    });
    return this.presentSale(after);
  }

  /** The seller changes their mind before sending. */
  async cancelSale(customer: CustomerWithStore, id: string) {
    await this.ownSale(customer, id);
    const claimed = await this.prisma.airtimeSale.updateMany({ where: { id, status: 'awaiting_transfer' }, data: { status: 'cancelled' } });
    if (!claimed.count) throw conflict('sale_not_cancellable', 'Once you say you sent the airtime, the sale can no longer be cancelled.');
    return this.presentSale(await this.prisma.airtimeSale.findUniqueOrThrow({ where: { id } }));
  }

  async listSales(customer: CustomerWithStore) {
    const sales = await this.prisma.airtimeSale.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { line: true } });
    const networks = await this.prisma.airtimeNetwork.findMany();
    return { object: 'list' as const, data: sales.map(sale => this.presentSale(sale, { network: networks.find(n => n.country === sale.country && n.network === sale.network) })) };
  }

  async getSale(customer: CustomerWithStore, id: string) {
    const sale = await this.prisma.airtimeSale.findFirst({ where: { id, customerId: customer.id }, include: { line: true } });
    if (!sale) throw saleMissing();
    return this.presentSale(sale, { network: await this.network(sale.country, sale.network) });
  }

  /**
   * Buys airtime from the pool: the price at the network's buy rate (`preview` quotes it), the airtime reserved in the
   * pool and the price locked from the buyer's wallet in one transaction, then staff send it within the hour.
   */
  async buy(customer: CustomerWithStore, input: { network: string; amount: number; phone: string; preview?: boolean; expected_price?: number }) {
    const network = await this.network('NG', input.network.toLowerCase());
    const mode = await this.gate(customer, network);
    const amount = BigInt(input.amount);
    this.checkAmount(network, amount);
    const phone = await this.confirmedNumber(customer, input.phone, 'phone', 'Airtime is sent only to one of your confirmed numbers. Add and confirm it on your profile first.');
    const price = buyerPays(amount, network.buyRateBps);
    const pool = await this.prisma.airtimePool.findUnique({ where: { mode_country_network: { mode, country: network.country, network: network.network } } });
    const free = pool ? pool.availableMinor - pool.reservedMinor : 0n;
    const quote = { network: network.network, amount: num(amount), currency: network.currency, rate_bps: network.buyRateBps, price: num(price), phone, available: num(free) };
    if (input.preview) return { object: 'airtime_purchase_quote' as const, ...quote };
    if (input.expected_price !== undefined && BigInt(input.expected_price) !== price) throw conflict('price_changed', 'The price changed. Check it and try again.', 'expected_price');
    const open = await this.prisma.airtimePurchase.count({ where: { customerId: customer.id, status: { in: ['paid', 'delivering'] } } });
    if (open >= maxOpenPerCustomer) throw conflict('too_many_open', 'Wait for the airtime you already bought to arrive first.');

    const id = randomUUID();
    const lock = await this.ledger.prepare({
      mode,
      type: 'airtime_purchase',
      reference: `airtime_purchase:${id}:locked`,
      description: `${network.name} airtime for ${phone}`,
      metadata: { airtime_purchase_id: id },
      lines: [
        { account: { kind: 'customer_wallet', currency: network.currency, customerId: customer.id }, debit: price },
        { account: { kind: 'customer_wallet_locked', currency: network.currency, customerId: customer.id }, credit: price },
      ],
    });
    try {
      const purchase = await this.prisma.$transaction(async tx => {
        const reserved = await tx.$executeRaw`
          UPDATE airtime_pools SET reserved_minor = reserved_minor + ${amount}, updated_at = NOW()
          WHERE mode = ${mode}::"LedgerMode" AND country = ${network.country} AND network = ${network.network} AND available_minor - reserved_minor >= ${amount}`;
        if (!reserved) throw conflict('pool_short', `Only ${formatMoney(free > 0n ? free : 0n, network.currency)} of ${network.name} airtime is available right now.`, 'amount');
        const created = await tx.airtimePurchase.create({
          data: {
            id,
            mode,
            customerId: customer.id,
            storeId: customer.storeId,
            country: network.country,
            network: network.network,
            phone,
            amountMinor: amount,
            currency: network.currency,
            rateBps: network.buyRateBps,
            priceMinor: price,
            expiresAt: new Date(Date.now() + tradeWindowMs),
          },
        });
        await this.ledger.write(tx, lock);
        return created;
      });
      await this.inbox.admins('admin.airtime.purchase_paid', {
        subject: id,
        title: `${purchaseNumber(purchase.number)}: send ${formatMoney(amount, network.currency)} ${network.name}`,
        body: `To ${phone}, within the hour, or it is refunded.`,
        link: '/orders/airtime?tab=purchases',
        mode,
      });
      return this.presentPurchase(purchase);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Your ${network.currency} wallet does not have ${formatMoney(price, network.currency)}. Add money first.`, 'amount');
      }
      throw error;
    }
  }

  async listPurchases(customer: CustomerWithStore) {
    const purchases = await this.prisma.airtimePurchase.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { object: 'list' as const, data: purchases.map(purchase => this.presentPurchase(purchase)) };
  }

  async getPurchase(customer: CustomerWithStore, id: string) {
    const purchase = await this.prisma.airtimePurchase.findFirst({ where: { id, customerId: customer.id } });
    if (!purchase) throw purchaseMissing();
    return this.presentPurchase(purchase);
  }

  /** BitoCard's sandbox only: the seller's airtime arrives (or not), or the buyer's is sent (or refunded). */
  async simulateSale(customer: CustomerWithStore, id: string, outcome: 'received' | 'not_received') {
    const sale = await this.ownSale(customer, id);
    if (sale.mode !== 'test') throw conflict('live_trade', 'Only sandbox trades can be simulated.');
    if (outcome === 'received') await this.receive(id, null);
    else await this.notReceived(id, null, 'Simulated in the sandbox.');
    return this.getSale(customer, id);
  }

  async simulatePurchase(customer: CustomerWithStore, id: string, outcome: 'delivered' | 'refunded') {
    const purchase = await this.prisma.airtimePurchase.findFirst({ where: { id, customerId: customer.id } });
    if (!purchase) throw purchaseMissing();
    if (purchase.mode !== 'test') throw conflict('live_trade', 'Only sandbox trades can be simulated.');
    if (outcome === 'delivered') await this.deliver(id, null, null);
    else await this.refund(id, null, 'Simulated in the sandbox.');
    return this.getPurchase(customer, id);
  }

  // Settling.

  /**
   * The seller's airtime arrived on the line: it joins the pool at once (at what BitoCard owes for it), and the seller
   * is credited once the hold has passed. Live trades count towards the line's day and balance.
   */
  async receive(id: string, adminId: string | null, note?: string) {
    const sale = await this.prisma.airtimeSale.findUnique({ where: { id } });
    if (!sale) throw saleMissing();
    if (!receivable.includes(sale.status)) throw conflict('sale_closed', `This sale is already ${sale.status.replaceAll('_', ' ')}.`);
    const network = await this.network(sale.country, sale.network);
    const entry = await this.ledger.prepare({
      mode: sale.mode,
      type: 'airtime_bought',
      reference: `airtime_sale:${id}:received`,
      description: `${network.name} airtime received (${saleNumber(sale.number)})`,
      metadata: { airtime_sale_id: id },
      lines: [
        { account: this.inventory(network), debit: sale.payoutMinor },
        { account: { kind: 'airtime_payable', currency: sale.currency }, credit: sale.payoutMinor },
      ],
    });
    const now = new Date();
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.airtimeSale.updateMany({
        where: { id, status: { in: receivable } },
        data: { status: 'received', receivedAt: now, creditAt: new Date(now.getTime() + network.creditHoldHours * 3_600_000), decidedBy: adminId, note: note ?? null },
      });
      if (!claimed.count) return null;
      await tx.airtimePool.upsert({
        where: { mode_country_network: { mode: sale.mode, country: sale.country, network: sale.network } },
        create: { mode: sale.mode, country: sale.country, network: sale.network, availableMinor: sale.amountMinor, costMinor: sale.payoutMinor, boughtMinor: sale.amountMinor },
        update: { availableMinor: { increment: sale.amountMinor }, costMinor: { increment: sale.payoutMinor }, boughtMinor: { increment: sale.amountMinor } },
      });
      if (sale.mode === 'live') {
        await this.rollDay(tx, sale);
        await tx.airtimeCollectorLine.update({ where: { id: sale.lineId }, data: { receivedTodayMinor: { increment: sale.amountMinor }, balanceMinor: { increment: sale.amountMinor } } });
      }
      await this.ledger.write(tx, entry);
      return tx.airtimeSale.findUniqueOrThrow({ where: { id } });
    });
    if (!done) throw conflict('sale_closed', 'This sale was already decided.');
    if (adminId) await this.audit.record({ actorId: adminId, action: 'airtime.sale_received', targetType: 'airtime_sale', targetId: id, before: { status: sale.status }, after: { status: 'received' } });
    await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.airtime.sale_received', {
      subject: `${id}:received`,
      title: `Your ${network.name} airtime arrived`,
      body: `${formatMoney(done.payoutMinor, done.currency)} reaches your wallet ${network.creditHoldHours ? `in ${network.creditHoldHours} hours` : 'now'}.`,
      link: `/account/airtime/sales/${id}`,
      mode: done.mode,
    });
    if (network.creditHoldHours === 0) await this.credit(id);
    return done;
  }

  /** The seller's airtime never came (staff checked the line): nothing is owed. */
  async notReceived(id: string, adminId: string | null, reason: string) {
    const sale = await this.prisma.airtimeSale.findUnique({ where: { id } });
    if (!sale) throw saleMissing();
    const claimed = await this.prisma.airtimeSale.updateMany({
      where: { id, status: { in: ['awaiting_transfer', 'sent'] } },
      data: { status: 'not_received', decidedBy: adminId, note: reason, ...(sale.sentAt ? { struckAt: new Date() } : {}) },
    });
    if (!claimed.count) throw conflict('sale_closed', `This sale is already ${sale.status.replaceAll('_', ' ')}.`);
    if (sale.sentAt) await this.afterStrike(sale);
    if (adminId) await this.audit.record({ actorId: adminId, action: 'airtime.sale_not_received', targetType: 'airtime_sale', targetId: id, before: { status: sale.status }, after: { status: 'not_received', reason } });
    await this.inbox.customer({ customerId: sale.customerId, storeId: sale.storeId }, 'customer.airtime.sale_failed', {
      subject: `${id}:failed`,
      title: 'We did not receive your airtime',
      body: `${saleNumber(sale.number)}: ${reason}`,
      link: `/account/airtime/sales/${id}`,
      mode: sale.mode,
    });
    return this.prisma.airtimeSale.findUniqueOrThrow({ where: { id } });
  }

  /** The hold has passed: the seller's wallet is credited (once). */
  async credit(id: string) {
    const sale = await this.prisma.airtimeSale.findUnique({ where: { id } });
    if (!sale || sale.status !== 'received') return null;
    const entry = await this.ledger.prepare({
      mode: sale.mode,
      type: 'airtime_sale',
      reference: `airtime_sale:${id}:credited`,
      description: `Airtime sold (${saleNumber(sale.number)})`,
      metadata: { airtime_sale_id: id },
      lines: [
        { account: { kind: 'airtime_payable', currency: sale.currency }, debit: sale.payoutMinor },
        { account: { kind: 'customer_wallet', currency: sale.currency, customerId: sale.customerId }, credit: sale.payoutMinor },
      ],
    });
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.airtimeSale.updateMany({ where: { id, status: 'received' }, data: { status: 'credited', creditedAt: new Date() } });
      if (!claimed.count) return null;
      await this.ledger.write(tx, entry);
      return tx.airtimeSale.findUniqueOrThrow({ where: { id } });
    });
    if (!done) return null;
    await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.airtime.sale_credited', {
      subject: `${id}:credited`,
      title: `${formatMoney(done.payoutMinor, done.currency)} added to your wallet`,
      body: `For the airtime you sold (${saleNumber(done.number)}).`,
      link: `/account/airtime/sales/${id}`,
      mode: done.mode,
    });
    return done;
  }

  /**
   * The network reversed a transfer before its hold passed (a stolen line reported, say): the airtime leaves the pool
   * and nothing is credited. Refused while the pool has promised the airtime to buyers.
   */
  async reverse(id: string, adminId: string, reason: string) {
    const sale = await this.prisma.airtimeSale.findUnique({ where: { id } });
    if (!sale) throw saleMissing();
    if (sale.status !== 'received') throw conflict('sale_not_reversible', 'Only airtime received and not yet paid to the seller can be reversed.');
    const network = await this.network(sale.country, sale.network);
    const entry = await this.ledger.prepare({
      mode: sale.mode,
      type: 'airtime_reversed',
      reference: `airtime_sale:${id}:reversed`,
      description: `${network.name} airtime reversed (${saleNumber(sale.number)})`,
      metadata: { airtime_sale_id: id, reason },
      lines: [
        { account: { kind: 'airtime_payable', currency: sale.currency }, debit: sale.payoutMinor },
        { account: this.inventory(network), credit: sale.payoutMinor },
      ],
    });
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.airtimeSale.updateMany({ where: { id, status: 'received' }, data: { status: 'reversed', decidedBy: adminId, note: reason, struckAt: new Date() } });
      if (!claimed.count) throw conflict('sale_not_reversible', 'This sale was already decided.');
      const left = await tx.$executeRaw`
        UPDATE airtime_pools SET available_minor = available_minor - ${sale.amountMinor}, cost_minor = cost_minor - ${sale.payoutMinor},
          bought_minor = bought_minor - ${sale.amountMinor}, updated_at = NOW()
        WHERE mode = ${sale.mode}::"LedgerMode" AND country = ${sale.country} AND network = ${sale.network}
          AND available_minor - ${sale.amountMinor} >= reserved_minor AND cost_minor >= ${sale.payoutMinor}`;
      if (!left) throw conflict('pool_reserved', 'This airtime is already promised to buyers. Refund or send their purchases first.');
      if (sale.mode === 'live') await tx.airtimeCollectorLine.update({ where: { id: sale.lineId }, data: { balanceMinor: { decrement: sale.amountMinor } } });
      await this.ledger.write(tx, entry);
    });
    await this.audit.record({ actorId: adminId, action: 'airtime.sale_reversed', targetType: 'airtime_sale', targetId: id, before: { status: 'received' }, after: { status: 'reversed', reason } });
    await this.afterStrike(sale);
    await this.inbox.customer({ customerId: sale.customerId, storeId: sale.storeId }, 'customer.airtime.sale_failed', {
      subject: `${id}:reversed`,
      title: 'Your airtime sale was reversed',
      body: `${saleNumber(sale.number)}: the network took the airtime back, so nothing is paid. ${reason}`,
      link: `/account/airtime/sales/${id}`,
      mode: sale.mode,
    });
    return this.prisma.airtimeSale.findUniqueOrThrow({ where: { id } });
  }

  /** Staff take a purchase to send it from a line (so the hour's refund leaves it alone). */
  async claim(id: string, adminId: string, lineId: string) {
    const purchase = await this.prisma.airtimePurchase.findUnique({ where: { id } });
    if (!purchase) throw purchaseMissing();
    const line = await this.prisma.airtimeCollectorLine.findUnique({ where: { id: lineId } });
    if (!line || line.country !== purchase.country || line.network !== purchase.network || !line.active) throw invalid('line_invalid', 'Choose an active line on the same network.', 'line_id');
    const claimed = await this.prisma.$transaction(async tx => {
      if (purchase.mode === 'live') {
        await this.rollDay(tx, line);
        const fresh = await tx.airtimeCollectorLine.findUniqueOrThrow({ where: { id: lineId } });
        if (fresh.balanceMinor < purchase.amountMinor) throw conflict('line_short', `${fresh.number} holds only ${formatMoney(fresh.balanceMinor, purchase.currency)}. Choose another line.`, 'line_id');
        if (fresh.sentTodayMinor + purchase.amountMinor > fresh.dailySendMinor) throw conflict('line_limit', `${fresh.number} cannot send that much more today. Choose another line.`, 'line_id');
      }
      return tx.airtimePurchase.updateMany({ where: { id, status: 'paid' }, data: { status: 'delivering', lineId, claimedAt: new Date(), decidedBy: adminId } });
    });
    if (!claimed.count) throw conflict('purchase_closed', `This purchase is already ${purchase.status}.`);
    await this.audit.record({ actorId: adminId, action: 'airtime.purchase_claimed', targetType: 'airtime_purchase', targetId: id, after: { line: line.number } });
    return this.prisma.airtimePurchase.findUniqueOrThrow({ where: { id } });
  }

  /**
   * The airtime was sent to the buyer: it leaves the pool at the pool's average cost, the locked price goes to that
   * cost (out of inventory) and BitoCard's margin (platform revenue). Live purchases count on the line's day.
   */
  async deliver(id: string, adminId: string | null, lineId: string | null) {
    const purchase = await this.prisma.airtimePurchase.findUnique({ where: { id } });
    if (!purchase) throw purchaseMissing();
    if (!['paid', 'delivering'].includes(purchase.status)) throw conflict('purchase_closed', `This purchase is already ${purchase.status}.`);
    const network = await this.network(purchase.country, purchase.network);
    const line = lineId ?? purchase.lineId;
    if (purchase.mode === 'live' && !line) throw invalid('line_required', 'Say which line the airtime was sent from.', 'line_id');
    const [locked, inventory, revenue] = await Promise.all([
      this.ledger.accountId(purchase.mode, { kind: 'customer_wallet_locked', currency: purchase.currency, customerId: purchase.customerId }),
      this.ledger.accountId(purchase.mode, this.inventory(network)),
      this.ledger.accountId(purchase.mode, { kind: 'platform_revenue', currency: purchase.currency }),
    ]);
    const done = await this.prisma.$transaction(async tx => {
      const pools = await tx.$queryRaw<Array<{ available_minor: bigint; cost_minor: bigint }>>`
        SELECT available_minor, cost_minor FROM airtime_pools
        WHERE mode = ${purchase.mode}::"LedgerMode" AND country = ${purchase.country} AND network = ${purchase.network} FOR UPDATE`;
      const pool = pools[0];
      if (!pool) throw conflict('pool_short', 'The pool has no airtime on this network.');
      const available = BigInt(pool.available_minor);
      const cost = available > 0n ? (BigInt(pool.cost_minor) * purchase.amountMinor) / available : 0n;
      const claimed = await tx.airtimePurchase.updateMany({
        where: { id, status: { in: ['paid', 'delivering'] } },
        data: { status: 'delivered', deliveredAt: new Date(), costMinor: cost, lineId: line, decidedBy: adminId ?? purchase.decidedBy },
      });
      if (!claimed.count) return null;
      await tx.airtimePool.update({
        where: { mode_country_network: { mode: purchase.mode, country: purchase.country, network: purchase.network } },
        data: { availableMinor: { decrement: purchase.amountMinor }, reservedMinor: { decrement: purchase.amountMinor }, costMinor: { decrement: cost }, soldMinor: { increment: purchase.amountMinor } },
      });
      if (purchase.mode === 'live' && line) {
        await this.rollDay(tx, purchase);
        await tx.airtimeCollectorLine.update({ where: { id: line }, data: { sentTodayMinor: { increment: purchase.amountMinor }, balanceMinor: { decrement: purchase.amountMinor } } });
      }
      const margin = purchase.priceMinor - cost;
      const entry: PreparedEntry = {
        mode: purchase.mode,
        type: 'airtime_delivered',
        reference: `airtime_purchase:${id}:delivered`,
        description: `${network.name} airtime sent (${purchaseNumber(purchase.number)})`,
        metadata: { airtime_purchase_id: id, cost: String(cost) },
        postings: [
          { accountId: locked, kind: 'customer_wallet_locked', amount: purchase.priceMinor },
          ...(cost > 0n ? [{ accountId: inventory, kind: 'airtime_inventory' as const, amount: -cost }] : []),
          ...(margin !== 0n ? [{ accountId: revenue, kind: 'platform_revenue' as const, amount: -margin }] : []),
        ],
      };
      await this.ledger.write(tx, entry);
      return tx.airtimePurchase.findUniqueOrThrow({ where: { id } });
    });
    if (!done) throw conflict('purchase_closed', 'This purchase was already decided.');
    if (adminId) await this.audit.record({ actorId: adminId, action: 'airtime.purchase_delivered', targetType: 'airtime_purchase', targetId: id, after: { status: 'delivered', cost: String(done.costMinor) } });
    await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.airtime.purchase_delivered', {
      subject: `${id}:delivered`,
      title: `${formatMoney(done.amountMinor, done.currency)} of ${network.name} airtime sent`,
      body: `To ${done.phone} (${purchaseNumber(done.number)}).`,
      link: `/account/airtime/purchases/${id}`,
      mode: done.mode,
    });
    return done;
  }

  /** Not sent within the hour, or staff could not send it: the price goes back to the buyer's wallet and the pool frees it. */
  async refund(id: string, adminId: string | null, reason: string, { onlyUnclaimed = false } = {}) {
    const purchase = await this.prisma.airtimePurchase.findUnique({ where: { id } });
    if (!purchase) throw purchaseMissing();
    const entry = await this.ledger.prepare({
      mode: purchase.mode,
      type: 'airtime_refund',
      reference: `airtime_purchase:${id}:refunded`,
      description: `Airtime purchase refunded (${purchaseNumber(purchase.number)})`,
      metadata: { airtime_purchase_id: id, reason },
      lines: [
        { account: { kind: 'customer_wallet_locked', currency: purchase.currency, customerId: purchase.customerId }, debit: purchase.priceMinor },
        { account: { kind: 'customer_wallet', currency: purchase.currency, customerId: purchase.customerId }, credit: purchase.priceMinor },
      ],
    });
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.airtimePurchase.updateMany({
        where: { id, status: { in: onlyUnclaimed ? ['paid'] : ['paid', 'delivering'] } },
        data: { status: 'refunded', refundedAt: new Date(), decidedBy: adminId ?? purchase.decidedBy, note: reason },
      });
      if (!claimed.count) return null;
      await tx.airtimePool.update({
        where: { mode_country_network: { mode: purchase.mode, country: purchase.country, network: purchase.network } },
        data: { reservedMinor: { decrement: purchase.amountMinor } },
      });
      await this.ledger.write(tx, entry);
      return tx.airtimePurchase.findUniqueOrThrow({ where: { id } });
    });
    if (!done) {
      if (onlyUnclaimed) return null;
      throw conflict('purchase_closed', `This purchase is already ${purchase.status}.`);
    }
    if (adminId) await this.audit.record({ actorId: adminId, action: 'airtime.purchase_refunded', targetType: 'airtime_purchase', targetId: id, after: { status: 'refunded', reason } });
    await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.airtime.purchase_refunded', {
      subject: `${id}:refunded`,
      title: `${formatMoney(done.priceMinor, done.currency)} back in your wallet`,
      body: `${purchaseNumber(done.number)}: ${reason}`,
      link: `/account/airtime/purchases/${id}`,
      mode: done.mode,
    });
    return done;
  }

  /**
   * Every 5 minutes: sales never sent in their hour expire; purchases nobody took to send in their hour are refunded;
   * sellers' credits past their hold are paid; sales said sent but not checked in their hour, and purchases being
   * sent past it, are flagged to operations once.
   */
  async job() {
    const now = new Date();
    const expired = await this.prisma.airtimeSale.updateMany({ where: { status: 'awaiting_transfer', expiresAt: { lte: now } }, data: { status: 'expired' } });
    let refunded = 0;
    for (const purchase of await this.prisma.airtimePurchase.findMany({ where: { status: 'paid', expiresAt: { lte: now } }, take: 100 })) {
      if (await this.refund(purchase.id, null, 'It could not be sent within the hour, so your money is back.', { onlyUnclaimed: true })) refunded += 1;
    }
    let credited = 0;
    for (const sale of await this.prisma.airtimeSale.findMany({ where: { status: 'received', creditAt: { lte: now } }, take: 200 })) {
      try {
        if (await this.credit(sale.id)) credited += 1;
      } catch (error) {
        this.logger.error({ err: error, sale: sale.id }, 'Airtime sale could not be credited');
      }
    }
    const overdue = await this.prisma.airtimeSale.findMany({ where: { status: 'sent', expiresAt: { lte: now }, overdueAlertedAt: null }, take: 50 });
    for (const sale of overdue) {
      const claimed = await this.prisma.airtimeSale.updateMany({ where: { id: sale.id, overdueAlertedAt: null }, data: { overdueAlertedAt: now } });
      if (!claimed.count) continue;
      await this.inbox.admins('admin.airtime.overdue', {
        subject: sale.id,
        title: `${saleNumber(sale.number)} is past its hour`,
        body: `The seller says they sent ${formatMoney(sale.amountMinor, sale.currency)}: mark it received or not received.`,
        link: '/orders/airtime?tab=sales',
        mode: sale.mode,
      });
    }
    // Taken to send but still not sent past the hour (the inbox tells each admin once per purchase).
    const stalled = await this.prisma.airtimePurchase.findMany({ where: { status: 'delivering', expiresAt: { lte: now, gt: new Date(now.getTime() - dayMs) } }, take: 50 });
    for (const purchase of stalled) {
      await this.inbox.admins('admin.airtime.overdue', {
        subject: `${purchase.id}:delivering`,
        title: `${purchaseNumber(purchase.number)} is past its hour`,
        body: `${formatMoney(purchase.amountMinor, purchase.currency)} to ${purchase.phone} was taken to send: mark it sent, or refund it.`,
        link: '/orders/airtime?tab=purchases',
        mode: purchase.mode,
      });
    }
    return { expired: expired.count, refunded, credited, overdue: overdue.length + stalled.length };
  }

  // Admins.

  async adminOverview() {
    const [mode, networks, lines, pools] = await Promise.all([
      this.mode(),
      this.prisma.airtimeNetwork.findMany({ orderBy: [{ country: 'asc' }, { position: 'asc' }] }),
      this.prisma.airtimeCollectorLine.findMany({ orderBy: [{ network: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.airtimePool.findMany(),
    ]);
    const countries = [...new Set(networks.map(network => network.country))];
    const open = Object.fromEntries(await Promise.all(countries.map(async country => [country, await this.settings.isOnForCountry('airtime_exchange', country)] as const)));
    const today = new Date().toISOString().slice(0, 10);
    return {
      object: 'airtime_overview' as const,
      mode,
      open,
      networks: networks.map(network => ({
        country: network.country,
        network: network.network,
        name: network.name,
        currency: network.currency,
        enabled: network.enabled,
        sell_rate_bps: network.sellRateBps,
        buy_rate_bps: network.buyRateBps,
        min_amount: num(network.minAmountMinor),
        max_amount: num(network.maxAmountMinor),
        seller_daily: num(network.sellerDailyMinor),
        new_seller_daily: num(network.newSellerDailyMinor),
        established_after: network.establishedAfter,
        credit_hold_hours: network.creditHoldHours,
        transfer_steps: network.transferSteps,
        pools: pools
          .filter(pool => pool.country === network.country && pool.network === network.network)
          .map(pool => ({ mode: pool.mode, available: num(pool.availableMinor), reserved: num(pool.reservedMinor), cost: num(pool.costMinor), bought_total: num(pool.boughtMinor), sold_total: num(pool.soldMinor) })),
      })),
      lines: lines.map(line => this.presentLine(line, today)),
    };
  }

  private presentLine(line: AirtimeCollectorLine, today: string) {
    const fresh = line.counterDay.toISOString().slice(0, 10) === today;
    return {
      object: 'airtime_line' as const,
      id: line.id,
      country: line.country,
      network: line.network,
      number: line.number,
      label: line.label,
      active: line.active,
      daily_receive: num(line.dailyReceiveMinor),
      daily_send: num(line.dailySendMinor),
      received_today: fresh ? num(line.receivedTodayMinor) : 0,
      sent_today: fresh ? num(line.sentTodayMinor) : 0,
      balance: num(line.balanceMinor),
    };
  }

  async updateNetwork(adminId: string, country: string, networkKey: string, input: { sell_rate_bps?: number; buy_rate_bps?: number; min_amount?: number; max_amount?: number; seller_daily?: number; new_seller_daily?: number; established_after?: number; credit_hold_hours?: number; transfer_steps?: string; enabled?: boolean }) {
    const before = await this.network(country.toUpperCase(), networkKey);
    const sell = input.sell_rate_bps ?? before.sellRateBps;
    const buy = input.buy_rate_bps ?? before.buyRateBps;
    if (sell >= buy) throw invalid('rates_invalid', 'Sellers must get less than buyers pay.', 'sell_rate_bps');
    const min = input.min_amount !== undefined ? BigInt(input.min_amount) : before.minAmountMinor;
    const max = input.max_amount !== undefined ? BigInt(input.max_amount) : before.maxAmountMinor;
    if (max < min) throw invalid('amounts_invalid', 'The most must be at least the least.', 'max_amount');
    const sellerDaily = input.seller_daily !== undefined ? BigInt(input.seller_daily) : before.sellerDailyMinor;
    const newDaily = input.new_seller_daily !== undefined ? BigInt(input.new_seller_daily) : before.newSellerDailyMinor;
    if (sellerDaily < min) throw invalid('amounts_invalid', 'A seller\'s daily limit must be at least the least a trade.', 'seller_daily');
    if (newDaily < min || newDaily > sellerDaily) throw invalid('amounts_invalid', 'A new seller\'s daily limit must be between the least a trade and every seller\'s daily limit.', 'new_seller_daily');
    const after = await this.prisma.airtimeNetwork.update({
      where: { country_network: { country: before.country, network: before.network } },
      data: {
        sellRateBps: sell,
        buyRateBps: buy,
        minAmountMinor: min,
        maxAmountMinor: max,
        sellerDailyMinor: sellerDaily,
        newSellerDailyMinor: newDaily,
        ...(input.established_after !== undefined ? { establishedAfter: input.established_after } : {}),
        ...(input.credit_hold_hours !== undefined ? { creditHoldHours: input.credit_hold_hours } : {}),
        ...(input.transfer_steps !== undefined ? { transferSteps: input.transfer_steps } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    const plain = (n: AirtimeNetwork) => ({ sell_rate_bps: n.sellRateBps, buy_rate_bps: n.buyRateBps, min: String(n.minAmountMinor), max: String(n.maxAmountMinor), seller_daily: String(n.sellerDailyMinor), new_seller_daily: String(n.newSellerDailyMinor), established_after: n.establishedAfter, hold: n.creditHoldHours, enabled: n.enabled });
    await this.audit.record({ actorId: adminId, action: 'airtime.network_changed', targetType: 'airtime_network', targetId: `${after.country}:${after.network}`, before: plain(before), after: plain(after) });
    return this.adminOverview();
  }

  async addLine(adminId: string, input: { country: string; network: string; number: string; label?: string; daily_receive?: number; daily_send?: number }) {
    const network = await this.network(input.country.toUpperCase(), input.network);
    const number = normalisePhone(input.number, network.country);
    if (await this.prisma.airtimeCollectorLine.findUnique({ where: { number } })) throw conflict('line_exists', 'This number is already a collector line.', 'number');
    const line = await this.prisma.airtimeCollectorLine.create({
      data: {
        country: network.country,
        network: network.network,
        number,
        label: input.label?.trim() || null,
        ...(input.daily_receive !== undefined ? { dailyReceiveMinor: BigInt(input.daily_receive) } : {}),
        ...(input.daily_send !== undefined ? { dailySendMinor: BigInt(input.daily_send) } : {}),
      },
    });
    await this.audit.record({ actorId: adminId, action: 'airtime.line_added', targetType: 'airtime_line', targetId: line.id, after: { network: line.network, number } });
    return this.presentLine(line, new Date().toISOString().slice(0, 10));
  }

  /** Changes a line: on or off, its limits, or its balance as counted on the phone (reconciliation, with a reason). */
  async updateLine(adminId: string, id: string, input: { active?: boolean; label?: string | null; daily_receive?: number; daily_send?: number; balance?: number; reason?: string }) {
    const before = await this.prisma.airtimeCollectorLine.findUnique({ where: { id } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such line.');
    if (input.balance !== undefined && !input.reason?.trim()) throw invalid('reason_required', 'Say why the balance changed.', 'reason');
    const after = await this.prisma.airtimeCollectorLine.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
        ...(input.daily_receive !== undefined ? { dailyReceiveMinor: BigInt(input.daily_receive) } : {}),
        ...(input.daily_send !== undefined ? { dailySendMinor: BigInt(input.daily_send) } : {}),
        ...(input.balance !== undefined ? { balanceMinor: BigInt(input.balance) } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'airtime.line_changed',
      targetType: 'airtime_line',
      targetId: id,
      before: { active: before.active, daily_receive: String(before.dailyReceiveMinor), daily_send: String(before.dailySendMinor), balance: String(before.balanceMinor) },
      after: { active: after.active, daily_receive: String(after.dailyReceiveMinor), daily_send: String(after.dailySendMinor), balance: String(after.balanceMinor), reason: input.reason ?? null },
    });
    return this.presentLine(after, new Date().toISOString().slice(0, 10));
  }

  async adminSales(filter: { status?: string; mode?: LedgerMode }) {
    const sales = await this.prisma.airtimeSale.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.mode ? { mode: filter.mode } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { line: true, customer: { select: { id: true, name: true, email: true } } },
    });
    const standings = new Map(await Promise.all([...new Set(sales.map(sale => sale.customerId))].map(async id => [id, this.plainStanding(await this.standing(id))] as const)));
    return {
      object: 'list' as const,
      data: sales.map(sale => ({ ...this.presentSale(sale), customer: sale.customer, seller: standings.get(sale.customerId)!, line: { id: sale.line.id, number: sale.line.number } })),
    };
  }

  async adminPurchases(filter: { status?: string; mode?: LedgerMode }) {
    const purchases = await this.prisma.airtimePurchase.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.mode ? { mode: filter.mode } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { line: true, customer: { select: { id: true, name: true, email: true } } },
    });
    return {
      object: 'list' as const,
      data: purchases.map(purchase => ({ ...this.presentPurchase(purchase), cost: num(purchase.costMinor), customer: purchase.customer, line: purchase.line ? { id: purchase.line.id, number: purchase.line.number } : null })),
    };
  }

  // Presenting.

  presentSale(sale: AirtimeSale & { line?: AirtimeCollectorLine }, { network }: { network?: AirtimeNetwork } = {}) {
    const waiting = sale.status === 'awaiting_transfer';
    return {
      object: 'airtime_sale' as const,
      id: sale.id,
      number: saleNumber(sale.number),
      mode: sale.mode,
      network: sale.network,
      amount: num(sale.amountMinor),
      currency: sale.currency,
      rate_bps: sale.rateBps,
      payout: num(sale.payoutMinor),
      from_phone: sale.fromPhone,
      status: sale.status,
      /** Where to send it, and how, while the seller still has to. */
      collector_number: waiting || sale.status === 'sent' ? (sale.line?.number ?? null) : null,
      transfer_steps: waiting && sale.line && network ? transferSteps(network.transferSteps, sale.line.number, sale.amountMinor) : null,
      expires_at: sale.expiresAt.toISOString(),
      sent_at: sale.sentAt?.toISOString() ?? null,
      received_at: sale.receivedAt?.toISOString() ?? null,
      credit_at: sale.creditAt?.toISOString() ?? null,
      credited_at: sale.creditedAt?.toISOString() ?? null,
      note: ['not_received', 'reversed'].includes(sale.status) ? sale.note : null,
      created_at: sale.createdAt.toISOString(),
    };
  }

  presentPurchase(purchase: AirtimePurchase) {
    return {
      object: 'airtime_purchase' as const,
      id: purchase.id,
      number: purchaseNumber(purchase.number),
      mode: purchase.mode,
      network: purchase.network,
      phone: purchase.phone,
      amount: num(purchase.amountMinor),
      currency: purchase.currency,
      rate_bps: purchase.rateBps,
      price: num(purchase.priceMinor),
      status: purchase.status,
      expires_at: purchase.expiresAt.toISOString(),
      delivered_at: purchase.deliveredAt?.toISOString() ?? null,
      refunded_at: purchase.refundedAt?.toISOString() ?? null,
      note: purchase.status === 'refunded' ? purchase.note : null,
      created_at: purchase.createdAt.toISOString(),
    };
  }
}
