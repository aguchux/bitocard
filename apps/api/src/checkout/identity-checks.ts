import { Body, Controller, Get, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer, Prisma } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { houseStoreId } from './house.service.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');

/** A store's customer as its owner sees them: never their password, sessions or codes. */
function presentCustomer(customer: Customer & { checked: boolean; purchases: number }) {
  return {
    object: 'store_customer' as const,
    id: customer.id,
    name: customer.name,
    email: customer.email,
    email_confirmed: customer.emailVerifiedAt !== null,
    /** Asked for the identity check where it applies (true), or turned off for them by the store's owner. */
    identity_check: customer.identityCheck,
    /** Has passed BitoCard's identity check. Only the check itself sets this; nobody can mark it. */
    identity_checked: customer.checked,
    purchases: customer.purchases,
    created_at: customer.createdAt.toISOString(),
  };
}

/**
 * Who a store asks for the identity check. Store owners (a reseller for their store, BitoCard for bitocard.com) list
 * their customers and turn the check off or on for one of them, or for the whole store; BitoCard also sets, for
 * bitocard.com only, how long after a customer's first purchase they are asked. Nobody can mark a customer as checked.
 * The decision at checkout is `CheckoutService.identityCheckNeeded`.
 */
@Injectable()
export class IdentityChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(storeId: string, filter: { q?: string; limit?: number; starting_after?: string }) {
    const limit = Math.min(filter.limit ?? 25, 100);
    const words = filter.q?.trim();
    const where: Prisma.CustomerWhereInput = {
      storeId,
      ...(words ? { OR: [{ email: { contains: words.toLowerCase() } }, { name: { contains: words, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return { object: 'list' as const, data: await this.present(page), has_more: rows.length > limit };
  }

  async setIdentityCheck(storeId: string, customerId: string, enabled: boolean, actor: { adminId: string | null } | null) {
    const before = await this.prisma.customer.findFirst({ where: { id: customerId, storeId } });
    if (!before) throw notFound();
    const after = await this.prisma.customer.update({ where: { id: customerId }, data: { identityCheck: enabled } });
    if (actor) {
      await this.audit.record({
        actorId: actor.adminId,
        action: enabled ? 'customer.identity_check_on' : 'customer.identity_check_off',
        targetType: 'customer',
        targetId: customerId,
        before: { identity_check: before.identityCheck },
        after: { identity_check: after.identityCheck },
      });
    }
    return (await this.present([after]))[0];
  }

  /** bitocard.com's identity check settings (BitoCard's own store). */
  async houseSettings() {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: houseStoreId } });
    return { object: 'customer_verification_settings' as const, enabled: store.customerVerification, grace_days: store.verificationGraceDays };
  }

  async setHouseSettings(actorId: string | null, input: { enabled?: boolean; grace_days?: number | null }) {
    const before = await this.houseSettings();
    await this.prisma.store.update({ where: { id: houseStoreId }, data: { customerVerification: input.enabled, verificationGraceDays: input.grace_days } });
    const after = await this.houseSettings();
    await this.audit.record({ actorId, action: 'storefront.customer_verification_changed', targetType: 'store', targetId: houseStoreId, before, after });
    return after;
  }

  private async present(customers: Customer[]) {
    const ids = customers.map(customer => customer.id);
    const [checked, purchases] = await Promise.all([
      this.prisma.identityVerification.findMany({ where: { subject: 'customer', customerReference: { in: ids }, status: 'approved' }, select: { customerReference: true } }),
      this.prisma.checkout.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: { in: ['paid', 'completed', 'refund_pending', 'refunded'] } }, _count: true }),
    ]);
    const passed = new Set(checked.map(row => row.customerReference));
    const counts = new Map(purchases.map(row => [row.customerId, row._count]));
    return customers.map(customer => presentCustomer({ ...customer, checked: passed.has(customer.id), purchases: counts.get(customer.id) ?? 0 }));
  }
}

class CustomerFilterDto extends PageDto {
  @IsOptional() @IsString() @Length(1, 100) q?: string;
}

class IdentityCheckDto {
  /** Ask this customer for the identity check where it applies (true), or not (false). Never marks them checked. */
  @IsBoolean() identity_check: boolean;
}

class HouseVerificationDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** Ask only once this many days have passed since the customer's first paid purchase; null asks before buying. */
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsInt() @Min(1) @Max(365) grace_days?: number | null;
}

/** SHQ: the reseller's store customers, and turning the identity check off or on for one of them. */
@ApiExcludeController()
@SessionOnly()
@Roles('admin')
@Controller('stores/:storeId/customers')
export class StoreCustomersController {
  constructor(
    private readonly checks: IdentityChecksService,
    private readonly prisma: PrismaService,
  ) {}

  private async own(caller: Caller, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId: resellerOf(caller) } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');
    return store;
  }

  @Get()
  async list(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: CustomerFilterDto) {
    await this.own(caller, storeId);
    return this.checks.list(storeId, query);
  }

  @Patch(':id')
  async set(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: IdentityCheckDto) {
    await this.own(caller, storeId);
    return this.checks.setIdentityCheck(storeId, id, body.identity_check, null);
  }
}

/** Admin app: bitocard.com's customers and its identity check settings. Resellers' store customers are theirs. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/storefront')
export class AdminStoreCustomersController {
  constructor(private readonly checks: IdentityChecksService) {}

  @Get('customers')
  list(@Query() query: CustomerFilterDto) {
    return this.checks.list(houseStoreId, query);
  }

  @AdminRoles('operations')
  @Patch('customers/:id')
  set(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: IdentityCheckDto) {
    return this.checks.setIdentityCheck(houseStoreId, id, body.identity_check, { adminId: adminId(caller) });
  }

  @Get('customer-verification')
  settings() {
    return this.checks.houseSettings();
  }

  @AdminRoles('operations')
  @Put('customer-verification')
  setSettings(@CurrentCaller() caller: Caller, @Body() body: HouseVerificationDto) {
    return this.checks.setHouseSettings(adminId(caller), body);
  }
}
