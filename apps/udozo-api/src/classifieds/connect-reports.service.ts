import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { atCentreWhere, heldWhere } from './connect-stock.service.js';

const dayMs = 86_400_000;
const minor = (value: bigint | null | undefined) => Number(value ?? 0n);
const orderNumber = (number: bigint | number) => `SP-${number}`;
const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;
/** An item sent to a centre and not checked in after this many days is late. */
export const lateArrivalDays = 7;
/** A centre is flagged when at least this share of its items were never collected, from this many tries. */
export const uncollectedFlagPct = 20;
export const uncollectedFlagFrom = 5;

/** The share in per cent, to one decimal, or null when nothing was tried. */
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const day = (at: Date) => at.toISOString().slice(0, 10);
/** The ISO week of a day (2026-W46), so an alert is sent at most once a week. */
function isoWeek(at: Date) {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date.getTime() - start.getTime()) / dayMs + 1) / 7)).padStart(2, '0')}`;
}

type Flag = 'over_capacity' | 'overdue_items' | 'missing_items' | 'loss_of_care' | 'late_arrivals' | 'high_uncollected' | 'paused' | 'closed';
const flagOrder: Flag[] = ['missing_items', 'over_capacity', 'high_uncollected', 'loss_of_care', 'late_arrivals', 'overdue_items', 'paused', 'closed'];

/** Counts of a groupBy on the centre, as a map. */
const byCentre = (rows: Array<{ connectCentreId: string | null; _count: { _all: number } }>) => new Map(rows.filter(row => row.connectCentreId).map(row => [row.connectCentreId!, row._count._all]));

/**
 * Udozo Connect's reports and alerts (docs/UDOZO_CONNECT_PLAN.md, phase 6). The report is what every centre holds now
 * (items, those past their free time, missing, in Loss of care, arriving late) and how it did over a period (handed
 * over, never collected, refused), with flags for what needs attention, the money Connect made, and the sellers and
 * buyers behind most refusals and uncollected items. The alerts, run by the `classifieds` job, tell a centre's people
 * when it is full, what is due today and what is past its free time (once a day), each item arriving late (once), and
 * Udozo's team of full centres, late items and centres whose buyers often never come (once a week).
 */
@Injectable()
export class ConnectReportsService {
  private readonly logger = new Logger(ConnectReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  async report(filter: { country?: string; days?: number }, now = new Date()) {
    const days = filter.days ?? 30;
    if (![7, 30, 90, 365].includes(days)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose 7, 30, 90 or 365 days.', 'days');
    const since = new Date(now.getTime() - days * dayMs);
    const country = filter.country ? { country: filter.country.toUpperCase() } : {};
    const connect: Prisma.ClassifiedOrderWhereInput = { fulfilment: 'connect', ...country };
    const lateBefore = new Date(now.getTime() - lateArrivalDays * dayMs);

    const count = (where: Prisma.ClassifiedOrderWhereInput) =>
      this.prisma.classifiedOrder.groupBy({ by: ['connectCentreId'], where: { AND: [connect, where] }, _count: { _all: true } }).then(byCentre);
    const [centres, holding, overdue, missing, late, handedOver, ordered, careRows, returnRows, refusalRows, money, storage] = await Promise.all([
      this.prisma.connectCentre.findMany({ where: country, orderBy: { number: 'asc' }, take: 500, include: { state: { select: { name: true } }, area: { select: { name: true } } } }),
      count(heldWhere),
      count({ status: 'at_centre', collectBy: { lt: now } }),
      count({ AND: [heldWhere, { connectMissingAt: { not: null } }] }),
      count({ status: 'sent', sentAt: { lt: lateBefore }, receivedAt: null }),
      count({ status: 'released', releasedAt: { gte: since } }),
      count({ createdAt: { gte: since } }),
      this.prisma.connectReturnRequest.findMany({ where: { status: 'accepted', lossOfCareAt: { not: null }, order: country }, select: { centreId: true } }),
      this.prisma.connectReturnRequest.findMany({ where: { createdAt: { gte: since }, order: country }, select: { centreId: true, reason: true, status: true, order: { select: { sellerId: true, buyerId: true } } } }),
      this.prisma.classifiedShipmentEvent.findMany({
        where: { reportedBy: 'centre', status: { in: ['refused', 'collection_refused'] }, createdAt: { gte: since }, order: connect },
        take: 5000,
        select: { status: true, order: { select: { connectCentreId: true, sellerId: true, buyerId: true } } },
      }),
      this.prisma.classifiedOrder.groupBy({ by: ['currency'], where: { AND: [connect, { status: 'released', releasedAt: { gte: since } }] }, _sum: { connectFeeMinor: true, centreShareMinor: true } }),
      this.prisma.connectCharge.groupBy({ by: ['currency', 'payer'], where: { status: 'paid', paidAt: { gte: since }, order: country }, _sum: { amountMinor: true } }),
    ]);

    const tally = <T>(rows: T[], key: (row: T) => string | null | undefined) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const k = key(row);
        if (k) map.set(k, (map.get(k) ?? 0) + 1);
      }
      return map;
    };
    const care = tally(careRows, row => row.centreId);
    const notCollected = tally(returnRows.filter(row => row.reason === 'not_collected'), row => row.centreId);
    const refusedIn = tally(refusalRows.filter(row => row.status === 'refused'), row => row.order.connectCentreId);
    const refusedOut = tally(refusalRows.filter(row => row.status === 'collection_refused'), row => row.order.connectCentreId);

    const centreRows = centres.map(centre => {
      const get = (map: Map<string, number>) => map.get(centre.id) ?? 0;
      const tried = get(handedOver) + get(notCollected);
      const uncollected = pct(get(notCollected), tried);
      const flags: Flag[] = [];
      if (get(missing)) flags.push('missing_items');
      if (centre.capacity && get(holding) >= centre.capacity) flags.push('over_capacity');
      if (tried >= uncollectedFlagFrom && uncollected !== null && uncollected >= uncollectedFlagPct) flags.push('high_uncollected');
      if (get(care)) flags.push('loss_of_care');
      if (get(late)) flags.push('late_arrivals');
      if (get(overdue)) flags.push('overdue_items');
      if (centre.status === 'paused') flags.push('paused');
      if (centre.status === 'closed') flags.push('closed');
      return {
        id: centre.id,
        number: centreNumber(centre.number),
        name: centre.name,
        status: centre.status,
        country: centre.country,
        state: centre.state.name,
        area: centre.area.name,
        capacity: centre.capacity,
        now: { holding: get(holding), overdue: get(overdue), missing: get(missing), loss_of_care: get(care), late_arrivals: get(late) },
        period: { orders: get(ordered), handed_over: get(handedOver), not_collected: get(notCollected), refused_at_check_in: get(refusedIn), refused_at_counter: get(refusedOut), uncollected_pct: uncollected },
        flags: flagOrder.filter(flag => flags.includes(flag)),
      };
    });
    centreRows.sort((a, b) => b.flags.filter(flag => flag !== 'paused' && flag !== 'closed').length - a.flags.filter(flag => flag !== 'paused' && flag !== 'closed').length || b.now.holding - a.now.holding);

    // People behind refusals and uncollected items in the period.
    const sellerProblems = new Map<string, { refused: number; damaged: number }>();
    const buyerProblems = new Map<string, { not_collected: number; refused_at_counter: number }>();
    for (const row of refusalRows) {
      if (row.status === 'refused') {
        const seller = sellerProblems.get(row.order.sellerId) ?? { refused: 0, damaged: 0 };
        seller.refused += 1;
        sellerProblems.set(row.order.sellerId, seller);
      } else {
        const buyer = buyerProblems.get(row.order.buyerId) ?? { not_collected: 0, refused_at_counter: 0 };
        buyer.refused_at_counter += 1;
        buyerProblems.set(row.order.buyerId, buyer);
      }
    }
    for (const row of returnRows) {
      if (row.reason === 'damaged') {
        const seller = sellerProblems.get(row.order.sellerId) ?? { refused: 0, damaged: 0 };
        seller.damaged += 1;
        sellerProblems.set(row.order.sellerId, seller);
      }
      if (row.reason === 'not_collected') {
        const buyer = buyerProblems.get(row.order.buyerId) ?? { not_collected: 0, refused_at_counter: 0 };
        buyer.not_collected += 1;
        buyerProblems.set(row.order.buyerId, buyer);
      }
    }
    const owing = await this.prisma.connectCharge.findMany({ where: { payer: 'seller', status: 'owed', order: country }, select: { amountMinor: true, currency: true, order: { select: { sellerId: true } } } });
    const owed = new Map<string, { amount: number; currency: string }>();
    for (const row of owing) {
      const entry = owed.get(row.order.sellerId) ?? { amount: 0, currency: row.currency };
      entry.amount += minor(row.amountMinor);
      owed.set(row.order.sellerId, entry);
    }
    const sellerIds = [...new Set([...sellerProblems.keys(), ...owed.keys()])];
    const buyerIds = [...buyerProblems.keys()];
    const people = await this.prisma.customer.findMany({ where: { id: { in: [...sellerIds, ...buyerIds] } }, select: { id: true, name: true, email: true } });
    const named = new Map(people.map(person => [person.id, person]));
    const sellers = sellerIds
      .map(id => ({ id, name: named.get(id)?.name ?? null, email: named.get(id)?.email ?? null, refused: sellerProblems.get(id)?.refused ?? 0, damaged: sellerProblems.get(id)?.damaged ?? 0, storage_owed: owed.get(id) ?? null }))
      .sort((a, b) => b.refused + b.damaged - (a.refused + a.damaged) || (b.storage_owed?.amount ?? 0) - (a.storage_owed?.amount ?? 0))
      .slice(0, 20);
    const buyers = buyerIds
      .map(id => ({ id, name: named.get(id)?.name ?? null, email: named.get(id)?.email ?? null, ...buyerProblems.get(id)! }))
      .filter(buyer => buyer.not_collected + buyer.refused_at_counter >= 2)
      .sort((a, b) => b.not_collected + b.refused_at_counter - (a.not_collected + a.refused_at_counter))
      .slice(0, 20);

    const sum = (key: 'holding' | 'overdue' | 'missing' | 'loss_of_care' | 'late_arrivals') => centreRows.reduce((total, row) => total + row.now[key], 0);
    const total = (key: 'orders' | 'handed_over' | 'not_collected' | 'refused_at_check_in' | 'refused_at_counter') => centreRows.reduce((sumOf, row) => sumOf + row.period[key], 0);
    const currencies = new Set([...money.map(row => row.currency), ...storage.map(row => row.currency)]);
    return {
      object: 'connect_report' as const,
      days,
      country: filter.country?.toUpperCase() ?? null,
      now: { centres: centres.filter(centre => centre.status === 'active').length, holding: sum('holding'), overdue: sum('overdue'), missing: sum('missing'), loss_of_care: sum('loss_of_care'), late_arrivals: sum('late_arrivals') },
      period: {
        orders: total('orders'),
        handed_over: total('handed_over'),
        not_collected: total('not_collected'),
        refused_at_check_in: total('refused_at_check_in'),
        refused_at_counter: total('refused_at_counter'),
        returns_collected: returnRows.filter(row => row.status === 'collected').length,
        uncollected_pct: pct(total('not_collected'), total('handed_over') + total('not_collected')),
      },
      money: [...currencies].sort().map(currency => {
        const fees = money.find(row => row.currency === currency);
        const paid = (payer: string) => minor(storage.find(row => row.currency === currency && row.payer === payer)?._sum.amountMinor);
        const connectFees = minor(fees?._sum.connectFeeMinor);
        const centresShare = minor(fees?._sum.centreShareMinor);
        return { currency, connect_fees: connectFees, centres: centresShare, udozo: connectFees - centresShare, storage_buyers: paid('buyer'), storage_sellers: paid('seller') };
      }),
      centres: centreRows,
      sellers,
      buyers,
    };
  }

  /** What a centre holds now, for Udozo's team: each item with where it is and what is wrong with it. */
  async centreItems(centreId: string, now = new Date()) {
    const centre = await this.prisma.connectCentre.findUnique({ where: { id: centreId }, select: { id: true } });
    if (!centre) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such centre.');
    const orders = await this.prisma.classifiedOrder.findMany({
      where: atCentreWhere(centreId),
      orderBy: { receivedAt: 'asc' },
      take: 500,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        priceMinor: true,
        receivedAt: true,
        readyAt: true,
        collectBy: true,
        connectMissingAt: true,
        connectSeenAt: true,
        listing: { select: { title: true } },
        connectShelf: { select: { code: true } },
        connectReturn: { select: { number: true, status: true, lossOfCareAt: true } },
        connectCharges: { where: { status: 'owed' }, select: { payer: true, amountMinor: true } },
      },
    });
    return {
      object: 'list' as const,
      data: orders.map(order => {
        const owed = (payer: string) => order.connectCharges.filter(charge => charge.payer === payer).reduce((total, charge) => total + minor(charge.amountMinor), 0);
        return {
          object: 'connect_held_item' as const,
          order_id: order.id,
          number: orderNumber(order.number),
          title: order.listing.title,
          status: order.status,
          price: minor(order.priceMinor),
          currency: order.currency,
          shelf: order.connectShelf?.code ?? null,
          received_at: order.receivedAt?.toISOString() ?? null,
          ready_at: order.readyAt?.toISOString() ?? null,
          collect_by: order.collectBy?.toISOString() ?? null,
          overdue: order.status === 'at_centre' && Boolean(order.collectBy && order.collectBy < now),
          missing_since: order.connectMissingAt?.toISOString() ?? null,
          seen_at: order.connectSeenAt?.toISOString() ?? null,
          return: order.connectReturn ? { number: `RT-${String(order.connectReturn.number).padStart(6, '0')}`, status: order.connectReturn.status, loss_of_care_at: order.connectReturn.lossOfCareAt?.toISOString() ?? null } : null,
          buyer_owed: owed('buyer'),
          seller_owed: owed('seller'),
        };
      }),
    };
  }

  // ---- Alerts ----

  private async tellCentre(centreId: string, subject: string, title: string, body: string, link: string) {
    const people = await this.prisma.connectCentreMember.findMany({ where: { centreId, role: { in: ['owner', 'manager'] } }, include: { customer: { select: { id: true, storeId: true } } } });
    for (const person of people) {
      await this.inbox.customer({ customerId: person.customer.id, storeId: person.customer.storeId }, 'customer.connect.centre', { subject, title, body, link }).catch(() => undefined);
    }
  }

  /** The `classifieds` job: each alert is keyed by its day, week or item, so running it often sends nothing twice. */
  async alerts(now = new Date()) {
    const result = { full: 0, overdue: 0, due_today: 0, late: 0, uncollected: 0 };
    const today = day(now);
    const centres = await this.prisma.connectCentre.findMany({ where: { status: { in: ['active', 'paused'] } }, select: { id: true, name: true, capacity: true }, take: 500 });
    const ids = centres.map(centre => centre.id);
    if (!ids.length) return result;
    const group = (where: Prisma.ClassifiedOrderWhereInput) =>
      this.prisma.classifiedOrder.groupBy({ by: ['connectCentreId'], where: { AND: [{ connectCentreId: { in: ids } }, where] }, _count: { _all: true } }).then(byCentre);
    const monthAgo = new Date(now.getTime() - 30 * dayMs);
    const [holding, overdue, dueToday, handedOver, notCollectedRows] = await Promise.all([
      group(heldWhere),
      group({ status: 'at_centre', collectBy: { lt: now } }),
      group({ status: 'at_centre', collectBy: { gte: now, lt: new Date(now.getTime() + dayMs) } }),
      group({ status: 'released', releasedAt: { gte: monthAgo } }),
      this.prisma.connectReturnRequest.groupBy({ by: ['centreId'], where: { centreId: { in: ids }, reason: 'not_collected', createdAt: { gte: monthAgo } }, _count: { _all: true } }),
    ]);
    const notCollected = new Map(notCollectedRows.map(row => [row.centreId, row._count._all]));
    for (const centre of centres) {
      const items = `/connect/centre/${centre.id}/orders`;
      const held = holding.get(centre.id) ?? 0;
      if (centre.capacity && held >= centre.capacity) {
        result.full += 1;
        await this.tellCentre(centre.id, `connect_full:${centre.id}:${today}`, `${centre.name} is full`, `It holds ${held} items, its most is ${centre.capacity}. Hand over what is ready and ask for returns of what is not collected.`, items);
        await this.inbox.admins('admin.connect.alert', { subject: `connect_full:${centre.id}:${today}`, title: `${centre.name} is full`, body: `${held} items held, its most is ${centre.capacity}.`, link: `/connect/centres/${centre.id}` });
      }
      const late = overdue.get(centre.id) ?? 0;
      if (late) {
        result.overdue += 1;
        await this.tellCentre(centre.id, `connect_overdue:${centre.id}:${today}`, `${late === 1 ? '1 item is' : `${late} items are`} past their free time`, 'Storage is charged daily. Remind the buyers, or ask for a return once one is due.', items);
      }
      const due = dueToday.get(centre.id) ?? 0;
      if (due) {
        result.due_today += 1;
        await this.tellCentre(centre.id, `connect_due:${centre.id}:${today}`, `${due === 1 ? '1 item is' : `${due} items are`} due to be collected today`, 'Have them ready at the counter.', items);
      }
      const missed = notCollected.get(centre.id) ?? 0;
      const tried = (handedOver.get(centre.id) ?? 0) + missed;
      const share = pct(missed, tried);
      if (tried >= uncollectedFlagFrom && share !== null && share >= uncollectedFlagPct) {
        result.uncollected += 1;
        await this.inbox.admins('admin.connect.alert', { subject: `connect_uncollected:${centre.id}:${isoWeek(now)}`, title: `Buyers often never collect at ${centre.name}`, body: `${share}% of its items in the last 30 days were never collected (${missed} of ${tried}).`, link: `/connect/centres/${centre.id}` });
      }
    }

    // Items sent to a centre and not checked in after a week: the centre and Udozo's team, once each.
    const lateItems = await this.prisma.classifiedOrder.findMany({
      where: { fulfilment: 'connect', status: 'sent', receivedAt: null, sentAt: { lt: new Date(now.getTime() - lateArrivalDays * dayMs) }, connectCentreId: { in: ids } },
      take: 200,
      select: { id: true, number: true, connectCentreId: true, listing: { select: { title: true } } },
    });
    for (const order of lateItems) {
      result.late += 1;
      const centre = centres.find(row => row.id === order.connectCentreId)!;
      const title = `${orderNumber(order.number)} has not arrived`;
      const body = `"${order.listing.title}" was sent more than ${lateArrivalDays} days ago and is not checked in at ${centre.name}.`;
      await this.tellCentre(centre.id, `connect_late:${order.id}`, title, `${body} Check in it as soon as it arrives.`, `/connect/centre/${centre.id}/orders/${order.id}`);
      await this.inbox.admins('admin.connect.alert', { subject: `connect_late:${order.id}`, title, body, link: `/classifieds/orders/${order.id}` });
    }
    if (result.full || result.late || result.uncollected) this.logger.log({ ...result }, 'Connect alerts');
    return result;
  }
}
