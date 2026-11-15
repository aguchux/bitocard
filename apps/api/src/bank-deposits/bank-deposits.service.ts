import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CustomerWalletsService } from '../checkout/customer-wallets.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { BankDeposit, DepositBankAccount, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { currencyNotHeld } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { SettingsService } from '../settings/settings.service.js';

/** How long a request waits for the customer to pay and say so; once they say they paid it never expires. */
export const depositWindowMs = 72 * 60 * 60_000;
/** Requests one customer may have open (waiting for payment or for finance) at once. */
export const maxOpenDeposits = 3;
export const minDepositMinor = 100;
export const maxDepositMinor = 100_000_000_00;
const open = ['awaiting_payment', 'sent'];

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const missing = (what = 'bank deposit') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

export const depositNumber = (n: number) => `BD-${String(n).padStart(6, '0')}`;
/** A reference that is easy to read out and type: no 0, O, 1, I or L. */
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function depositReference() {
  const bytes = randomBytes(8);
  return `BC${Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')}`;
}

type Row = BankDeposit & { customer?: { id: string; name: string; email: string; store: { name: string } } };

/**
 * Bank deposits: where a market's `bank_deposits` switch is on and Golojan has a receiving account in the wallet's
 * currency, a customer asks to top up by paying cash into, or transferring to, that account. They are given the
 * account and a reference to write on the slip or transfer, then say they sent it ("I've sent it"). Finance checks
 * Golojan's bank and credits what actually arrived, once (`bank_deposit:<id>`, from the provider balance under
 * `bank_deposit` to the customer's wallet), or rejects it saying why. Nothing is credited on the customer's word.
 */
@Injectable()
export class BankDepositsService {
  private readonly logger = new Logger(BankDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: CustomerWalletsService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // Customers.

  /**
   * Whether the customer can top this wallet up by bank deposit, and into which accounts: their own market's, in the
   * wallet's currency, while the market's switch is on and the store uses wallets.
   */
  async options(customer: CustomerWithStore, asked?: string) {
    const { home, held, context } = await this.wallets.walletsOf(customer);
    const currency = (asked ?? home).toUpperCase();
    if (!held.includes(currency)) throw currencyNotHeld(currency);
    const on = (await this.settings.isOnForCountry('bank_deposits', context.country.code)) && (await this.wallets.enabled(context.seller, context.mode, context.store));
    const accounts = on ? await this.prisma.depositBankAccount.findMany({ where: { country: context.country.code, currency, active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }) : [];
    return {
      object: 'bank_deposit_options' as const,
      country: context.country.code,
      currency,
      available: accounts.length > 0,
      accounts: accounts.map(presentAccount),
      min_amount: minDepositMinor,
      window_hours: depositWindowMs / 3_600_000,
    };
  }

  async create(customer: CustomerWithStore, input: { currency?: string; amount: number; account_id?: string }) {
    if (!customer.emailVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    const options = await this.options(customer, input.currency);
    if (!options.available) throw conflict('bank_deposits_unavailable', 'Bank deposits are not available for this wallet. Choose another way to add money.', 'currency');
    const account = input.account_id ? options.accounts.find(item => item.id === input.account_id) : options.accounts[0];
    if (!account) throw invalid('parameter_invalid', 'Choose one of the bank accounts shown.', 'account_id');
    await this.expireDue({ customerId: customer.id });
    const waiting = await this.prisma.bankDeposit.count({ where: { customerId: customer.id, status: { in: open } } });
    if (waiting >= maxOpenDeposits) throw conflict('too_many_deposits', `You have ${waiting} bank deposits waiting. Finish or cancel one before starting another.`);
    const { context } = await this.wallets.walletsOf(customer);
    const row = await this.prisma.bankDeposit.create({
      data: {
        mode: context.mode,
        customerId: customer.id,
        storeId: customer.storeId,
        accountId: account.id,
        country: options.country,
        currency: options.currency,
        amountMinor: BigInt(input.amount),
        reference: depositReference(),
        bankName: account.bank_name,
        accountName: account.account_name,
        accountNumber: account.account_number,
        details: account.details,
        expiresAt: new Date(Date.now() + depositWindowMs),
      },
    });
    return this.present(row);
  }

  async list(customer: CustomerWithStore) {
    await this.expireDue({ customerId: customer.id });
    const rows = await this.prisma.bankDeposit.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 25 });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  async get(customer: CustomerWithStore, id: string) {
    await this.expireDue({ customerId: customer.id });
    return this.present(await this.own(customer, id));
  }

  /** "I've sent it": finance is told to check the bank. Only while it waits for payment and before it expires. */
  async markSent(customer: CustomerWithStore, id: string, input: { method: 'cash' | 'transfer'; sender_name: string; note?: string }) {
    const row = await this.own(customer, id);
    const claimed = await this.prisma.bankDeposit.updateMany({
      where: { id: row.id, status: 'awaiting_payment', expiresAt: { gt: new Date() } },
      data: { status: 'sent', method: input.method, senderName: input.sender_name.trim(), senderNote: input.note?.trim() || null, sentAt: new Date() },
    });
    if (!claimed.count) throw conflict('deposit_not_waiting', row.status === 'awaiting_payment' ? 'This request has expired. Start a new one.' : 'This deposit is not waiting for payment.');
    const fresh = await this.find(row.id);
    await this.inbox.admins('admin.wallet.bank_deposit_sent', {
      subject: fresh.id,
      title: `${formatMoney(fresh.amountMinor, fresh.currency)} bank deposit to check`,
      body: `${depositNumber(fresh.number)}: ${fresh.senderName} says they ${fresh.method === 'cash' ? 'paid cash into' : 'transferred to'} ${fresh.bankName} ${fresh.accountNumber}, reference ${fresh.reference}.`,
      link: `/orders/bank-deposits?status=sent`,
      mode: fresh.mode,
    });
    return this.present(fresh);
  }

  async cancel(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    const cancelled = await this.prisma.bankDeposit.updateMany({ where: { id: row.id, status: 'awaiting_payment' }, data: { status: 'cancelled' } });
    if (!cancelled.count) throw conflict('deposit_not_waiting', 'Only a deposit you have not said you sent can be cancelled.');
    return this.present(await this.find(row.id));
  }

  // Admins.

  async accounts(country?: string) {
    const rows = await this.prisma.depositBankAccount.findMany({ where: country ? { country: country.toUpperCase() } : {}, orderBy: [{ country: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] });
    return { object: 'list' as const, data: rows.map(presentAccount) };
  }

  async createAccount(adminId: string, input: AccountInput & { country: string }) {
    const country = await this.prisma.country.findUnique({ where: { code: input.country.toUpperCase() } });
    if (!country) throw invalid('market_unavailable', 'Choose one of BitoCard markets.', 'country');
    const row = await this.prisma.depositBankAccount.create({
      data: {
        country: country.code,
        currency: (input.currency ?? country.currency).toUpperCase(),
        bankName: input.bank_name!.trim(),
        accountName: input.account_name!.trim(),
        accountNumber: input.account_number!.trim(),
        details: input.details?.trim() || null,
        active: input.active ?? true,
        position: input.position ?? 0,
      },
    });
    await this.audit.record({ actorId: adminId, action: 'bank_deposit_account.created', targetType: 'deposit_bank_account', targetId: row.id, after: presentAccount(row) });
    return presentAccount(row);
  }

  async updateAccount(adminId: string, id: string, input: AccountInput) {
    const before = await this.prisma.depositBankAccount.findUnique({ where: { id } });
    if (!before) throw missing('bank account');
    const row = await this.prisma.depositBankAccount.update({
      where: { id },
      data: {
        ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
        ...(input.bank_name ? { bankName: input.bank_name.trim() } : {}),
        ...(input.account_name ? { accountName: input.account_name.trim() } : {}),
        ...(input.account_number ? { accountNumber: input.account_number.trim() } : {}),
        ...(input.details !== undefined ? { details: input.details?.trim() || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    await this.audit.record({ actorId: adminId, action: 'bank_deposit_account.updated', targetType: 'deposit_bank_account', targetId: id, before: presentAccount(before), after: presentAccount(row) });
    return presentAccount(row);
  }

  /** Removes an account: requests already made keep the details they were shown. */
  async deleteAccount(adminId: string, id: string) {
    const before = await this.prisma.depositBankAccount.findUnique({ where: { id } });
    if (!before) throw missing('bank account');
    await this.prisma.depositBankAccount.delete({ where: { id } });
    await this.audit.record({ actorId: adminId, action: 'bank_deposit_account.deleted', targetType: 'deposit_bank_account', targetId: id, before: presentAccount(before) });
    return { object: 'deposit_bank_account' as const, id, deleted: true };
  }

  async adminList(filter: { status?: string; country?: string; q?: string; limit?: number }) {
    await this.expireDue({});
    const q = filter.q?.trim();
    const number = q?.match(/^BD-?0*(\d+)$/i)?.[1];
    const rows = await this.prisma.bankDeposit.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.country ? { country: filter.country.toUpperCase() } : {}),
        ...(q
          ? {
              OR: [
                ...(number ? [{ number: Number(number) }] : []),
                { reference: { contains: q, mode: 'insensitive' as const } },
                { senderName: { contains: q, mode: 'insensitive' as const } },
                { customer: { email: { contains: q, mode: 'insensitive' as const } } },
                { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: withCustomer,
      // Oldest first while it waits on finance, so nobody is left behind; newest first otherwise.
      orderBy: filter.status === 'sent' ? { sentAt: 'asc' } : { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
    const names = await this.names(rows);
    return { object: 'list' as const, data: rows.map(row => this.presentAdmin(row, names)) };
  }

  async adminGet(id: string) {
    const row = await this.prisma.bankDeposit.findUnique({ where: { id }, include: withCustomer });
    if (!row) throw missing();
    return this.presentAdmin(row, await this.names([row]));
  }

  /**
   * Finance found the money in Golojan's bank: credits the customer's wallet with what arrived (by default what they
   * asked to add), once, in the same transaction that claims the request. A request still waiting or expired can be
   * credited too (the customer may have paid without saying so).
   */
  async credit(adminId: string, id: string, input: { amount?: number; external_reference?: string; note?: string }) {
    const row = await this.prisma.bankDeposit.findUnique({ where: { id } });
    if (!row) throw missing();
    if (!['awaiting_payment', 'sent', 'expired'].includes(row.status)) throw conflict('deposit_closed', 'This deposit has already been decided.');
    const amount = BigInt(input.amount ?? Number(row.amountMinor));
    const entry = await this.ledger.prepare({
      mode: row.mode,
      type: 'customer_top_up',
      reference: `bank_deposit:${row.id}`,
      resellerId: null,
      description: 'Bank deposit received by BitoCard',
      metadata: { bank_deposit_id: row.id, number: depositNumber(row.number), reference: row.reference, external_reference: input.external_reference ?? null, actor_id: adminId },
      lines: [
        { account: { kind: 'provider_balance', currency: row.currency, provider: 'bank_deposit' }, debit: amount },
        { account: { kind: 'customer_wallet', currency: row.currency, customerId: row.customerId }, credit: amount },
      ],
    });
    const decidedAt = new Date();
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.bankDeposit.updateMany({
        where: { id: row.id, status: { in: ['awaiting_payment', 'sent', 'expired'] } },
        data: { status: 'credited', creditedAmountMinor: amount, externalReference: input.external_reference?.trim() || null, decisionNote: input.note?.trim() || null, decidedBy: adminId, decidedAt },
      });
      if (!claimed.count) throw conflict('deposit_closed', 'This deposit has already been decided.');
      const written = await this.ledger.write(tx, entry);
      await tx.bankDeposit.update({ where: { id: row.id }, data: { entryId: written.id } });
    });
    const done = await this.find(row.id);
    await this.audit.record({ actorId: adminId, action: 'bank_deposit.credited', targetType: 'customer', targetId: row.customerId, after: this.auditView(done) });
    const credited = formatMoney(amount, row.currency);
    await this.inbox.customer({ customerId: row.customerId, storeId: row.storeId }, 'customer.wallet.credited', {
      subject: `bank_deposit:${row.id}`,
      title: `${credited} added to your wallet`,
      body: amount === row.amountMinor ? `Your bank deposit ${row.reference} has arrived.` : `Your bank deposit ${row.reference} has arrived: ${credited} was received, so that is what we added.`,
      link: `/account/wallet/deposits/${row.id}`,
      mode: row.mode,
    });
    return this.adminGet(row.id);
  }

  /** Nothing matching arrived (or it cannot be accepted): the customer is told why. */
  async reject(adminId: string, id: string, reason: string) {
    const row = await this.prisma.bankDeposit.findUnique({ where: { id } });
    if (!row) throw missing();
    const rejected = await this.prisma.bankDeposit.updateMany({
      where: { id: row.id, status: { in: ['awaiting_payment', 'sent', 'expired'] } },
      data: { status: 'rejected', decisionNote: reason.trim(), decidedBy: adminId, decidedAt: new Date() },
    });
    if (!rejected.count) throw conflict('deposit_closed', 'This deposit has already been decided.');
    const done = await this.find(row.id);
    await this.audit.record({ actorId: adminId, action: 'bank_deposit.rejected', targetType: 'customer', targetId: row.customerId, after: this.auditView(done) });
    await this.inbox.customer({ customerId: row.customerId, storeId: row.storeId }, 'customer.wallet.bank_deposit_rejected', {
      subject: `bank_deposit:${row.id}`,
      title: `Bank deposit ${row.reference} not credited`,
      body: reason.trim(),
      link: `/account/wallet/deposits/${row.id}`,
      mode: row.mode,
    });
    return this.adminGet(row.id);
  }

  /** Requests nobody said they paid by the end of their window expire (finance can still credit them). */
  async expireDue(where: { customerId?: string }) {
    const expired = await this.prisma.bankDeposit.updateMany({ where: { ...where, status: 'awaiting_payment', expiresAt: { lte: new Date() } }, data: { status: 'expired' } });
    return { expired: expired.count };
  }

  async job() {
    return this.expireDue({});
  }

  private async find(id: string) {
    const row = await this.prisma.bankDeposit.findUnique({ where: { id } });
    if (!row) throw missing();
    return row;
  }

  private async own(customer: CustomerWithStore, id: string) {
    const row = await this.prisma.bankDeposit.findFirst({ where: { id, customerId: customer.id } });
    if (!row) throw missing();
    return row;
  }

  private async names(rows: BankDeposit[]) {
    const ids = [...new Set(rows.map(row => row.decidedBy).filter((value): value is string => Boolean(value)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    return Object.fromEntries(users.map(user => [user.id, user.name])) as Record<string, string>;
  }

  private auditView(row: BankDeposit) {
    return { id: row.id, number: depositNumber(row.number), mode: row.mode, currency: row.currency, amount: minor(row.amountMinor), credited: row.creditedAmountMinor === null ? null : minor(row.creditedAmountMinor), reference: row.reference, status: row.status, note: row.decisionNote, external_reference: row.externalReference };
  }

  present(row: BankDeposit) {
    return {
      object: 'bank_deposit' as const,
      id: row.id,
      number: depositNumber(row.number),
      mode: row.mode,
      /** awaiting_payment, sent (finance is checking), credited, rejected, cancelled or expired. */
      status: row.status as 'awaiting_payment' | 'sent' | 'credited' | 'rejected' | 'cancelled' | 'expired',
      currency: row.currency,
      amount: minor(row.amountMinor),
      credited_amount: row.creditedAmountMinor === null ? null : minor(row.creditedAmountMinor),
      reference: row.reference,
      account: { bank_name: row.bankName, account_name: row.accountName, account_number: row.accountNumber, details: row.details },
      method: row.method as 'cash' | 'transfer' | null,
      sender_name: row.senderName,
      note: row.senderNote,
      /** Why it was not credited (rejected), or finance's note. */
      decision_note: row.decisionNote,
      expires_at: row.expiresAt.toISOString(),
      sent_at: row.sentAt?.toISOString() ?? null,
      decided_at: row.decidedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }

  private presentAdmin(row: Row, names: Record<string, string>) {
    return {
      ...this.present(row),
      country: row.country,
      external_reference: row.externalReference,
      customer: row.customer ? { id: row.customer.id, name: row.customer.name, email: row.customer.email, store: row.customer.store.name } : null,
      decided_by: row.decidedBy ? { id: row.decidedBy, name: names[row.decidedBy] ?? null } : null,
    };
  }
}

const withCustomer = { customer: { select: { id: true, name: true, email: true, store: { select: { name: true } } } } } satisfies Prisma.BankDepositInclude;

type AccountInput = { currency?: string; bank_name?: string; account_name?: string; account_number?: string; details?: string | null; active?: boolean; position?: number };

export function presentAccount(row: DepositBankAccount) {
  return {
    object: 'deposit_bank_account' as const,
    id: row.id,
    country: row.country,
    currency: row.currency,
    bank_name: row.bankName,
    account_name: row.accountName,
    account_number: row.accountNumber,
    details: row.details,
    active: row.active,
    position: row.position,
  };
}
