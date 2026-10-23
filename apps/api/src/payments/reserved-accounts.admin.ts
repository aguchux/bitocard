import { Controller, Get, HttpCode, HttpStatus, Injectable, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';
import { PaymentsService } from './payments.service.js';

class ReservedAccountsFilterDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['pending', 'active', 'refused'])
  status?: string;

  @IsOptional() @IsIn(['reseller', 'customer'])
  owner?: 'reseller' | 'customer';

  /** An account number, our reference, or the owner's name or email. */
  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

/**
 * Reserved bank accounts across every wallet, for operations and finance: each request to open one (pending, active
 * or refused, with the provider's last error), its account numbers and whose wallet they fill. Pending requests are
 * the ones to watch: the bank may have opened the account even though its number never reached us (transfers into it
 * are still credited).
 */
@Injectable()
export class ReservedAccountsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ReservedAccountsFilterDto) {
    const limit = filter.limit ?? 25;
    const q = filter.q?.trim();
    const owners = q ? await this.ownersMatching(q) : null;
    const where: Prisma.ReservedAccountRequestWhereInput = {
      ...(filter.mode ? { mode: filter.mode } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.owner === 'customer' ? { customerId: { not: null } } : filter.owner === 'reseller' ? { customerId: null } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q } },
              { resellerId: { in: owners!.resellers }, customerId: null },
              { customerId: { in: owners!.customers } },
              { reference: { in: owners!.references } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.reservedAccountRequest.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const [accounts, resellers, customers] = await Promise.all([
      this.prisma.reservedAccount.findMany({ where: { providerReference: { in: page.map(row => row.reference) } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.reseller.findMany({ where: { id: { in: [...new Set(page.map(row => row.resellerId))] } }, select: { id: true, name: true, country: true } }),
      this.prisma.customer.findMany({ where: { id: { in: page.flatMap(row => (row.customerId ? [row.customerId] : [])) } }, select: { id: true, name: true, email: true } }),
    ]);
    const resellerById = new Map(resellers.map(reseller => [reseller.id, reseller]));
    const customerById = new Map(customers.map(customer => [customer.id, customer]));
    return {
      object: 'list' as const,
      data: page.map(row => {
        const seller = resellerById.get(row.resellerId);
        const customer = row.customerId ? customerById.get(row.customerId) : undefined;
        return {
          object: 'reserved_account_request' as const,
          id: row.id,
          provider: row.provider,
          reference: row.reference,
          mode: row.mode,
          currency: row.currency,
          status: row.status,
          attempts: row.attempts,
          last_error: row.lastError,
          owner: customer
            ? { type: 'customer' as const, id: customer.id, name: customer.name, email: customer.email, seller: seller?.name ?? null }
            : { type: 'reseller' as const, id: row.resellerId, name: seller?.name ?? null, email: null, seller: null },
          accounts: accounts
            .filter(account => account.providerReference === row.reference && account.provider === row.provider)
            .map(account => ({ id: account.id, bank_name: account.bankName, account_number: account.accountNumber, account_name: account.accountName, created_at: account.createdAt.toISOString() })),
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        };
      }),
      has_more: rows.length > limit,
    };
  }

  /** Owners whose name or email matches, and references whose account number matches. */
  private async ownersMatching(q: string) {
    const [resellers, customers, accounts] = await Promise.all([
      this.prisma.reseller.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 100 }),
      this.prisma.customer.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q.toLowerCase() } }] }, select: { id: true }, take: 100 }),
      this.prisma.reservedAccount.findMany({ where: { accountNumber: { contains: q } }, select: { providerReference: true }, take: 100 }),
    ]);
    return { resellers: resellers.map(row => row.id), customers: customers.map(row => row.id), references: accounts.map(row => row.providerReference) };
  }
}

/** Admin: reserved bank accounts and the deposit sweep. Never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/reserved-accounts')
export class AdminReservedAccountsController {
  constructor(
    private readonly accounts: ReservedAccountsAdminService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get()
  list(@Query() filter: ReservedAccountsFilterDto) {
    return this.accounts.list(filter);
  }

  /** Credits now any transfer into a reserved account whose notification never came (the `payments` job does it too). */
  @AdminRoles('finance', 'operations')
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  async sweep(@CurrentCaller() caller: Caller) {
    const result = await this.payments.sweepReservedDeposits();
    await this.audit.record({ actorId: adminId(caller), action: 'reserved_accounts.swept', targetType: 'reserved_accounts', targetId: 'flutterwave', after: result });
    return { object: 'reserved_deposit_sweep' as const, ...result };
  }
}
