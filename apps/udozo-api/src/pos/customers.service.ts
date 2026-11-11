import { HttpStatus, Injectable } from '@nestjs/common';
import { normalisePhone } from '../auth/auth.service.js';
import { ReviewStatsService } from '../classifieds/reviews/stats.service.js';
import { SellerScoreReader } from '../classifieds/scores/reader.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type PosCustomer } from '../generated/prisma/client.js';
import { ownerBy, type PosBy } from './actor.js';
import { recordedPaymentMethods, type RecordedPaymentMethod } from './sale-rules.js';

export type CustomerFields = { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; credit_limit?: number | null };
export type CustomersFilter = { q?: string; owing?: boolean; limit?: number; offset?: number };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
export const customerUnknown = (param?: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'customer_unknown', 'There is no such customer at your shop.', param);
const customerNumber = (n: number) => `C-${String(n).padStart(6, '0')}`;
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Db = Prisma.TransactionClient | PrismaService;
/** The Udozo account a buyer paid through: what the shop's record copies (their name and confirmed mobile, never more). */
export type UdozoBuyer = { id: string; name: string; phone: string | null; phoneVerifiedAt: Date | null };

/**
 * A POS shop's customers (docs/UDOZO_POS_PLAN.md): the shop's own records, needing no Udozo account. The cashier adds
 * one at the till, or the owner in the dashboard; a Udozo customer paying through Udozo is added on the way, linked to
 * their account (which stays as it is) with their name and confirmed mobile only. Each keeps its sales and what it owes
 * for goods sold on credit (pay later), repaid at the counter. Udozo's admins read them under the POS account.
 */
@Injectable()
export class PosCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewStatsService,
    private readonly scores: SellerScoreReader,
  ) {}

  private async account(owner: CustomerWithStore) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: owner.id }, select: { id: true, country: true, currency: true } });
    if (!account) throw noAccount();
    return account;
  }

  /** A customer of this account, else not found. */
  async own(db: Db, accountId: string, id: string, param?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw customerUnknown(param);
    const row = await db.posCustomer.findFirst({ where: { id, accountId } });
    if (!row) throw customerUnknown(param);
    return row;
  }

  private fields(input: CustomerFields, country: string, creating: boolean) {
    const name = input.name !== undefined ? text(input.name, 120) : undefined;
    if (creating || input.name !== undefined) {
      if (!name) throw invalid('parameter_missing', 'Give the customer’s name.', 'name');
    }
    const email = input.email !== undefined ? text(input.email, 254)?.toLowerCase() ?? null : undefined;
    if (email && !emailPattern.test(email)) throw invalid('parameter_invalid', 'That email address does not look right.', 'email');
    const phone = input.phone !== undefined ? (text(input.phone, 30) ? normalisePhone(input.phone!.trim(), country) : null) : undefined;
    if (input.credit_limit !== undefined && input.credit_limit !== null && (!Number.isSafeInteger(input.credit_limit) || input.credit_limit < 0)) throw invalid('parameter_invalid', 'A credit limit is an amount from nothing up.', 'credit_limit');
    return {
      ...(name !== undefined && name !== null ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(input.address !== undefined ? { address: text(input.address, 300) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() ? input.notes.trim().slice(0, 1000) : null } : {}),
      ...(input.credit_limit !== undefined ? { creditLimitMinor: input.credit_limit === null ? null : BigInt(input.credit_limit) } : {}),
    };
  }

  private phoneTaken(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('customer_phone_taken', 'Another of your customers has this mobile number.', 'phone');
    throw error;
  }

  async create(owner: CustomerWithStore, input: CustomerFields) {
    const account = await this.account(owner);
    const data = this.fields(input, account.country, true);
    try {
      const row = await this.prisma.posCustomer.create({ data: { accountId: account.id, name: data.name!, ...data } });
      return this.present(row, account.country);
    } catch (error) {
      return this.phoneTaken(error);
    }
  }

  async update(owner: CustomerWithStore, id: string, input: CustomerFields) {
    const account = await this.account(owner);
    await this.own(this.prisma, account.id, id);
    const data = this.fields(input, account.country, false);
    try {
      return this.present(await this.prisma.posCustomer.update({ where: { id }, data }), account.country);
    } catch (error) {
      return this.phoneTaken(error);
    }
  }

  /** Only a customer with no sales and nothing owed; one with history stays for the shop's records. */
  async remove(owner: CustomerWithStore, id: string) {
    const account = await this.account(owner);
    const row = await this.own(this.prisma, account.id, id);
    if (row.salesCount > 0 || row.owedMinor > 0n) throw conflict('customer_in_use', 'This customer has sales or owes money, so they stay in your records.');
    await this.prisma.posCustomer.delete({ where: { id } });
  }

  async list(owner: CustomerWithStore, filter: CustomersFilter) {
    const account = await this.account(owner);
    return this.listFor(account.id, account.country, filter);
  }

  async get(owner: CustomerWithStore, id: string) {
    const account = await this.account(owner);
    return this.detail(account.id, account.country, id);
  }

  /** Udozo's admins: an account's customers, and one with their history. */
  async adminList(accountId: string, filter: CustomersFilter) {
    const account = await this.prisma.posAccount.findUnique({ where: { id: accountId }, select: { id: true, country: true } });
    if (!account) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such POS account.');
    return this.listFor(account.id, account.country, filter);
  }

  async adminGet(accountId: string, id: string) {
    const account = await this.prisma.posAccount.findUnique({ where: { id: accountId }, select: { id: true, country: true } });
    if (!account) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such POS account.');
    return this.detail(account.id, account.country, id);
  }

  private async listFor(accountId: string, country: string, filter: CustomersFilter) {
    const words = filter.q?.trim();
    const digits = words?.replace(/\D/g, '') ?? '';
    const number = /^c-?0*(\d+)$/i.exec(words ?? '');
    const where: Prisma.PosCustomerWhereInput = {
      accountId,
      ...(filter.owing ? { owedMinor: { gt: 0n } } : {}),
      ...(words
        ? {
            OR: [
              { name: { contains: words, mode: 'insensitive' } },
              { email: { contains: words, mode: 'insensitive' } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-9) } }] : []),
              ...(number ? [{ number: Number(number[1]) }] : []),
            ],
          }
        : {}),
    };
    const take = filter.limit ?? 25;
    const offset = filter.offset ?? 0;
    const [rows, total, owing] = await Promise.all([
      this.prisma.posCustomer.findMany({ where, orderBy: [{ lastSaleAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], skip: offset, take }),
      this.prisma.posCustomer.count({ where }),
      this.prisma.posCustomer.aggregate({ where: { accountId, owedMinor: { gt: 0n } }, _sum: { owedMinor: true }, _count: { _all: true } }),
    ]);
    return {
      object: 'list' as const,
      /** Across the shop: how many owe it, and how much. */
      summary: { owing: owing._count._all, owed: Number(owing._sum.owedMinor ?? 0n) },
      total,
      has_more: offset + take < total,
      data: rows.map(row => this.brief(row)),
    };
  }

  private async detail(accountId: string, country: string, id: string) {
    const row = await this.own(this.prisma, accountId, id);
    const [sales, entries] = await Promise.all([
      this.prisma.posSale.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, status: true, totalMinor: true, currency: true, createdAt: true } }),
      this.prisma.posCustomerEntry.findMany({ where: { customerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, include: { sale: { select: { number: true } } } }),
    ]);
    return {
      ...(await this.present(row, country)),
      sales: sales.map(sale => ({ id: sale.id, number: sale.number, status: sale.status, total: Number(sale.totalMinor), currency: sale.currency, created_at: sale.createdAt.toISOString() })),
      entries: entries.map(entry => ({
        id: entry.id,
        kind: entry.kind,
        amount: Number(entry.amountMinor),
        owed_after: Number(entry.owedAfterMinor),
        sale: entry.saleId ? { id: entry.saleId, number: entry.sale?.number ?? null } : null,
        method: entry.method,
        reference: entry.reference,
        note: entry.note,
        by: entry.byName,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  }

  /** A repayment of what the customer owes, recorded as it was paid (the money is the shop's own). */
  async repay(owner: CustomerWithStore, id: string, input: { amount: number; method: RecordedPaymentMethod; reference?: string | null; note?: string | null }, by: PosBy = ownerBy(owner)) {
    const account = await this.account(owner);
    await this.own(this.prisma, account.id, id);
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) throw invalid('parameter_invalid', 'Give how much they paid.', 'amount');
    if (!recordedPaymentMethods.includes(input.method)) throw invalid('parameter_invalid', 'Choose cash, transfer, card or other.', 'method');
    const amount = BigInt(input.amount);
    await this.prisma.$transaction(async tx => {
      const [after] = await tx.$queryRaw<Array<{ owed: bigint }>>`UPDATE "pos_customers" SET "owed_minor" = "owed_minor" - ${amount}, "updated_at" = now() WHERE "id" = ${id}::uuid AND "owed_minor" >= ${amount} RETURNING "owed_minor" AS "owed"`;
      if (!after) throw conflict('repayment_too_much', 'That is more than they owe.', 'amount');
      await tx.posCustomerEntry.create({ data: { customerId: id, kind: 'repayment', amountMinor: -amount, owedAfterMinor: after.owed, method: input.method, reference: text(input.reference, 80), note: text(input.note, 300), byName: by.name } });
    });
    return this.detail(account.id, account.country, id);
  }

  // ---- For sales and Udozo payments ----

  /**
   * The shop's record of a Udozo customer who paid (or was asked to pay) through Udozo, made or found on the way: the one
   * already linked to them; else `preferredId` (the customer the cashier chose) when it is linked to no one; else one
   * with their confirmed mobile linked to no one; else a new record with their name and confirmed mobile.
   */
  async linkUdozo(tx: Prisma.TransactionClient, accountId: string, buyer: UdozoBuyer, preferredId?: string | null) {
    const linked = await tx.posCustomer.findFirst({ where: { accountId, udozoCustomerId: buyer.id } });
    if (linked) return linked;
    if (preferredId) {
      const chosen = await tx.posCustomer.findFirst({ where: { id: preferredId, accountId, udozoCustomerId: null } });
      if (chosen) return tx.posCustomer.update({ where: { id: chosen.id }, data: { udozoCustomerId: buyer.id } });
    }
    const phone = buyer.phoneVerifiedAt ? buyer.phone : null;
    if (phone) {
      const byPhone = await tx.posCustomer.findFirst({ where: { accountId, phone, udozoCustomerId: null } });
      if (byPhone) return tx.posCustomer.update({ where: { id: byPhone.id }, data: { udozoCustomerId: buyer.id } });
    }
    return tx.posCustomer.create({ data: { accountId, name: buyer.name.slice(0, 120), phone, udozoCustomerId: buyer.id, source: 'udozo' } });
  }

  /** What a linked customer is like on Udozo: their seller reviews and Anjio's public words, where the market shows them. */
  private async rating(udozoId: string, country: string) {
    const [person, reviews, scores] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: udozoId }, select: { createdAt: true, status: true } }),
      this.reviews.summary(udozoId, country).catch(() => null),
      this.scores.forPublic(udozoId, country).catch(() => null),
    ]);
    if (!person) return null;
    return { member_since: person.createdAt.toISOString(), in_good_standing: person.status === 'active', reviews: reviews && reviews.counted > 0 ? reviews : null, scores };
  }

  private brief(row: PosCustomer) {
    return {
      object: 'pos_customer' as const,
      id: row.id,
      number: customerNumber(row.number),
      name: row.name,
      phone: row.phone,
      email: row.email,
      udozo: row.udozoCustomerId !== null,
      owed: Number(row.owedMinor),
      credit_limit: row.creditLimitMinor === null ? null : Number(row.creditLimitMinor),
      sales_count: row.salesCount,
      spent: Number(row.spentMinor),
      last_sale_at: row.lastSaleAt?.toISOString() ?? null,
    };
  }

  private async present(row: PosCustomer, country: string) {
    return {
      ...this.brief(row),
      address: row.address,
      notes: row.notes,
      source: row.source,
      /** Their Udozo rating, for a customer linked to a Udozo account; null otherwise. */
      udozo_rating: row.udozoCustomerId ? await this.rating(row.udozoCustomerId, country) : null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
