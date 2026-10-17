import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { HouseService } from '../../checkout/house.service.js';
import { numericCode, sameDigest, sha256 } from '../../common/crypto.js';
import { ApiError } from '../../common/errors/api-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { LedgerMode, ReserveMovement } from '../../generated/prisma/client.js';
import { type AccountRef, LedgerService } from '../../ledger/ledger.service.js';
import { EmailService } from '../../notifications/email.service.js';
import { reserveMovementCodeEmail } from '../../notifications/templates.js';
import { fromUnits, toUnits } from '../amounts.js';
import { cryptoReserveRef, fiatReserveRef } from './exchange.service.js';

const minute = 60_000;
/** The emailed code works for 10 minutes: this moves money. */
const codeLifetimeMs = 10 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;
/** Fiat amounts are entered in the currency's main unit with two decimals. */
const fiatDecimals = 2;

export type ReserveKind = 'fund' | 'withdraw';
export type ReserveType = 'fiat' | 'crypto';

const codeDigest = (id: string, code: string) => sha256(`reserve_movement:${id}:${code}`);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reserve movement.');
const notWaiting = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'movement_not_awaiting_code', 'This movement is not waiting for a code.');
const short = () => new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'reserve_insufficient', 'The reserve holds less than this.', 'amount');

type Input = { mode: LedgerMode; kind: ReserveKind; reserve: ReserveType; country?: string; currency?: string; asset?: string; amount: string; external_reference?: string; reason: string };

/**
 * Finance funding and drawing down BitoCard's exchange reserves, each confirmed by a code emailed to the admin who
 * asked (as manual top-ups are). Money reserves sit on each market's house account and come from (or go back to) the
 * provider balance under `manual` (money BitoCard holds in its bank); coin reserves sit on the root house account and
 * come from `crypto_custody` (coins BitoCard holds on chain, so the daily custody check catches a mistaken entry).
 */
@Injectable()
export class ReservesService {
  private readonly logger = new Logger('ExchangeReserves');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly house: HouseService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async request(adminId: string, input: Input) {
    const admin = await this.admin(adminId);
    const target = await this.target(input);
    const amount = toUnits(input.amount, target.decimals);
    if (amount <= 0n) throw invalid('parameter_invalid', 'Enter an amount above zero.', 'amount');
    if (input.reserve === 'fiat' && input.kind === 'fund' && !input.external_reference?.trim()) {
      throw invalid('parameter_missing', 'Enter the bank transfer reference of the money put aside for the reserve.', 'external_reference');
    }
    if (input.kind === 'withdraw' && (await this.held(input.mode, target)) < amount) throw short();
    const id = randomUUID();
    const code = numericCode();
    const row = await this.prisma.reserveMovement.create({
      data: {
        id,
        mode: input.mode,
        kind: input.kind,
        reserve: input.reserve,
        currency: target.currency,
        country: target.country,
        amount,
        externalReference: input.external_reference?.trim() || null,
        reason: input.reason.trim(),
        requestedBy: admin.id,
        codeHash: codeDigest(id, code),
        codeExpiresAt: new Date(Date.now() + codeLifetimeMs),
        codeSentAt: new Date(),
      },
    });
    await this.audit.record({ actorId: admin.id, action: 'exchange.reserve_movement_requested', targetType: 'reserve_movement', targetId: row.id, after: this.view(row) });
    const decimals = await this.decimals();
    await this.sendCode(admin.email, row, code, decimals);
    return this.present(row, { [admin.id]: admin.name }, decimals);
  }

  async resendCode(adminId: string, id: string) {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code') throw notWaiting();
    if (row.codeSentAt && Date.now() - row.codeSentAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const code = numericCode();
    const updated = await this.prisma.reserveMovement.updateMany({
      where: { id: row.id, status: 'awaiting_code' },
      data: { codeHash: codeDigest(row.id, code), codeExpiresAt: new Date(Date.now() + codeLifetimeMs), codeAttempts: 0, codeSentAt: new Date() },
    });
    if (!updated.count) throw notWaiting();
    const admin = await this.admin(adminId);
    const fresh = await this.find(row.id);
    const decimals = await this.decimals();
    await this.sendCode(admin.email, fresh, code, decimals);
    return this.present(fresh, { [admin.id]: admin.name }, decimals);
  }

  /** The admin who asked enters the code: the reserve moves once, claimed in the same transaction as the entry. */
  async confirm(adminId: string, id: string, code: string) {
    const row = await this.own(adminId, id);
    if (row.status !== 'awaiting_code' || !row.codeHash) throw notWaiting();
    if (!row.codeExpiresAt || row.codeExpiresAt <= new Date()) throw invalid('code_expired', 'That code has expired. Ask for a new one.', 'code');
    // Claim an attempt before comparing, in one statement, so parallel guesses never get past the limit.
    const attempt = await this.prisma.reserveMovement.updateMany({ where: { id: row.id, status: 'awaiting_code', codeAttempts: { lt: maxCodeAttempts } }, data: { codeAttempts: { increment: 1 } } });
    if (!attempt.count) throw invalid('code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    if (!sameDigest(row.codeHash, codeDigest(row.id, code))) throw invalid('code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');

    const reserve = row.reserve === 'fiat' ? fiatReserveRef((await this.house.resellerFor(row.country!)).id, row.currency) : cryptoReserveRef(row.currency);
    const outside: AccountRef = row.reserve === 'fiat' ? { kind: 'provider_balance', currency: row.currency, provider: 'manual' } : { kind: 'crypto_custody', currency: row.currency };
    const funding = row.kind === 'fund';
    const decimals = await this.decimals();
    const entry = await this.ledger.prepare({
      mode: row.mode,
      type: funding ? 'reserve_fund' : 'reserve_withdraw',
      reference: `reserve_movement:${row.id}`,
      resellerId: null,
      description: `${funding ? 'Exchange reserve funded' : 'Exchange reserve drawn down'}: ${this.amount(row, decimals)} ${row.currency} (${this.number(row)})`,
      metadata: { reserve_movement_id: row.id, actor_id: adminId, external_reference: row.externalReference },
      lines: funding
        ? [{ account: outside, debit: row.amount }, { account: reserve, credit: row.amount }]
        : [{ account: reserve, debit: row.amount }, { account: outside, credit: row.amount }],
    });
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.reserveMovement.updateMany({ where: { id: row.id, status: 'awaiting_code', codeHash: row.codeHash }, data: { status: 'completed', codeHash: null, completedAt: new Date() } });
        if (!claimed.count) throw notWaiting();
        const written = await this.ledger.write(tx, entry);
        await tx.reserveMovement.update({ where: { id: row.id }, data: { entryId: written.id } });
      });
    } catch (error) {
      // Drawing down more than the reserve now holds (trades since the request): nothing moved, it waits.
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw short();
      throw error;
    }
    const done = await this.find(row.id);
    await this.audit.record({ actorId: adminId, action: funding ? 'exchange.reserve_funded' : 'exchange.reserve_withdrawn', targetType: 'reserve_movement', targetId: row.id, after: this.view(done) });
    return this.present(done, await this.names([done]), decimals);
  }

  async cancel(adminId: string, id: string) {
    const row = await this.find(id);
    const cancelled = await this.prisma.reserveMovement.updateMany({ where: { id: row.id, status: 'awaiting_code' }, data: { status: 'cancelled', codeHash: null, cancelledBy: adminId } });
    if (!cancelled.count) throw notWaiting();
    const fresh = await this.find(row.id);
    await this.audit.record({ actorId: adminId, action: 'exchange.reserve_movement_cancelled', targetType: 'reserve_movement', targetId: row.id, after: this.view(fresh) });
    return this.present(fresh, await this.names([fresh]), await this.decimals());
  }

  async list(filter: { mode?: LedgerMode; status?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.reserveMovement.findMany({
      where: { ...(filter.mode ? { mode: filter.mode } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const [names, decimals] = await Promise.all([this.names(page), this.decimals()]);
    return { object: 'list' as const, data: page.map(row => this.present(row, names, decimals)), has_more: rows.length > limit };
  }

  /** What the reserve moves: a coin (any, even switched off) or a market's money. */
  private async target(input: Input) {
    if (input.reserve === 'crypto') {
      const asset = input.asset ? await this.prisma.cryptoAsset.findUnique({ where: { code: input.asset.toUpperCase() } }) : null;
      if (!asset) throw invalid('asset_unavailable', 'Choose a coin.', 'asset');
      return { currency: asset.code, country: null, decimals: asset.decimals };
    }
    const country = input.country ? await this.prisma.country.findUnique({ where: { code: input.country.toUpperCase() } }) : null;
    if (!country) throw invalid('market_unavailable', 'Choose a market.', 'country');
    const currency = input.currency?.toUpperCase() ?? country.currency;
    if (![country.currency, 'USD'].includes(currency)) throw invalid('currency_unsupported', 'Use this market’s local currency or US dollars.', 'currency');
    return { currency, country: country.code, decimals: fiatDecimals };
  }

  private async held(mode: LedgerMode, target: { currency: string; country: string | null }) {
    const ownerId = target.country ? (await this.prisma.reseller.findFirst({ where: { house: true, country: target.country }, select: { id: true } }))?.id : (cryptoReserveRef(target.currency).resellerId as string);
    if (!ownerId) return 0n;
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: target.country ? 'reserve_fiat' : 'reserve_crypto', mode, currency: target.currency, resellerId: ownerId }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  private async sendCode(to: string, row: ReserveMovement, code: string, decimals: Map<string, number>) {
    await this.email
      .send(reserveMovementCodeEmail(to, { code, number: this.number(row), action: row.kind as ReserveKind, amount: `${this.amount(row, decimals)} ${row.currency}`, reserve: row.reserve === 'fiat' ? `${row.country} money reserve` : `${row.currency} coin reserve`, sandbox: row.mode === 'test' }))
      .catch(error => this.logger.warn({ err: error, movement: row.id }, 'Could not email the reserve code'));
  }

  private async admin(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { id: true, email: true, name: true, realm: true } });
    if (!admin || admin.realm !== 'admin') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'admin_required', 'Only a signed-in admin can move reserves.');
    return admin;
  }

  private async find(id: string) {
    const row = await this.prisma.reserveMovement.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  private async own(adminId: string, id: string) {
    const row = await this.find(id);
    if (row.requestedBy !== adminId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_requester', 'Only the admin who asked for this can confirm it.');
    return row;
  }

  private async names(rows: ReserveMovement[]) {
    const ids = [...new Set(rows.flatMap(row => [row.requestedBy, row.cancelledBy].filter((value): value is string => Boolean(value))))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    return Object.fromEntries(users.map(user => [user.id, user.name])) as Record<string, string>;
  }

  /** Every coin's decimal places (money has two). */
  private async decimals() {
    const assets = await this.prisma.cryptoAsset.findMany({ select: { code: true, decimals: true } });
    return new Map(assets.map(asset => [asset.code, asset.decimals]));
  }

  /** The amount as a decimal string: money with two places, coins with their asset's. */
  private amount(row: ReserveMovement, decimals: Map<string, number>) {
    return fromUnits(row.amount, row.reserve === 'fiat' ? fiatDecimals : (decimals.get(row.currency) ?? 8));
  }

  private number(row: Pick<ReserveMovement, 'number'>) {
    return `RM-${String(row.number).padStart(6, '0')}`;
  }

  private view(row: ReserveMovement) {
    return { id: row.id, number: this.number(row), mode: row.mode, kind: row.kind, reserve: row.reserve, currency: row.currency, country: row.country, amount: row.amount.toString(), external_reference: row.externalReference, reason: row.reason, status: row.status };
  }

  private present(row: ReserveMovement, names: Record<string, string>, decimals: Map<string, number>) {
    const expired = row.status === 'awaiting_code' && Boolean(row.codeExpiresAt && row.codeExpiresAt <= new Date());
    return {
      object: 'reserve_movement' as const,
      id: row.id,
      number: this.number(row),
      mode: row.mode,
      kind: row.kind as ReserveKind,
      reserve: row.reserve as ReserveType,
      currency: row.currency,
      country: row.country,
      /** A decimal string: money with two places, coins with their own. */
      amount: this.amount(row, decimals),
      status: expired ? ('expired' as const) : (row.status as 'awaiting_code' | 'completed' | 'cancelled'),
      external_reference: row.externalReference,
      reason: row.reason,
      requested_by: { id: row.requestedBy, name: names[row.requestedBy] ?? null },
      code_expires_at: row.status === 'awaiting_code' ? (row.codeExpiresAt?.toISOString() ?? null) : null,
      code_sent_at: row.status === 'awaiting_code' ? (row.codeSentAt?.toISOString() ?? null) : null,
      created_at: row.createdAt.toISOString(),
      completed_at: row.completedAt?.toISOString() ?? null,
    };
  }
}
