import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type LedgerMode } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { P2pStandingService } from './p2p-standing.service.js';
import { P2pWordsService } from './p2p-words.service.js';

/** What traders may say about each other and what can be reported. */
export const feedbackRatings = ['positive', 'negative'] as const;
export const reportReasons = ['fraud', 'fake_payment', 'third_party_payment', 'off_platform', 'abuse', 'other'] as const;
export type ReportReason = (typeof reportReasons)[number];
export const maxBlocks = 200;
/** Feedback is given within this long of an order being released. */
const feedbackDays = 30;
const day = 86_400_000;

export type Trust = {
  orders_30d: number;
  orders_total: number;
  /** Released orders against those the trader failed (cancelled or let expire as the buyer, or lost on appeal), in 30 days; null with none. */
  completion_rate_30d: number | null;
  /** Minutes, over 30 days: as the buyer from opening to marking paid, as the seller from paid to releasing. */
  avg_pay_minutes: number | null;
  avg_release_minutes: number | null;
  feedback: { positive: number; negative: number };
};

const reportNumber = (n: number) => `R-${String(n).padStart(6, '0')}`;
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noTrader = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No trader by that nickname.', 'nickname');

/**
 * Trust between Afrippa's traders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 6): figures worked out from their orders
 * (orders completed, completion rate, how fast they pay and release) and feedback, shown on their ads and card;
 * feedback once per party after a released order; blocks (neither side sees or trades with the other); and reports,
 * which Afrippa's operations uphold or dismiss (an upheld report is a strike on the reported trader's standing).
 */
@Injectable()
export class P2pTrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly words: P2pWordsService,
    private readonly standing: P2pStandingService,
  ) {}

  // -- Figures -------------------------------------------------------------------------------------------------

  async trust(ids: string[], mode: LedgerMode): Promise<Map<string, Trust>> {
    const result = new Map<string, Trust>(ids.map(id => [id, { orders_30d: 0, orders_total: 0, completion_rate_30d: null, avg_pay_minutes: null, avg_release_minutes: null, feedback: { positive: 0, negative: 0 } }]));
    if (ids.length === 0) return result;
    const since = new Date(Date.now() - 30 * day);
    const list = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
    const done = await this.prisma.$queryRaw<Array<{ id: string; total: bigint; recent: bigint }>>`
      SELECT party AS id, COUNT(*) AS total, COUNT(*) FILTER (WHERE closed_at > ${since}) AS recent
      FROM (SELECT buyer_id AS party, closed_at FROM p2p_orders WHERE status = 'released' AND mode = ${mode}::"LedgerMode" AND buyer_id IN (${list})
            UNION ALL SELECT seller_id, closed_at FROM p2p_orders WHERE status = 'released' AND mode = ${mode}::"LedgerMode" AND seller_id IN (${list})) AS released
      GROUP BY party`;
    const failed = await this.prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
      SELECT party AS id, COUNT(*) AS count
      FROM (SELECT buyer_id AS party FROM p2p_orders WHERE mode = ${mode}::"LedgerMode" AND closed_at > ${since} AND buyer_id IN (${list}) AND (status = 'cancelled' OR decision_fault = 'buyer')
            UNION ALL SELECT seller_id FROM p2p_orders WHERE mode = ${mode}::"LedgerMode" AND closed_at > ${since} AND seller_id IN (${list}) AND decision_fault = 'seller') AS lost
      GROUP BY party`;
    const pay = await this.prisma.$queryRaw<Array<{ id: string; minutes: number | null }>>`
      SELECT buyer_id AS id, AVG(EXTRACT(EPOCH FROM paid_at - created_at)) / 60 AS minutes
      FROM p2p_orders WHERE mode = ${mode}::"LedgerMode" AND paid_at IS NOT NULL AND created_at > ${since} AND buyer_id IN (${list}) GROUP BY buyer_id`;
    const release = await this.prisma.$queryRaw<Array<{ id: string; minutes: number | null }>>`
      SELECT seller_id AS id, AVG(EXTRACT(EPOCH FROM closed_at - paid_at)) / 60 AS minutes
      FROM p2p_orders WHERE mode = ${mode}::"LedgerMode" AND status = 'released' AND decided_by IS NULL AND paid_at IS NOT NULL AND closed_at > ${since} AND seller_id IN (${list}) GROUP BY seller_id`;
    const ratings = await this.prisma.p2pFeedback.groupBy({ by: ['toId', 'rating'], where: { toId: { in: ids }, mode }, _count: { _all: true } });
    for (const row of done) Object.assign(result.get(row.id)!, { orders_total: Number(row.total), orders_30d: Number(row.recent) });
    for (const row of failed) {
      const trust = result.get(row.id)!;
      const total = trust.orders_30d + Number(row.count);
      trust.completion_rate_30d = total ? Math.round((trust.orders_30d / total) * 1000) / 10 : null;
    }
    for (const trust of result.values()) if (trust.completion_rate_30d === null && trust.orders_30d > 0) trust.completion_rate_30d = 100;
    for (const row of pay) result.get(row.id)!.avg_pay_minutes = row.minutes === null ? null : Math.round(Number(row.minutes) * 10) / 10;
    for (const row of release) result.get(row.id)!.avg_release_minutes = row.minutes === null ? null : Math.round(Number(row.minutes) * 10) / 10;
    for (const row of ratings) result.get(row.toId)!.feedback[row.rating as 'positive' | 'negative'] = row._count._all;
    return result;
  }

  /** A trader's card for signed-in traders: their figures and their latest feedback, by nickname only. */
  async card(nickname: string, mode: LedgerMode) {
    const profile = await this.prisma.p2pProfile.findFirst({ where: { nickname } });
    if (!profile) throw noTrader();
    const trust = (await this.trust([profile.customerId], mode)).get(profile.customerId)!;
    const latest = await this.prisma.p2pFeedback.findMany({ where: { toId: profile.customerId, mode }, orderBy: { createdAt: 'desc' }, take: 20 });
    const names = new Map((await this.prisma.p2pProfile.findMany({ where: { customerId: { in: latest.map(item => item.fromId) } } })).map(item => [item.customerId, item.nickname]));
    const merchant = (await this.prisma.p2pMerchant.count({ where: { customerId: profile.customerId, mode, status: 'active' } })) > 0;
    return {
      object: 'p2p_trader' as const,
      nickname: profile.nickname,
      /** An Afrippa merchant: approved by Afrippa's team, and not suspended. */
      merchant,
      since: profile.createdAt.toISOString(),
      ...trust,
      latest_feedback: latest.map(item => ({ rating: item.rating, comment: item.comment, from: names.get(item.fromId) ?? 'Trader', created_at: item.createdAt.toISOString() })),
    };
  }

  // -- Feedback ------------------------------------------------------------------------------------------------

  /** One rating per party per released order, within 30 days of release. The rated trader is told. */
  async giveFeedback(customer: CustomerWithStore, orderId: string, input: { rating: 'positive' | 'negative'; comment?: string }) {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id: orderId } });
    if (!order || (order.buyerId !== customer.id && order.sellerId !== customer.id)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.', 'id');
    if (order.status !== 'released' || !order.closedAt) throw conflict('feedback_not_open', 'Feedback is given once an order is released.');
    if (order.closedAt.getTime() + feedbackDays * day < Date.now()) throw conflict('feedback_closed', `Feedback is given within ${feedbackDays} days of an order.`);
    const comment = input.comment?.trim() || null;
    await this.words.check(comment, order.market, 'comment', 'comment_refused');
    const toId = order.buyerId === customer.id ? order.sellerId : order.buyerId;
    try {
      const saved = await this.prisma.p2pFeedback.create({ data: { mode: order.mode, orderId, fromId: customer.id, toId, rating: input.rating, comment } });
      const other = await this.prisma.customer.findUnique({ where: { id: toId }, select: { storeId: true } });
      if (other) {
        await this.inbox.customer({ customerId: toId, storeId: other.storeId }, 'customer.p2p.feedback_received', {
          subject: `p2p_feedback:${saved.id}`,
          title: input.rating === 'positive' ? 'You got positive feedback' : 'You got negative feedback',
          body: comment ?? 'A trader rated an order with you.',
          link: `/orders/${orderId}`,
          mode: order.mode,
        });
      }
      return { object: 'p2p_feedback' as const, order_id: orderId, rating: saved.rating, comment: saved.comment, created_at: saved.createdAt.toISOString() };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('feedback_given', 'You have already rated this order.');
      throw error;
    }
  }

  // -- Blocks --------------------------------------------------------------------------------------------------

  /** Everyone the trader blocked or who blocked them: their ads are hidden from each other and cannot be taken. */
  async blockedWith(customerId: string) {
    const rows = await this.prisma.p2pBlock.findMany({ where: { OR: [{ blockerId: customerId }, { blockedId: customerId }] } });
    return [...new Set(rows.map(row => (row.blockerId === customerId ? row.blockedId : row.blockerId)))];
  }

  async blocks(customer: CustomerWithStore) {
    const rows = await this.prisma.p2pBlock.findMany({ where: { blockerId: customer.id }, orderBy: { createdAt: 'desc' } });
    const names = new Map((await this.prisma.p2pProfile.findMany({ where: { customerId: { in: rows.map(row => row.blockedId) } } })).map(item => [item.customerId, item.nickname]));
    return { object: 'list' as const, data: rows.map(row => ({ object: 'p2p_block' as const, nickname: names.get(row.blockedId) ?? 'Trader', created_at: row.createdAt.toISOString() })) };
  }

  async block(customer: CustomerWithStore, nickname: string) {
    const target = await this.traderBy(nickname);
    if (target === customer.id) throw invalid('parameter_invalid', 'You cannot block yourself.', 'nickname');
    if ((await this.prisma.p2pBlock.count({ where: { blockerId: customer.id } })) >= maxBlocks) throw conflict('too_many_blocks', `You can block up to ${maxBlocks} traders.`);
    await this.prisma.p2pBlock.upsert({ where: { blockerId_blockedId: { blockerId: customer.id, blockedId: target } }, create: { blockerId: customer.id, blockedId: target }, update: {} });
    return { object: 'p2p_block' as const, nickname, blocked: true };
  }

  async unblock(customer: CustomerWithStore, nickname: string) {
    const target = await this.traderBy(nickname);
    await this.prisma.p2pBlock.deleteMany({ where: { blockerId: customer.id, blockedId: target } });
    return { object: 'p2p_block' as const, nickname, blocked: false };
  }

  private async traderBy(nickname: string) {
    const profile = await this.prisma.p2pProfile.findFirst({ where: { nickname: nickname.trim() } });
    if (!profile) throw noTrader();
    return profile.customerId;
  }

  // -- Reports -------------------------------------------------------------------------------------------------

  /** A trader reports another (optionally on an order between them); one open report each. Afrippa's operations decide. */
  async report(customer: CustomerWithStore, mode: LedgerMode, input: { nickname: string; reason: ReportReason; details: string; order_id?: string }) {
    const reportedId = await this.traderBy(input.nickname);
    if (reportedId === customer.id) throw invalid('parameter_invalid', 'You cannot report yourself.', 'nickname');
    if (input.order_id) {
      const order = await this.prisma.p2pOrder.findUnique({ where: { id: input.order_id } });
      const between = order && [order.buyerId, order.sellerId].includes(customer.id) && [order.buyerId, order.sellerId].includes(reportedId);
      if (!between) throw invalid('parameter_invalid', 'Choose an order between you and this trader.', 'order_id');
    }
    try {
      const report = await this.prisma.p2pReport.create({ data: { mode, reporterId: customer.id, reportedId, orderId: input.order_id ?? null, reason: input.reason, details: input.details.trim() } });
      const presented = await this.presentReport(report, 'reporter');
      await this.inbox.afrippaAdmins('admin.p2p.report_opened', {
        subject: `report:${report.id}`,
        title: `${presented.number}: ${presented.reported} reported`,
        body: `Reason: ${input.reason.replace(/_/g, ' ')}.`,
        link: `/reports/${report.id}`,
        mode,
      });
      return presented;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('report_open', 'You already have an open report about this trader.');
      throw error;
    }
  }

  async myReports(customer: CustomerWithStore) {
    const reports = await this.prisma.p2pReport.findMany({ where: { reporterId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { object: 'list' as const, data: await Promise.all(reports.map(report => this.presentReport(report, 'reporter'))) };
  }

  async adminReports(query: { status?: 'open' | 'upheld' | 'dismissed'; mode?: LedgerMode }) {
    const reports = await this.prisma.p2pReport.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.mode ? { mode: query.mode } : {}) }, orderBy: { createdAt: 'asc' }, take: 200 });
    return { object: 'list' as const, data: await Promise.all(reports.map(report => this.presentReport(report, 'admin'))) };
  }

  /** Operations uphold (a strike on the reported trader) or dismiss a report, once. Audited; the reporter is told. */
  async decide(adminId: string | null, id: string, input: { decision: 'upheld' | 'dismissed'; note: string }) {
    const claimed = await this.prisma.p2pReport.updateMany({ where: { id, status: 'open' }, data: { status: input.decision, decidedBy: adminId, decidedAt: new Date(), decisionNote: input.note.trim() } });
    if (claimed.count === 0) {
      if (!(await this.prisma.p2pReport.findUnique({ where: { id } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such report.', 'id');
      throw conflict('report_decided', 'This report has already been decided.');
    }
    const report = await this.prisma.p2pReport.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId: adminId, action: `p2p_report.${input.decision}`, targetType: 'p2p_report', targetId: id, after: { reported: report.reportedId, note: input.note.trim() }, platform: 'afrippa' });
    // An upheld report is a strike: the reported trader is told if it pauses their trading, and a merchant is suspended.
    if (input.decision === 'upheld') await this.standing.afterStrike(report.reportedId, report.mode);
    const reporter = await this.prisma.customer.findUnique({ where: { id: report.reporterId }, select: { storeId: true } });
    if (reporter) {
      await this.inbox.customer({ customerId: report.reporterId, storeId: reporter.storeId }, 'customer.p2p.report_decided', {
        subject: `p2p_report:${id}`,
        title: 'Your report was reviewed',
        body: input.decision === 'upheld' ? "Afrippa's team upheld your report and acted on it." : "Afrippa's team reviewed your report and took no action.",
        link: '/trust',
        mode: report.mode,
      });
    }
    return this.presentReport(report, 'admin');
  }

  private async presentReport(report: Awaited<ReturnType<typeof this.prisma.p2pReport.findUniqueOrThrow>>, viewer: 'reporter' | 'admin') {
    const names = new Map((await this.prisma.p2pProfile.findMany({ where: { customerId: { in: [report.reporterId, report.reportedId] } } })).map(item => [item.customerId, item.nickname]));
    return {
      object: 'p2p_report' as const,
      id: report.id,
      number: reportNumber(report.number),
      mode: report.mode,
      reported: names.get(report.reportedId) ?? 'Trader',
      reason: report.reason,
      details: report.details,
      order_id: report.orderId,
      status: report.status,
      decided_at: report.decidedAt?.toISOString() ?? null,
      created_at: report.createdAt.toISOString(),
      ...(viewer === 'admin' ? { reporter: names.get(report.reporterId) ?? 'Trader', reporter_id: report.reporterId, reported_id: report.reportedId, decision_note: report.decisionNote } : {}),
    };
  }
}
