import { type ConfirmMethod, confirmMethods } from '../auth/confirm-methods.js';
import { AdminAuthService } from '../auth/admin-auth.service.js';
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseStoreId } from '../checkout/house.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { numericCode, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, ManualTopUp, Prisma } from '../generated/prisma/client.js';
import { type AccountRef, LedgerService, type Line } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { currencyNotHeld, walletCurrencies, WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney, manualTopUpCodeEmail } from '../notifications/templates.js';

/** Codes one request may be sent (the first and four resends): at most 25 guesses at it in all. */
const maxCodeSends = 5;
const minute = 60_000;
/** The emailed code works for 10 minutes: this moves money. */
export const topUpCodeLifetimeMs = 10 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;
/** The most one top-up can add, in minor units (as for wallet adjustments). */
export const maxTopUpMinor = 1_000_000_000_00;

export type TopUpSource = 'received' | 'goodwill';
export const topUpSources: readonly TopUpSource[] = ['received', 'goodwill'];

type Target = { type: 'reseller'; resellerId: string } | { type: 'customer'; customerId: string };
type TopUpInput = { mode?: LedgerMode; currency?: string; amount: number; source: TopUpSource; external_reference?: string; reason: string };

const codeDigest = (id: string, code: string) => sha256(`manual_top_up:${id}:${code}`);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such top-up.');
const notWaiting = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'top_up_not_awaiting_code', 'This top-up is not waiting for a code.');

const withTarget = { reseller: { select: { id: true, name: true } }, customer: { select: { id: true, name: true, email: true, storeId: true, store: { select: { name: true } } } } } satisfies Prisma.ManualTopUpInclude;
type Row = Prisma.ManualTopUpGetPayload<{ include: typeof withTarget }>;

/**
 * Finance admins' manual top-ups of reseller and customer wallets. Asking creates the top-up and emails a 6-digit
 * code to the asking admin's own address, naming the amount and the wallet; nothing moves until that admin enters it.
 * Confirming posts one ledger entry once (`manual_top_up:<id>`): from the provider balance (`received`: money BitoCard
 * received outside its gateways, recorded under the provider `manual`) or from `adjustments` (`goodwill`), to the
 * reseller's topped-up funds (never withdrawable) or the customer's spend-only wallet. Every step is audited.
 */
@Injectable()
export class ManualTopUpsService {
  private readonly logger = new Logger('ManualTopUps');

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAuth: AdminAuthService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly stores: StoreSellers,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Asks for a top-up of a reseller's wallet (live or the sandbox, their country's currency or US dollars). */
  async requestForReseller(adminId: string, resellerId: string, input: TopUpInput) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId } });
    if (!reseller) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');
    if (reseller.house) throw invalid('house_account', "BitoCard's own store accounts are not topped up by hand.");
    const { currency } = await this.wallets.walletCurrency(resellerId, input.currency);
    return this.request(adminId, { type: 'reseller', resellerId }, { ...input, mode: input.mode ?? 'live', currency });
  }

  /** Asks for a top-up of a store customer's wallet, in the mode their store runs in (the only one they see). */
  async requestForCustomer(adminId: string, customerId: string, input: TopUpInput) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { store: { include: { reseller: true } } } });
    if (!customer) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');
    const countryCode = customer.store.id === houseStoreId ? customer.country : customer.store.reseller.country;
    if (!countryCode) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'The customer has not chosen their country yet, so they have no wallet to top up.');
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode } });
    const currency = (input.currency ?? country.currency).toUpperCase();
    if (!walletCurrencies(country.currency).includes(currency)) throw currencyNotHeld(currency);
    const mode = this.stores.mode(customer.store);
    if (input.mode && input.mode !== mode) throw invalid('mode_mismatch', `This customer's store runs in ${mode === 'live' ? 'live' : 'sandbox'} mode: their wallet can only be topped up there.`, 'mode');
    return this.request(adminId, { type: 'customer', customerId }, { ...input, mode, currency });
  }

  private async request(adminId: string, target: Target, input: TopUpInput & { mode: LedgerMode; currency: string }) {
    const admin = await this.admin(adminId);
    if (input.source === 'received' && !input.external_reference?.trim()) throw invalid('parameter_missing', 'Enter the bank transfer or payment reference of the money received.', 'external_reference');
    const id = randomUUID();
    const code = numericCode();
    const row = await this.prisma.manualTopUp.create({
      data: {
        id,
        mode: input.mode,
        resellerId: target.type === 'reseller' ? target.resellerId : null,
        customerId: target.type === 'customer' ? target.customerId : null,
        currency: input.currency,
        amountMinor: BigInt(input.amount),
        source: input.source,
        externalReference: input.external_reference?.trim() || null,
        reason: input.reason.trim(),
        requestedBy: admin.id,
        codeHash: codeDigest(id, code),
        codeExpiresAt: new Date(Date.now() + topUpCodeLifetimeMs),
        codeSentAt: new Date(),
      },
      include: withTarget,
    });
    await this.audit.record({ actorId: admin.id, action: 'wallet.manual_top_up_requested', targetType: target.type, targetId: target.type === 'reseller' ? target.resellerId : target.customerId, after: this.auditView(row) });
    await this.sendCode(admin.email, row, code);
    return { ...this.present(row, { [admin.id]: admin.name }), confirm_with: await confirmMethods(this.prisma, admin.id) };
  }

  /** A fresh code for the admin who asked, at most once a minute; the attempts start again. */
  async resendCode(adminId: string, id: string) {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code') throw notWaiting();
    if (row.codeSentAt && Date.now() - row.codeSentAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    // A few codes per request at most: each resend gives new attempts, so the sends themselves are capped.
    if (row.codeSends >= maxCodeSends) throw invalid('code_resend_limit', 'Too many codes for this request. Cancel it and start again.', 'code');
    const code = numericCode();
    const updated = await this.prisma.manualTopUp.updateMany({
      where: { id: row.id, status: 'awaiting_code', codeSends: { lt: maxCodeSends } },
      data: { codeHash: codeDigest(row.id, code), codeExpiresAt: new Date(Date.now() + topUpCodeLifetimeMs), codeAttempts: 0, codeSentAt: new Date(), codeSends: { increment: 1 } },
    });
    if (!updated.count) throw notWaiting();
    const admin = await this.admin(adminId);
    const fresh = await this.find(row.id);
    await this.sendCode(admin.email, fresh, code);
    return this.present(fresh, { [admin.id]: admin.name });
  }

  /** The admin who asked enters the emailed code: the wallet is credited once, in the same transaction as the claim. */
  /**
   * Confirms with the admin's own authenticator app (when they have one; a wrong code counts towards their sign-in
   * lockout, and a code is used once) or with the emailed code (the fallback, which every admin can use).
   */
  async confirm(adminId: string, id: string, code: string, method: ConfirmMethod = 'email') {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code' || !row.codeHash) throw notWaiting();
    if (method === 'authenticator') {
      if (!(await confirmMethods(this.prisma, adminId)).includes('authenticator')) throw invalid('authenticator_not_set_up', 'Set up your authenticator app first, or use the code we emailed you.', 'method');
      await this.adminAuth.confirmCode(adminId, code);
    } else {
      if (!row.codeExpiresAt || row.codeExpiresAt <= new Date()) throw invalid('code_expired', 'That code has expired. Ask for a new one.', 'code');
      // Claim an attempt before comparing, in one statement, so parallel guesses never get past the limit.
      const attempt = await this.prisma.manualTopUp.updateMany({ where: { id: row.id, status: 'awaiting_code', codeAttempts: { lt: maxCodeAttempts } }, data: { codeAttempts: { increment: 1 } } });
      if (!attempt.count) throw invalid('code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
      if (!sameDigest(row.codeHash, codeDigest(row.id, code))) throw invalid('code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    }

    const target = this.targetAccount(row);
    const counterpart: AccountRef = row.source === 'received' ? { kind: 'provider_balance', currency: row.currency, provider: 'manual' } : { kind: 'adjustments', currency: row.currency };
    const lines: Line[] = [
      { account: counterpart, debit: row.amountMinor },
      { account: target, credit: row.amountMinor },
    ];
    const entry = await this.ledger.prepare({
      mode: row.mode,
      type: row.source === 'goodwill' ? 'adjustment' : row.customerId ? 'customer_top_up' : 'top_up',
      reference: `manual_top_up:${row.id}`,
      // A customer's wallet is not the reseller's money: kept out of the reseller's wallet transactions.
      resellerId: row.resellerId,
      description: row.source === 'goodwill' ? 'Credit from BitoCard' : 'Top-up received by BitoCard',
      metadata: { manual_top_up_id: row.id, number: this.number(row), actor_id: adminId, source: row.source, external_reference: row.externalReference },
      lines,
    });
    const completedAt = new Date();
    const posted = await this.prisma.$transaction(async tx => {
      const claimed = await tx.manualTopUp.updateMany({ where: { id: row.id, status: 'awaiting_code', codeHash: row.codeHash }, data: { status: 'completed', codeHash: null, completedAt } });
      if (!claimed.count) throw notWaiting();
      const written = await this.ledger.write(tx, entry);
      await tx.manualTopUp.update({ where: { id: row.id }, data: { entryId: written.id } });
      return written;
    });
    const done = await this.find(row.id);
    await this.audit.record({
      actorId: adminId,
      action: 'wallet.manual_top_up',
      targetType: row.resellerId ? 'reseller' : 'customer',
      targetId: (row.resellerId ?? row.customerId)!,
      after: { ...this.auditView(done), entry_id: posted.id },
    });
    await this.notify(done);
    return this.present(done, await this.names([done]));
  }

  /** Any finance admin can cancel a top-up still waiting for its code. */
  async cancel(adminId: string, id: string) {
    const row = await this.find(id);
    const cancelled = await this.prisma.manualTopUp.updateMany({ where: { id: row.id, status: 'awaiting_code' }, data: { status: 'cancelled', codeHash: null, cancelledBy: adminId } });
    if (!cancelled.count) throw notWaiting();
    const fresh = await this.find(row.id);
    await this.audit.record({ actorId: adminId, action: 'wallet.manual_top_up_cancelled', targetType: row.resellerId ? 'reseller' : 'customer', targetId: (row.resellerId ?? row.customerId)!, after: this.auditView(fresh) });
    return this.present(fresh, await this.names([fresh]));
  }

  async list(filter: { reseller_id?: string; customer_id?: string; status?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.manualTopUp.findMany({
      where: {
        ...(filter.reseller_id ? { resellerId: filter.reseller_id } : {}),
        ...(filter.customer_id ? { customerId: filter.customer_id } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: withTarget,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const names = await this.names(page);
    return { object: 'list' as const, data: page.map(row => this.present(row, names)), has_more: rows.length > limit };
  }

  async get(id: string) {
    const row = await this.find(id);
    return this.present(row, await this.names([row]));
  }

  private targetAccount(row: ManualTopUp): AccountRef {
    return row.customerId
      ? { kind: 'customer_wallet', currency: row.currency, customerId: row.customerId }
      : { kind: 'reseller_funding', currency: row.currency, resellerId: row.resellerId! };
  }

  private async notify(row: Row) {
    const amount = formatMoney(row.amountMinor, row.currency);
    if (row.customer) {
      await this.inbox.customer({ customerId: row.customer.id, storeId: row.customer.storeId }, 'customer.wallet.credited', {
        subject: `manual_top_up:${row.id}`,
        title: `${amount} added to your wallet`,
        body: row.source === 'received' ? 'Your payment has been received and added to your wallet.' : `${row.customer.store.name} added this to your wallet.`,
        link: '/account/wallet',
        mode: row.mode,
      });
    } else if (row.resellerId) {
      await this.inbox.reseller(row.resellerId, 'top_up.credited', {
        subject: `manual_top_up:${row.id}`,
        title: `${amount} added to your wallet`,
        body: row.source === 'received' ? 'BitoCard received your payment and added it to your wallet.' : 'BitoCard added this to your wallet.',
        link: '/wallet',
        mode: row.mode,
      });
    }
    await this.inbox.admins('admin.wallet.manual_top_up', {
      subject: row.id,
      title: `${amount} added by hand to ${row.reseller?.name ?? row.customer?.name ?? 'a wallet'}`,
      body: `${this.number(row)} (${row.source === 'received' ? 'money received' : 'goodwill credit'}): ${row.reason}`,
      link: row.resellerId ? `/resellers/${row.resellerId}` : `/storefront/customers/${row.customerId}`,
      mode: row.mode,
    });
  }

  private async sendCode(to: string, row: Row, code: string) {
    // A code that cannot be sent leaves the top-up waiting: the admin asks for another, nothing has moved.
    await this.email
      .send(
        manualTopUpCodeEmail(to, {
          code,
          number: this.number(row),
          amount: formatMoney(row.amountMinor, row.currency),
          target: row.reseller ? `${row.reseller.name} (reseller)` : `${row.customer?.name} <${row.customer?.email}> at ${row.customer?.store.name}`,
          source: row.source as TopUpSource,
          sandbox: row.mode === 'test',
        }),
      )
      .catch(error => this.logger.warn({ err: error, top_up: row.id }, 'Could not email the top-up code'));
  }

  private async admin(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { id: true, email: true, name: true, realm: true } });
    if (!admin || admin.realm !== 'admin') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'admin_required', 'Only a signed-in admin can top up wallets.');
    return admin;
  }

  private async find(id: string) {
    const row = await this.prisma.manualTopUp.findUnique({ where: { id }, include: withTarget });
    if (!row) throw notFound();
    return row;
  }

  /** Only the admin who asked can confirm or resend: the code went to them. */
  private async own(adminId: string, id: string) {
    const row = await this.find(id);
    if (row.requestedBy !== adminId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_requester', 'Only the admin who asked for this top-up can confirm it.');
    return row;
  }

  private async names(rows: ManualTopUp[]) {
    const ids = [...new Set(rows.flatMap(row => [row.requestedBy, row.cancelledBy].filter((value): value is string => Boolean(value))))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    return Object.fromEntries(users.map(user => [user.id, user.name])) as Record<string, string>;
  }

  private number(row: Pick<ManualTopUp, 'number'>) {
    return `MT-${String(row.number).padStart(6, '0')}`;
  }

  private auditView(row: ManualTopUp) {
    return { id: row.id, number: this.number(row), mode: row.mode, currency: row.currency, amount: minor(row.amountMinor), source: row.source, external_reference: row.externalReference, reason: row.reason, status: row.status };
  }

  present(row: Row, names: Record<string, string>) {
    const expired = row.status === 'awaiting_code' && Boolean(row.codeExpiresAt && row.codeExpiresAt <= new Date());
    return {
      object: 'manual_top_up' as const,
      id: row.id,
      number: this.number(row),
      mode: row.mode,
      target: row.reseller
        ? { type: 'reseller' as const, id: row.reseller.id, name: row.reseller.name, email: null, store: null }
        : { type: 'customer' as const, id: row.customer!.id, name: row.customer!.name, email: row.customer!.email, store: row.customer!.store.name },
      currency: row.currency,
      amount: minor(row.amountMinor),
      source: row.source as TopUpSource,
      external_reference: row.externalReference,
      reason: row.reason,
      /** awaiting_code, expired (its code ran out: resend or cancel), completed or cancelled. */
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
