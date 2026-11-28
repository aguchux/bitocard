import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, RealmOnly } from '../auth/caller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';

const sources = ['gateway', 'static_account', 'manual', 'bank_deposit'] as const;
const outcomes = ['pending', 'succeeded', 'failed'] as const;
type Source = (typeof sources)[number];
type Outcome = (typeof outcomes)[number];

class FundingsFilterDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['reseller', 'customer'])
  owner?: 'reseller' | 'customer';

  @IsOptional() @IsUUID()
  reseller_id?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @IsIn(sources)
  source?: Source;

  @IsOptional() @IsIn(outcomes)
  status?: Outcome;

  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

type Owner = { type: 'reseller' | 'customer'; id: string; name: string; email: string | null; reseller: string | null };
type Funding = {
  object: 'funding';
  id: string;
  record_id: string;
  source: Source;
  mode: LedgerMode;
  status: Outcome;
  provider_status: string;
  owner: Owner;
  amount: number;
  credited_amount: number | null;
  currency: string;
  provider: string;
  reference: string;
  external_reference: string | null;
  failure_reason: string | null;
  static_account: { id: string; bank_name: string; account_number: string; account_name: string } | null;
  created_at: string;
  completed_at: string | null;
};

const outcomeOfManual = (status: string): Outcome => status === 'completed' ? 'succeeded' : status === 'awaiting_code' ? 'pending' : 'failed';
const outcomeOfBank = (status: string): Outcome => status === 'credited' ? 'succeeded' : ['awaiting_payment', 'sent'].includes(status) ? 'pending' : 'failed';

/** A single audit view of every way money enters a reseller or customer wallet. */
@Injectable()
export class AdminFundingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: FundingsFilterDto) {
    const limit = filter.limit ?? 50;
    const take = limit + 1;
    const q = filter.q?.trim();
    const includePayments = !filter.source || filter.source === 'gateway' || filter.source === 'static_account';
    const includeManual = !filter.source || filter.source === 'manual';
    const includeBank = (!filter.source || filter.source === 'bank_deposit') && filter.owner !== 'reseller' && !filter.reseller_id;

    const [payments, manual, bank] = await Promise.all([
      includePayments
        ? this.prisma.payment.findMany({
            where: {
              purpose: { in: ['wallet_top_up', 'customer_top_up', 'reserved_account_deposit'] },
              ...(filter.source === 'static_account'
                ? { reservedAccountId: { not: null } }
                : filter.source === 'gateway' ? { reservedAccountId: null } : {}),
              ...(filter.mode ? { mode: filter.mode } : {}),
              ...(filter.status ? { status: filter.status } : {}),
              ...(filter.owner === 'customer' ? { customerId: { not: null } } : filter.owner === 'reseller' ? { customerId: null } : {}),
              ...(filter.reseller_id ? { resellerId: filter.reseller_id, customerId: null } : {}),
              ...(filter.customer_id ? { customerId: filter.customer_id } : {}),
              ...(q ? { OR: [
                { reference: { contains: q, mode: 'insensitive' } },
                { providerTransactionId: { contains: q, mode: 'insensitive' } },
                { reseller: { name: { contains: q, mode: 'insensitive' } } },
                { customer: { is: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } },
                { reservedAccount: { is: { accountNumber: { contains: q } } } },
              ] } : {}),
            },
            include: {
              reseller: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true, email: true } },
              reservedAccount: { select: { id: true, bankName: true, accountNumber: true, accountName: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      includeManual
        ? this.prisma.manualTopUp.findMany({
            where: {
              ...(filter.mode ? { mode: filter.mode } : {}),
              ...(filter.owner === 'customer' ? { customerId: { not: null } } : filter.owner === 'reseller' ? { resellerId: { not: null } } : {}),
              ...(filter.reseller_id ? { resellerId: filter.reseller_id } : {}),
              ...(filter.customer_id ? { customerId: filter.customer_id } : {}),
              ...(filter.status ? { status: filter.status === 'succeeded' ? 'completed' : filter.status === 'pending' ? 'awaiting_code' : { in: ['cancelled'] } } : {}),
              ...(q ? { OR: [
                { externalReference: { contains: q, mode: 'insensitive' } },
                { reason: { contains: q, mode: 'insensitive' } },
                { reseller: { is: { name: { contains: q, mode: 'insensitive' } } } },
                { customer: { is: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } },
              ] } : {}),
            },
            include: {
              reseller: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true, email: true, store: { select: { name: true } } } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      includeBank
        ? this.prisma.bankDeposit.findMany({
            where: {
              ...(filter.mode ? { mode: filter.mode } : {}),
              ...(filter.customer_id ? { customerId: filter.customer_id } : {}),
              ...(filter.status ? {
                status: filter.status === 'succeeded'
                  ? 'credited'
                  : filter.status === 'pending' ? { in: ['awaiting_payment', 'sent'] } : { in: ['rejected', 'cancelled', 'expired'] },
              } : {}),
              ...(q ? { OR: [
                { reference: { contains: q, mode: 'insensitive' } },
                { externalReference: { contains: q, mode: 'insensitive' } },
                { accountNumber: { contains: q } },
                { customer: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } },
              ] } : {}),
            },
            include: { customer: { select: { id: true, name: true, email: true, store: { select: { name: true } } } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
    ]);

    const rows: Funding[] = [
      ...payments.map(row => ({
        object: 'funding' as const,
        id: `payment:${row.id}`,
        record_id: row.id,
        source: row.reservedAccountId || row.purpose === 'reserved_account_deposit' ? 'static_account' as const : 'gateway' as const,
        mode: row.mode,
        status: row.status,
        provider_status: row.status,
        owner: row.customer
          ? { type: 'customer' as const, id: row.customer.id, name: row.customer.name, email: row.customer.email, reseller: row.reseller.name }
          : { type: 'reseller' as const, id: row.reseller.id, name: row.reseller.name, email: null, reseller: null },
        amount: Number(row.amountMinor),
        credited_amount: row.status === 'succeeded' ? Number(row.amountMinor) : null,
        currency: row.currency,
        provider: row.provider,
        reference: row.reference,
        external_reference: row.providerTransactionId,
        failure_reason: row.failureReason,
        static_account: row.reservedAccount ? { id: row.reservedAccount.id, bank_name: row.reservedAccount.bankName, account_number: row.reservedAccount.accountNumber, account_name: row.reservedAccount.accountName } : null,
        created_at: row.createdAt.toISOString(),
        completed_at: row.completedAt?.toISOString() ?? null,
      })),
      ...manual.map(row => ({
        object: 'funding' as const,
        id: `manual:${row.id}`,
        record_id: row.id,
        source: 'manual' as const,
        mode: row.mode,
        status: outcomeOfManual(row.status),
        provider_status: row.status,
        owner: row.customer
          ? { type: 'customer' as const, id: row.customer.id, name: row.customer.name, email: row.customer.email, reseller: row.customer.store.name }
          : { type: 'reseller' as const, id: row.reseller!.id, name: row.reseller!.name, email: null, reseller: null },
        amount: Number(row.amountMinor),
        credited_amount: row.status === 'completed' ? Number(row.amountMinor) : null,
        currency: row.currency,
        provider: row.source === 'received' ? 'manual receipt' : 'goodwill',
        reference: `MT-${String(row.number).padStart(6, '0')}`,
        external_reference: row.externalReference,
        failure_reason: row.status === 'cancelled' ? 'Cancelled' : null,
        static_account: null,
        created_at: row.createdAt.toISOString(),
        completed_at: row.completedAt?.toISOString() ?? null,
      })),
      ...bank.map(row => ({
        object: 'funding' as const,
        id: `bank:${row.id}`,
        record_id: row.id,
        source: 'bank_deposit' as const,
        mode: row.mode,
        status: outcomeOfBank(row.status),
        provider_status: row.status,
        owner: { type: 'customer' as const, id: row.customer.id, name: row.customer.name, email: row.customer.email, reseller: row.customer.store.name },
        amount: Number(row.amountMinor),
        credited_amount: row.creditedAmountMinor === null ? null : Number(row.creditedAmountMinor),
        currency: row.currency,
        provider: row.method ?? 'bank deposit',
        reference: row.reference,
        external_reference: row.externalReference,
        failure_reason: row.decisionNote,
        static_account: { id: row.accountId ?? row.id, bank_name: row.bankName, account_number: row.accountNumber, account_name: row.accountName },
        created_at: row.createdAt.toISOString(),
        completed_at: row.decidedAt?.toISOString() ?? null,
      })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    return { object: 'list' as const, data: rows.slice(0, limit), has_more: rows.length > limit || payments.length > limit || manual.length > limit || bank.length > limit };
  }
}

/** Finance, operations and support can read funding; only existing money-action endpoints can change it. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/fundings')
export class AdminFundingsController {
  constructor(private readonly fundings: AdminFundingsService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get()
  list(@Query() filter: FundingsFilterDto) {
    return this.fundings.list(filter);
  }
}
