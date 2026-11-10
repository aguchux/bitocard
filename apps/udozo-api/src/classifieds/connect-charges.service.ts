import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerService, type Line } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { centreShareOf } from './connect-checkout.service.js';

const dayMs = 86_400_000;
/** At most this many days are charged per order and run, so a long-forgotten item never stalls the job. */
const maxDaysPerRun = 120;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');

type Rates = { demurrageBps: number; locPenaltyBps: number; locPenaltyCapMinor: bigint; centreShareBps: number };

/** A day's demurrage on this shipping charge (rounded to the nearest unit). */
export const demurrageOf = (shippingMinor: bigint, bps: number) => (shippingMinor * BigInt(bps) + 5000n) / 10000n;
/** A day's Loss of care penalty: a share of the shipping charge, capped per day. */
export const penaltyOf = (shippingMinor: bigint, bps: number, capMinor: bigint) => {
  const raw = (shippingMinor * BigInt(bps) + 5000n) / 10000n;
  return raw < capMinor ? raw : capMinor;
};
/** The UTC day a period starting at `at` is charged on. */
const dayOf = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * Storage charges at Connect Centres (docs/UDOZO_CONNECT_PLAN.md, Holding times, demurrage and Loss of care). Each full day
 * an item stays past its free time is charged once (`connect_charges`, unique per order, payer, kind and day): the
 * buyer's **demurrage** after their free hours to collect, paid from their wallet before the centre accepts their code
 * (or taken out of their refund when the item goes back unclaimed); the seller's demurrage once their free days to
 * collect a return run out, when the item goes into **Loss of care** (the centre no longer liable for it) with a daily
 * **penalty** too, capped. The seller's are taken as they fall due from their Udozo money, else their wallet, else owed
 * (and Connect is not offered on their listings until they are paid). Every charge paid is shared between the centre
 * (its partner's earnings) and Udozo, as its own ledger entry (`connect_charge:<id>`), so nothing is charged twice.
 */
@Injectable()
export class ConnectChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
  ) {}

  async rates(country: string): Promise<Rates> {
    const row = await this.prisma.connectSettings.findUnique({ where: { country } });
    return { demurrageBps: row?.demurrageBps ?? 210, locPenaltyBps: row?.locPenaltyBps ?? 210, locPenaltyCapMinor: row?.locPenaltyCapMinor ?? 50000n, centreShareBps: row?.centreShareBps ?? 7000 };
  }

  /** The job: each full day past a free time is charged once; the seller's are taken where their money covers them. */
  async accrue(now = new Date()) {
    let buyer = 0;
    let seller = 0;
    let lossOfCare = 0;
    // The buyer's: items ready at the centre past their free time to collect.
    const waiting = await this.prisma.classifiedOrder.findMany({ where: { fulfilment: 'connect', status: 'at_centre', collectBy: { lt: now } }, select: { id: true, country: true, currency: true, deliveryFeeMinor: true, collectBy: true }, take: 500 });
    for (const order of waiting) {
      const rates = await this.rates(order.country);
      buyer += await this.charge(order.id, 'buyer', 'demurrage', order.collectBy!, now, demurrageOf(order.deliveryFeeMinor, rates.demurrageBps), order.currency);
    }
    // The seller's: accepted returns past their free days to collect (Loss of care from then on).
    const returns = await this.prisma.connectReturnRequest.findMany({
      where: { status: 'accepted', collectBy: { lt: now } },
      include: { order: { select: { id: true, number: true, country: true, currency: true, deliveryFeeMinor: true, sellerId: true, seller: { select: { id: true, storeId: true } }, listing: { select: { title: true } } } }, centre: { select: { id: true, name: true } } },
      take: 500,
    });
    for (const row of returns) {
      const rates = await this.rates(row.order.country);
      const start = row.collectBy!;
      seller += await this.charge(row.order.id, 'seller', 'demurrage', start, now, demurrageOf(row.order.deliveryFeeMinor, rates.demurrageBps), row.order.currency);
      seller += await this.charge(row.order.id, 'seller', 'loc_penalty', start, now, penaltyOf(row.order.deliveryFeeMinor, rates.locPenaltyBps, rates.locPenaltyCapMinor), row.order.currency);
      const entered = await this.prisma.connectReturnRequest.updateMany({ where: { id: row.id, lossOfCareAt: null }, data: { lossOfCareAt: start } });
      if (entered.count) {
        lossOfCare += 1;
        const title = `"${row.order.listing.title}" is in Loss of care`;
        const body = `It was not collected within the free days. ${row.centre.name} keeps it safe but is no longer liable for it; storage and a daily penalty are charged until you collect it.`;
        await this.inbox.customer({ customerId: row.order.seller.id, storeId: row.order.seller.storeId }, 'customer.connect.return', { subject: `loss_of_care:${row.id}`, title, body, link: `/account/orders/${row.order.id}` }).catch(() => undefined);
        await this.inbox.admins('admin.connect.return', { subject: `loss_of_care:${row.id}`, title: `SP-${row.order.number} is in Loss of care`, body: `At ${row.centre.name}.`, link: '/connect/returns' });
      }
      await this.collectSeller(row.order.id);
    }
    return { buyer_days: buyer, seller_days: seller, loss_of_care: lossOfCare };
  }

  /** Charges each full day from `start` to `now` not yet charged (`createMany` skips the days already there). */
  private async charge(orderId: string, payer: 'buyer' | 'seller', kind: 'demurrage' | 'loc_penalty', start: Date, now: Date, amount: bigint, currency: string) {
    const days = Math.min(Math.floor((now.getTime() - start.getTime()) / dayMs), maxDaysPerRun);
    if (days <= 0 || amount <= 0n) return 0;
    const rows = Array.from({ length: days }, (_, index) => ({ orderId, payer, kind, day: dayOf(new Date(start.getTime() + index * dayMs)), amountMinor: amount, currency }));
    const made = await this.prisma.connectCharge.createMany({ data: rows, skipDuplicates: true });
    return made.count;
  }

  /** What is owed on an order by one side (charged days not yet paid), with the charges. */
  async owed(orderId: string, payer: 'buyer' | 'seller') {
    const rows = await this.prisma.connectCharge.findMany({ where: { orderId, payer, status: 'owed' }, orderBy: { day: 'asc' } });
    return { rows, total: rows.reduce((sum, row) => sum + row.amountMinor, 0n) };
  }

  /** Whether a seller still owes storage on any Connect item (Connect is not offered on their listings until they pay). */
  async sellerOwes(sellerId: string) {
    return (await this.prisma.connectCharge.count({ where: { payer: 'seller', status: 'owed', order: { sellerId } } })) > 0;
  }

  /** The ledger lines that share a paid charge between the centre's partner and Udozo. */
  shareLines(amount: bigint, currency: string, partnerId: string, shareBps: number): Line[] {
    const centre = centreShareOf(amount, shareBps);
    return [
      ...(centre > 0n ? [{ account: { kind: 'connect_centre_earnings' as const, currency, customerId: partnerId }, credit: centre }] : []),
      ...(amount - centre > 0n ? [{ account: { kind: 'connect_revenue' as const, currency }, credit: amount - centre }] : []),
    ];
  }

  /** Takes the seller's owed charges, one by one, from their Udozo money, else their wallet; what neither covers stays owed. */
  async collectSeller(orderId: string) {
    const order = await this.prisma.classifiedOrder.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, mode: true, country: true, currency: true, sellerId: true, connectWithUdozoAt: true, connectCentre: { select: { partnerId: true } } } });
    const { rows } = await this.owed(orderId, 'seller');
    // Days after the centre handed it to Udozo's pickup are Udozo's alone.
    const udozoFrom = order.connectWithUdozoAt ? new Date(`${order.connectWithUdozoAt.toISOString().slice(0, 10)}T00:00:00.000Z`) : null;
    if (!rows.length || !order.connectCentre) return 0n;
    const rates = await this.rates(order.country);
    let paid = 0n;
    for (const row of rows) {
      const balance = async (kind: 'customer_withdrawable' | 'customer_wallet') =>
        (await this.prisma.ledgerAccount.findFirst({ where: { kind, mode: order.mode, currency: order.currency, customerId: order.sellerId } }))?.balanceMinor ?? 0n;
      const source = (await balance('customer_withdrawable')) >= row.amountMinor ? 'customer_withdrawable' : (await balance('customer_wallet')) >= row.amountMinor ? 'customer_wallet' : null;
      if (!source) break;
      const shareBps = udozoFrom && row.day >= udozoFrom ? 0 : rates.centreShareBps;
      const ok = await this.pay(row, order.mode, [{ account: { kind: source, currency: order.currency, customerId: order.sellerId }, debit: row.amountMinor }, ...this.shareLines(row.amountMinor, order.currency, order.connectCentre.partnerId, shareBps)]);
      if (ok) paid += row.amountMinor;
    }
    return paid;
  }

  /** The buyer pays every day's demurrage owed on their order from their wallet, before they collect it. */
  async payBuyer(customer: CustomerWithStore, orderId: string) {
    const order = await this.prisma.classifiedOrder.findUnique({ where: { id: orderId }, select: { id: true, buyerId: true, mode: true, country: true, currency: true, connectCentre: { select: { partnerId: true } } } });
    if (!order || order.buyerId !== customer.id || !order.connectCentre) throw notFound();
    const { rows, total } = await this.owed(orderId, 'buyer');
    if (!rows.length) return { object: 'connect_charges' as const, order_id: orderId, owed: 0, paid: 0 };
    const wallet = (await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', mode: order.mode, currency: order.currency, customerId: customer.id } }))?.balanceMinor ?? 0n;
    if (wallet < total) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', 'Add money to your Udozo wallet to pay the storage first.');
    const rates = await this.rates(order.country);
    let paid = 0n;
    for (const row of rows) {
      const ok = await this.pay(row, order.mode, [{ account: { kind: 'customer_wallet', currency: order.currency, customerId: customer.id }, debit: row.amountMinor }, ...this.shareLines(row.amountMinor, order.currency, order.connectCentre.partnerId, rates.centreShareBps)]);
      if (ok) paid += row.amountMinor;
    }
    return { object: 'connect_charges' as const, order_id: orderId, owed: Number(total - paid), paid: Number(paid) };
  }

  /** One charge paid, once: claimed from owed in the same transaction as its entry. */
  private async pay(row: { id: string; orderId: string }, mode: Parameters<LedgerService['prepare']>[0]['mode'], lines: Line[]) {
    const entry = await this.ledger.prepare({ mode, type: 'connect_charge', reference: `connect_charge:${row.id}`, description: 'Udozo Connect storage', lines });
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.connectCharge.updateMany({ where: { id: row.id, status: 'owed' }, data: { status: 'paid', paidAt: new Date() } });
        if (!claimed.count) throw new Error('charge_claimed');
        await this.ledger.write(tx, entry);
      });
      return true;
    } catch (error) {
      if (error instanceof Error && (error.message === 'charge_claimed' || (error instanceof ApiError && error.code === 'insufficient_funds'))) return false;
      throw error;
    }
  }

  /** Marks the buyer's owed demurrage paid out of their refund (an item they never collected), in that refund's transaction. */
  async settleFromRefund(tx: Prisma.TransactionClient, ids: string[]) {
    if (ids.length) await tx.connectCharge.updateMany({ where: { id: { in: ids }, status: 'owed' }, data: { status: 'paid', paidAt: new Date() } });
  }

  /** What each side owes on an order now, for its pages. */
  async summary(orderId: string) {
    const rows = await this.prisma.connectCharge.groupBy({ by: ['payer', 'status'], where: { orderId }, _sum: { amountMinor: true } });
    const sum = (payer: string, status: string) => Number(rows.find(row => row.payer === payer && row.status === status)?._sum.amountMinor ?? 0n);
    return { buyer_owed: sum('buyer', 'owed'), buyer_paid: sum('buyer', 'paid'), seller_owed: sum('seller', 'owed'), seller_paid: sum('seller', 'paid') };
  }
}
