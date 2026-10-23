import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AdminAuthService } from '../auth/admin-auth.service.js';
import { type ConfirmMethod, confirmMethods } from '../auth/confirm-methods.js';
import { AuditService } from '../audit/audit.service.js';
import { numericCode, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, SupplierFundingMovement } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney, supplierFundingCodeEmail } from '../notifications/templates.js';

/** Codes one request may be sent (the first and four resends): at most 25 guesses at it in all. */
const maxCodeSends = 5;
const minute = 60_000;
/** The emailed code works for 10 minutes: this records money sent. */
const codeLifetimeMs = 10 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;

type Input = { mode: LedgerMode; supplierCode: string; currency?: string; amount: number; reason: string };

const codeDigest = (id: string, code: string) => sha256(`supplier_funding:${id}:${code}`);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such supplier funding movement.');
const notWaiting = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'movement_not_awaiting_code', 'This movement is not waiting for a code.');

/**
 * Admins record money sent to a supplier outside BitoCard (a bank transfer to its account, for example Africa's
 * Talking's wallet), confirmed by a code emailed to the admin who asked, exactly as a manual top-up or exchange
 * reserve movement is. Confirming debits `supplier_float` (an asset: the balance increases, as a fund-the-reserve
 * movement does) and credits `provider_balance` (BitoCard's bank balance decreases) — the same account every
 * order's cost already draws down automatically, so this is the only way it is ever funded.
 */
@Injectable()
export class SupplierFundingService {
  private readonly logger = new Logger('SupplierFunding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAuth: AdminAuthService,
    private readonly ledger: LedgerService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  async request(adminId: string, input: Input) {
    const admin = await this.admin(adminId);
    const supplier = await this.prisma.supplier.findUnique({ where: { code: input.supplierCode } });
    if (!supplier) throw invalid('supplier_unavailable', 'Choose a supplier.', 'supplier_code');
    const currency = (input.currency ?? supplier.fundingCurrency)?.toUpperCase();
    if (!currency) throw invalid('parameter_missing', "Enter the supplier's funding currency.", 'currency');
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw invalid('parameter_invalid', 'Enter an amount above zero.', 'amount');
    if (input.reason.trim().length < 5) throw invalid('parameter_invalid', 'Say what this funding is for (at least 5 characters).', 'reason');
    const id = randomUUID();
    const code = numericCode();
    const row = await this.prisma.supplierFundingMovement.create({
      data: {
        id,
        mode: input.mode,
        supplierCode: supplier.code,
        currency,
        amount,
        reason: input.reason.trim(),
        requestedBy: admin.id,
        codeHash: codeDigest(id, code),
        codeExpiresAt: new Date(Date.now() + codeLifetimeMs),
        codeSentAt: new Date(),
      },
    });
    await this.audit.record({ actorId: admin.id, action: 'supplier.funding_requested', targetType: 'supplier', targetId: supplier.code, after: this.auditView(row, supplier.name) });
    await this.sendCode(admin.email, row, code, supplier.name);
    return { ...this.present(row, supplier.name, { [admin.id]: admin.name }), confirm_with: await confirmMethods(this.prisma, admin.id) };
  }

  async resendCode(adminId: string, id: string) {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code') throw notWaiting();
    if (row.codeSentAt && Date.now() - row.codeSentAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    if (row.codeSends >= maxCodeSends) throw invalid('code_resend_limit', 'Too many codes for this request. Cancel it and start again.', 'code');
    const code = numericCode();
    const updated = await this.prisma.supplierFundingMovement.updateMany({
      where: { id: row.id, status: 'awaiting_code', codeSends: { lt: maxCodeSends } },
      data: { codeHash: codeDigest(row.id, code), codeExpiresAt: new Date(Date.now() + codeLifetimeMs), codeAttempts: 0, codeSentAt: new Date(), codeSends: { increment: 1 } },
    });
    if (!updated.count) throw notWaiting();
    const admin = await this.admin(adminId);
    const fresh = await this.find(row.id);
    const supplier = await this.supplierName(fresh.supplierCode);
    await this.sendCode(admin.email, fresh, code, supplier);
    return this.present(fresh, supplier, { [admin.id]: admin.name });
  }

  /**
   * Confirms with the admin's own authenticator app (when they have one; a wrong code counts towards their sign-in
   * lockout) or with the emailed code (the fallback, which every admin can use). The float moves once, claimed in
   * the same transaction as the ledger entry.
   */
  async confirm(adminId: string, id: string, code: string, method: ConfirmMethod = 'email') {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code' || !row.codeHash) throw notWaiting();
    if (method === 'authenticator') {
      if (!(await confirmMethods(this.prisma, adminId)).includes('authenticator')) throw invalid('authenticator_not_set_up', 'Set up your authenticator app first, or use the code we emailed you.', 'method');
      await this.adminAuth.confirmCode(adminId, code);
    } else {
      if (!row.codeExpiresAt || row.codeExpiresAt <= new Date()) throw invalid('code_expired', 'That code has expired. Ask for a new one.', 'code');
      const attempt = await this.prisma.supplierFundingMovement.updateMany({ where: { id: row.id, status: 'awaiting_code', codeAttempts: { lt: maxCodeAttempts } }, data: { codeAttempts: { increment: 1 } } });
      if (!attempt.count) throw invalid('code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
      if (!sameDigest(row.codeHash, codeDigest(row.id, code))) throw invalid('code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    }

    const entry = await this.ledger.prepare({
      mode: row.mode,
      type: 'supplier_funding',
      reference: `supplier_funding:${row.id}`,
      resellerId: null,
      description: `Supplier funded: ${formatMoney(row.amount, row.currency)} to ${row.supplierCode} (${this.number(row)})`,
      metadata: { supplier_funding_id: row.id, actor_id: adminId, supplier_code: row.supplierCode },
      lines: [
        { account: { kind: 'supplier_float', currency: row.currency, provider: row.supplierCode }, debit: row.amount },
        { account: { kind: 'provider_balance', currency: row.currency, provider: 'manual' }, credit: row.amount },
      ],
    });
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.supplierFundingMovement.updateMany({ where: { id: row.id, status: 'awaiting_code', codeHash: row.codeHash }, data: { status: 'completed', codeHash: null, completedAt: new Date() } });
      if (!claimed.count) throw notWaiting();
      const written = await this.ledger.write(tx, entry);
      await tx.supplierFundingMovement.update({ where: { id: row.id }, data: { entryId: written.id } });
    });
    const done = await this.find(row.id);
    const supplier = await this.supplierName(done.supplierCode);
    await this.audit.record({ actorId: adminId, action: 'supplier.funded', targetType: 'supplier', targetId: done.supplierCode, after: this.auditView(done, supplier) });
    await this.inbox.admins('admin.supplier.funded', {
      subject: done.id,
      title: `${formatMoney(done.amount, done.currency)} sent to ${supplier}`,
      body: `${this.number(done)}: ${done.reason}`,
      link: '/reports/suppliers',
      mode: done.mode,
    });
    return this.present(done, supplier, await this.names([done]));
  }

  async cancel(adminId: string, id: string) {
    const row = await this.find(id);
    const cancelled = await this.prisma.supplierFundingMovement.updateMany({ where: { id: row.id, status: 'awaiting_code' }, data: { status: 'cancelled', codeHash: null, cancelledBy: adminId } });
    if (!cancelled.count) throw notWaiting();
    const fresh = await this.find(row.id);
    const supplier = await this.supplierName(fresh.supplierCode);
    await this.audit.record({ actorId: adminId, action: 'supplier.funding_cancelled', targetType: 'supplier', targetId: fresh.supplierCode, after: this.auditView(fresh, supplier) });
    return this.present(fresh, supplier, await this.names([fresh]));
  }

  async list(filter: { mode?: LedgerMode; supplier_code?: string; status?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.supplierFundingMovement.findMany({
      where: {
        ...(filter.mode ? { mode: filter.mode } : {}),
        ...(filter.supplier_code ? { supplierCode: filter.supplier_code } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const names = await this.names(page);
    const suppliers = await this.supplierNames(page);
    return { object: 'list' as const, data: page.map(row => this.present(row, suppliers.get(row.supplierCode) ?? row.supplierCode, names)), has_more: rows.length > limit };
  }

  async get(id: string) {
    const row = await this.find(id);
    return this.present(row, await this.supplierName(row.supplierCode), await this.names([row]));
  }

  /**
   * Per supplier and currency: what admins recorded as sent to it (`funded`) and what orders drew down
   * (`consumed`: `cost_of_sales` against the same float, less what suppliers refunded) over the asked period, and
   * what remains over all time (the ledger's `supplier_float` balance, so it always matches the books).
   */
  async floatTracking(input: { mode: LedgerMode; from: Date; to: Date }) {
    const [balances, consumed, funded] = await Promise.all([
      this.prisma.ledgerAccount.groupBy({ by: ['ownerKey', 'currency'], where: { mode: input.mode, kind: 'supplier_float' }, _sum: { balanceMinor: true } }),
      this.prisma.$queryRaw<Array<{ provider: string; currency: string; consumed: bigint }>>`
        SELECT a.owner_key AS provider, a.currency, SUM(p.amount_minor) AS consumed
        FROM ledger_postings p
        JOIN ledger_accounts a ON a.id = p.account_id
        JOIN journal_entries e ON e.id = p.entry_id
        WHERE a.kind = 'cost_of_sales' AND a.mode = ${input.mode}::"LedgerMode"
          AND e.created_at >= ${input.from} AND e.created_at < ${input.to}
        GROUP BY a.owner_key, a.currency`,
      this.prisma.supplierFundingMovement.groupBy({
        by: ['supplierCode', 'currency'],
        where: { mode: input.mode, status: 'completed', completedAt: { gte: input.from, lt: input.to } },
        _sum: { amount: true },
      }),
    ]);
    // Both are keyed by the supplier's own code: ledger owner keys are `provider:<code>`.
    const supplierOf = (ownerKey: string) => ownerKey.replace(/^provider:/, '');
    const consumedByKey = new Map(consumed.map(row => [`${supplierOf(row.provider)}:${row.currency}`, row.consumed]));
    const fundedByKey = new Map(funded.map(row => [`${row.supplierCode}:${row.currency}`, row._sum.amount ?? 0n]));
    const codes = [...new Set(balances.map(row => supplierOf(row.ownerKey)))];
    const names = codes.length ? await this.prisma.supplier.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } }) : [];
    const byCode = new Map(names.map(s => [s.code, s.name]));
    return {
      object: 'list' as const,
      data: balances
        .map(row => {
          const code = supplierOf(row.ownerKey);
          return {
            object: 'supplier_float' as const,
            supplier_code: code,
            supplier_name: byCode.get(code) ?? code,
            currency: row.currency,
            funded: minor(fundedByKey.get(`${code}:${row.currency}`) ?? 0n),
            consumed: minor(consumedByKey.get(`${code}:${row.currency}`) ?? 0n),
            remaining: minor(row._sum.balanceMinor ?? 0n),
          };
        })
        .sort((a, b) => a.supplier_name.localeCompare(b.supplier_name)),
    };
  }

  private async admin(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { id: true, email: true, name: true, realm: true } });
    if (!admin || admin.realm !== 'admin') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'admin_required', 'Only a signed-in admin can fund a supplier.');
    return admin;
  }

  private async find(id: string) {
    const row = await this.prisma.supplierFundingMovement.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  private async own(adminId: string, id: string) {
    const row = await this.find(id);
    if (row.requestedBy !== adminId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_requester', 'Only the admin who asked for this can confirm it.');
    return row;
  }

  private async names(rows: SupplierFundingMovement[]) {
    const ids = [...new Set(rows.flatMap(row => [row.requestedBy, row.cancelledBy].filter((value): value is string => Boolean(value))))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    return Object.fromEntries(users.map(user => [user.id, user.name])) as Record<string, string>;
  }

  private async supplierName(code: string) {
    return (await this.prisma.supplier.findUnique({ where: { code }, select: { name: true } }))?.name ?? code;
  }

  private async supplierNames(rows: SupplierFundingMovement[]) {
    const codes = [...new Set(rows.map(row => row.supplierCode))];
    const suppliers = codes.length ? await this.prisma.supplier.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } }) : [];
    return new Map(suppliers.map(s => [s.code, s.name]));
  }

  private async sendCode(to: string, row: SupplierFundingMovement, code: string, supplierName: string) {
    await this.email
      .send(supplierFundingCodeEmail(to, { code, number: this.number(row), amount: formatMoney(row.amount, row.currency), supplier: supplierName, sandbox: row.mode === 'test' }))
      .catch(error => this.logger.warn({ err: error, movement: row.id }, 'Could not email the supplier funding code'));
  }

  private number(row: Pick<SupplierFundingMovement, 'number'>) {
    return `SF-${String(row.number).padStart(6, '0')}`;
  }

  private auditView(row: SupplierFundingMovement, supplierName: string) {
    return { id: row.id, number: this.number(row), mode: row.mode, supplier_code: row.supplierCode, supplier_name: supplierName, currency: row.currency, amount: minor(row.amount), reason: row.reason, status: row.status };
  }

  private present(row: SupplierFundingMovement, supplierName: string, names: Record<string, string>) {
    const expired = row.status === 'awaiting_code' && Boolean(row.codeExpiresAt && row.codeExpiresAt <= new Date());
    return {
      object: 'supplier_funding_movement' as const,
      id: row.id,
      number: this.number(row),
      mode: row.mode,
      supplier: { code: row.supplierCode, name: supplierName },
      currency: row.currency,
      amount: minor(row.amount),
      reason: row.reason,
      status: expired ? ('expired' as const) : (row.status as 'awaiting_code' | 'completed' | 'cancelled'),
      requested_by: { id: row.requestedBy, name: names[row.requestedBy] ?? null },
      cancelled_by: row.cancelledBy ? { id: row.cancelledBy, name: names[row.cancelledBy] ?? null } : null,
      code_expires_at: row.status === 'awaiting_code' ? (row.codeExpiresAt?.toISOString() ?? null) : null,
      code_sent_at: row.status === 'awaiting_code' ? (row.codeSentAt?.toISOString() ?? null) : null,
      created_at: row.createdAt.toISOString(),
      completed_at: row.completedAt?.toISOString() ?? null,
    };
  }
}
