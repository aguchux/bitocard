import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { cleanMessage } from '../classifieds/conversations.service.js';
import { invalid } from '../classifieds/rules.js';
import { publicName } from '../classifieds/search.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ShopEmails } from '../classifieds/shop-emails.service.js';
import { templateFor } from '../stores/templates.js';
import { ResaleOrdersService } from './resale-orders.service.js';

export const storeReportReasons = ['claims_ownership', 'misleading', 'pay_outside', 'misused_details', 'other'] as const;
export type StoreReportReason = (typeof storeReportReasons)[number];
export const storeReportDecisions = ['upheld', 'dismissed'] as const;
export type StoreReportDecision = (typeof storeReportDecisions)[number];

const reasonText: Record<StoreReportReason, string> = {
  claims_ownership: 'claims to own or make the items',
  misleading: 'says things about an item the supplier did not',
  pay_outside: 'asked to be paid outside Udozo',
  misused_details: 'used a buyer’s details for something else',
  other: 'something else',
};

const notFound = (what = 'report') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

const reportInclude = {
  store: { select: { id: true, name: true, subdomain: true } },
  reseller: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true, email: true, storeId: true } },
} satisfies Prisma.ResaleStoreReportInclude;
type ReportRow = Prisma.ResaleStoreReportGetPayload<{ include: typeof reportInclude }>;

/**
 * B2B reselling, stage 5 (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, Trust and safety 4 and 9): a Resale shop's buyers
 * and its suppliers report the store (claiming to own or make the items, saying things the supplier did not, asking
 * to be paid outside BitoCard, misusing a buyer's details). BitoCard's operations uphold or dismiss each one; an upheld
 * report is a strike for the store's reseller, and at their limit the reseller's Resale shops stop taking orders.
 */
@Injectable()
export class ResaleStoreReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: ResaleOrdersService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly emails: ShopEmails,
  ) {}

  private details(raw: string) {
    const text = cleanMessage(raw ?? '');
    if (text.length < 10) throw invalid('parameter_invalid', 'Say what happened (at least 10 characters).', 'details');
    return text.slice(0, 2000);
  }

  private async open(input: { storeId: string; resellerId: string; reporterId: string; reporterKind: 'buyer' | 'supplier'; orderId: string | null; reason: StoreReportReason; details: string }) {
    try {
      const report = await this.prisma.resaleStoreReport.create({ data: { ...input, details: this.details(input.details) }, include: reportInclude });
      await this.inbox.admins('admin.classifieds.resale_store_report', { subject: `resale_store_report:${report.id}`, title: `A Resale shop was reported: ${report.store.name}`, body: `By a ${input.reporterKind}: it ${reasonText[input.reason]}.`, link: `/classifieds/resale-reports/${report.id}` });
      return this.present(report, 'reporter');
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('report_open', 'You have already reported this store; Udozo is looking at it.');
      throw error;
    }
  }

  /** A customer of the Resale shop reports it (optionally about one of their orders there). */
  async reportByBuyer(customer: CustomerWithStore, input: { reason: StoreReportReason; details: string; order_id?: string }) {
    const store = customer.store;
    if (store.reseller.house || !templateFor(store.template)?.resale) throw notFound('store');
    if (input.order_id) {
      const order = await this.prisma.classifiedOrder.findFirst({ where: { id: input.order_id, buyerId: customer.id, storeId: store.id, kind: 'resale' }, select: { id: true } });
      if (!order) throw notFound('order');
    }
    return this.open({ storeId: store.id, resellerId: store.resellerId, reporterId: customer.id, reporterKind: 'buyer', orderId: input.order_id ?? null, reason: input.reason, details: input.details });
  }

  /** A supplier reports one of the stores of a reseller carrying their listings. */
  async reportBySupplier(customer: CustomerWithStore, relationshipId: string, input: { store_id: string; reason: StoreReportReason; details: string }) {
    if (!customer.store.reseller.house) throw notFound('reseller');
    const relationship = await this.prisma.resaleRelationship.findFirst({ where: { id: relationshipId, supplierId: customer.id }, select: { resellerId: true } });
    if (!relationship) throw notFound('reseller');
    const store = await this.prisma.store.findFirst({ where: { id: input.store_id, resellerId: relationship.resellerId, template: 'resale_shop' }, select: { id: true } });
    if (!store) throw notFound('store');
    return this.open({ storeId: store.id, resellerId: relationship.resellerId, reporterId: customer.id, reporterKind: 'supplier', orderId: null, reason: input.reason, details: input.details });
  }

  async mine(customer: CustomerWithStore) {
    const rows = await this.prisma.resaleStoreReport.findMany({ where: { reporterId: customer.id }, include: reportInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    return { object: 'list' as const, data: rows.map(row => this.present(row, 'reporter')) };
  }

  // ---- BitoCard ----

  async list(filter: { status?: string; reseller_id?: string; limit?: number; offset?: number }) {
    const where: Prisma.ResaleStoreReportWhereInput = { ...(filter.status ? { status: filter.status } : {}), ...(filter.reseller_id ? { resellerId: filter.reseller_id } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.resaleStoreReport.findMany({ where, include: reportInclude, orderBy: { createdAt: filter.status === 'open' ? 'asc' : 'desc' }, take: filter.limit ?? 50, skip: filter.offset ?? 0 }),
      this.prisma.resaleStoreReport.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.present(row, 'admin')), total };
  }

  async get(id: string) {
    const row = await this.prisma.resaleStoreReport.findUnique({ where: { id }, include: reportInclude });
    if (!row) throw notFound();
    return this.present(row, 'admin');
  }

  /** Operations uphold (a strike for the reseller) or dismiss a report, once; the reporter and the reseller are told. */
  async decide(actorId: string | null, id: string, input: { decision: StoreReportDecision; note: string }) {
    const row = await this.prisma.resaleStoreReport.findUnique({ where: { id }, include: reportInclude });
    if (!row) throw notFound();
    const claimed = await this.prisma.resaleStoreReport.updateMany({ where: { id, status: 'open' }, data: { status: input.decision, note: input.note, decidedById: actorId, decidedAt: new Date() } });
    if (!claimed.count) throw conflict('report_decided', 'This report was already decided.');
    await this.audit.record({ actorId, action: `resale.store_report_${input.decision}`, targetType: 'reseller', targetId: row.resellerId, before: { status: 'open' }, after: { report: id, store: row.storeId, reason: row.reason, note: input.note } });
    const verdict = input.decision === 'upheld' ? 'upheld' : 'looked into and closed';
    this.emails.customer(row.reporter.id, { title: `Your report of ${row.store.name}`, body: `Udozo ${verdict} your report. ${input.note}`.slice(0, 280), path: row.reporterKind === 'supplier' ? '/account/resellers' : '/account/purchases' });
    if (input.decision === 'upheld') this.emails.reseller(row.resellerId, { title: `A report of ${row.store.name} was upheld`, body: `It ${reasonText[row.reason as StoreReportReason]}. This counts as a strike. ${input.note}`.slice(0, 280), path: '/resale/orders' });
    await this.inbox.customer({ customerId: row.reporter.id, storeId: row.reporter.storeId }, 'customer.purchase.updated', { subject: `resale_store_report:${id}:decided`, title: `Your report of ${row.store.name}`, body: `Udozo ${verdict} your report. ${input.note}`.slice(0, 280), link: row.reporterKind === 'supplier' ? '/account/resellers' : '/account/purchases' });
    if (input.decision === 'upheld') {
      await this.inbox.reseller(row.resellerId, 'resale.order_updated', { subject: `resale_store_report:${id}`, title: `A report of ${row.store.name} was upheld`, body: `It ${reasonText[row.reason as StoreReportReason]}. This counts as a strike. ${input.note}`.slice(0, 280), link: '/resale/orders' });
      const reseller = await this.prisma.reseller.findUnique({ where: { id: row.resellerId }, select: { country: true } });
      if (reseller?.country) await this.orders.afterStrike(row.resellerId, reseller.country);
    }
    return this.get(id);
  }

  private present(row: ReportRow, viewer: 'reporter' | 'admin') {
    return {
      object: 'resale_store_report' as const,
      id: row.id,
      number: `RR-${String(row.number).padStart(6, '0')}`,
      store: { id: row.store.id, name: row.store.name, subdomain: row.store.subdomain },
      reason: row.reason as StoreReportReason,
      details: row.details,
      order_id: row.orderId,
      status: row.status as 'open' | StoreReportDecision,
      note: row.note,
      decided_at: row.decidedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      ...(viewer === 'admin'
        ? { reseller: { id: row.reseller.id, name: row.reseller.name }, reporter: { id: row.reporter.id, name: row.reporter.name, email: row.reporter.email, kind: row.reporterKind as 'buyer' | 'supplier' } }
        : { reporter_name: publicName(row.reporter.name) }),
    };
  }
}
