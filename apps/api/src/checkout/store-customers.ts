import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer, Prisma } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { SettingsService } from '../settings/settings.service.js';
import { desktopNavFor } from '../stores/stores.service.js';
import { CustomerWalletsService } from './customer-wallets.js';
import { HouseService, houseStoreId } from './house.service.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');
const paidStatuses = ['paid', 'completed', 'refund_pending', 'refunded'] as const;

/** Who changed a customer: a BitoCard admin (audited) or the reseller's team (their own store). */
type Actor = { adminId: string | null } | null;

/** A store's customer as its owner sees them: never their password, sessions or codes. */
function presentCustomer(customer: Customer & { checked: boolean; purchases: number }) {
  return {
    object: 'store_customer' as const,
    id: customer.id,
    name: customer.name,
    email: customer.email,
    email_confirmed: customer.emailVerifiedAt !== null,
    /** `active`, or `disabled` by the store's owner: cannot sign in or buy. */
    status: customer.status,
    /** Asked for the identity check where it applies (true), or turned off for them by the store's owner. */
    identity_check: customer.identityCheck,
    /** Has passed BitoCard's identity check. Only the check itself sets this; nobody can mark it. */
    identity_checked: customer.checked,
    purchases: customer.purchases,
    created_at: customer.createdAt.toISOString(),
  };
}

/**
 * A hosted store's customers, managed by the store's owner: a reseller for their store (SHQ), BitoCard for bitocard.com
 * (the admin app). Owners list and open their customers with their purchases, turn the identity check off or on for
 * one of them, disable or re-enable their account, unlock it after too many wrong passwords and sign it out
 * everywhere. Nobody can mark a customer as checked. bitocard.com's own store settings are here too.
 * Whether a purchase needs the identity check is decided at checkout by `CheckoutService.identityCheckNeeded`.
 */
@Injectable()
export class StoreCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly house: HouseService,
    private readonly settings: SettingsService,
    private readonly wallets: CustomerWalletsService,
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
    return { object: 'list' as const, data: await this.present(rows.slice(0, limit)), has_more: rows.length > limit };
  }

  /** One customer with their account state and their latest 50 purchases (unpaid checkouts left out). */
  async get(storeId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, storeId } });
    if (!customer) throw notFound();
    const [presented] = await this.present([customer]);
    const checkouts = await this.prisma.checkout.findMany({
      where: { customerId: id, status: { in: [...paidStatuses] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const quotes = await this.prisma.quote.findMany({ where: { id: { in: checkouts.map(row => row.quoteId) } }, include: { product: true } });
    const disputes = await this.prisma.dispute.count({ where: { customerId: id } });
    const sessions = await this.prisma.customerSession.count({ where: { customerId: id, revokedAt: null, expiresAt: { gt: new Date() } } });
    return {
      ...presented,
      object: 'store_customer_detail' as const,
      last_sign_in_at: customer.lastSignInAt?.toISOString() ?? null,
      /** Locked after too many wrong passwords until then; null when not locked. */
      locked_until: customer.lockedUntil && customer.lockedUntil > new Date() ? customer.lockedUntil.toISOString() : null,
      signed_in_sessions: sessions,
      disputes,
      /** The customer's wallet balances (spend only, never withdrawn), per mode and currency. */
      wallet: await this.wallets.balances(id),
      purchases_list: checkouts.map(checkout => {
        const quote = quotes.find(row => row.id === checkout.quoteId);
        return {
          id: checkout.id,
          order_id: checkout.orderId,
          status: checkout.status,
          mode: checkout.mode,
          product: quote ? quote.product.name : null,
          quantity: quote?.quantity ?? 1,
          amount: Number(checkout.amountMinor),
          currency: checkout.currency,
          created_at: checkout.createdAt.toISOString(),
        };
      }),
    };
  }

  /** Identity check on or off, and the account enabled or disabled (disabling signs it out everywhere). */
  async update(storeId: string, id: string, input: { identity_check?: boolean; status?: 'active' | 'disabled' }, actor: Actor) {
    const before = await this.prisma.customer.findFirst({ where: { id, storeId } });
    if (!before) throw notFound();
    const after = await this.prisma.customer.update({ where: { id }, data: { identityCheck: input.identity_check, status: input.status } });
    if (input.status === 'disabled') await this.revokeSessions(id);
    if (actor) {
      const changes: Array<[string, unknown, unknown]> = [];
      if (input.identity_check !== undefined && before.identityCheck !== after.identityCheck) changes.push([after.identityCheck ? 'customer.identity_check_on' : 'customer.identity_check_off', before.identityCheck, after.identityCheck]);
      if (input.status !== undefined && before.status !== after.status) changes.push([after.status === 'disabled' ? 'customer.disabled' : 'customer.enabled', before.status, after.status]);
      for (const [action, from, to] of changes) {
        await this.audit.record({ actorId: actor.adminId, action, targetType: 'customer', targetId: id, before: { value: from }, after: { value: to } });
      }
    }
    return this.get(storeId, id);
  }

  /** Clears a lockout after too many wrong passwords. */
  async unlock(storeId: string, id: string, actor: Actor) {
    const customer = await this.prisma.customer.findFirst({ where: { id, storeId } });
    if (!customer) throw notFound();
    await this.prisma.customer.update({ where: { id }, data: { failedSignIns: 0, lockedUntil: null } });
    if (actor) await this.audit.record({ actorId: actor.adminId, action: 'customer.unlocked', targetType: 'customer', targetId: id });
    return this.get(storeId, id);
  }

  /** Ends every session the customer has (on every device). */
  async signOut(storeId: string, id: string, actor: Actor) {
    const customer = await this.prisma.customer.findFirst({ where: { id, storeId } });
    if (!customer) throw notFound();
    await this.revokeSessions(id);
    if (actor) await this.audit.record({ actorId: actor.adminId, action: 'customer.signed_out', targetType: 'customer', targetId: id });
    return this.get(storeId, id);
  }

  private revokeSessions(customerId: string) {
    return this.prisma.customerSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** bitocard.com's store settings: identity checks, the account app's desktop menu, and its checkout mode (read only). */
  async houseSettings() {
    const store = await this.house.store();
    return {
      object: 'storefront_settings' as const,
      customer_verification: store.customerVerification,
      grace_days: store.verificationGraceDays,
      /** `rail`, `bottom`, or null to follow the `customer_app_bottom_bar_desktop` switch. */
      desktop_nav: store.desktopNav,
      desktop_nav_effective: await desktopNavFor(this.settings, store),
      /** Set by the Customer checkout integration's Sandbox switch (Settings > Integrations). */
      checkout_mode: this.house.mode(),
    };
  }

  async setHouseSettings(actorId: string | null, input: { customer_verification?: boolean; grace_days?: number | null; desktop_nav?: 'rail' | 'bottom' | null }) {
    const before = await this.houseSettings();
    await this.prisma.store.update({
      where: { id: houseStoreId },
      data: { customerVerification: input.customer_verification, verificationGraceDays: input.grace_days, desktopNav: input.desktop_nav },
    });
    const after = await this.houseSettings();
    await this.audit.record({ actorId, action: 'storefront.settings_changed', targetType: 'store', targetId: houseStoreId, before, after });
    return after;
  }

  private async present(customers: Customer[]) {
    const ids = customers.map(customer => customer.id);
    const [checked, purchases] = await Promise.all([
      this.prisma.identityVerification.findMany({ where: { subject: 'customer', customerReference: { in: ids }, status: 'approved' }, select: { customerReference: true } }),
      this.prisma.checkout.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: { in: [...paidStatuses] } }, _count: true }),
    ]);
    const passed = new Set(checked.map(row => row.customerReference));
    const counts = new Map(purchases.map(row => [row.customerId, row._count]));
    return customers.map(customer => presentCustomer({ ...customer, checked: passed.has(customer.id), purchases: counts.get(customer.id) ?? 0 }));
  }
}

class CustomerFilterDto extends PageDto {
  @IsOptional() @IsString() @Length(1, 100) q?: string;
}

class UpdateCustomerDto {
  /** Ask this customer for the identity check where it applies (true), or not (false). Never marks them checked. */
  @IsOptional() @IsBoolean() identity_check?: boolean;
  /** `disabled`: cannot sign in or buy, and is signed out everywhere; `active` re-enables. */
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
}

class StorefrontSettingsDto {
  @IsOptional() @IsBoolean() customer_verification?: boolean;
  /** Ask only once this many days have passed since the customer's first paid purchase; null asks before buying. */
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsInt() @Min(1) @Max(365) grace_days?: number | null;
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsIn(['rail', 'bottom']) desktop_nav?: 'rail' | 'bottom' | null;
}

/** SHQ: the reseller's store customers. Owners and admins of the reseller account. */
@ApiExcludeController()
@SessionOnly()
@Roles('admin')
@Controller('stores/:storeId/customers')
export class StoreCustomersController {
  constructor(
    private readonly customers: StoreCustomersService,
    private readonly prisma: PrismaService,
  ) {}

  private async own(caller: Caller, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId: resellerOf(caller) } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');
  }

  @Get()
  async list(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: CustomerFilterDto) {
    await this.own(caller, storeId);
    return this.customers.list(storeId, query);
  }

  @Get(':id')
  async get(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(caller, storeId);
    return this.customers.get(storeId, id);
  }

  @Patch(':id')
  async update(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCustomerDto) {
    await this.own(caller, storeId);
    return this.customers.update(storeId, id, body, null);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  async unlock(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(caller, storeId);
    return this.customers.unlock(storeId, id, null);
  }

  @Post(':id/sign-out')
  @HttpCode(HttpStatus.OK)
  async signOut(@CurrentCaller() caller: Caller, @Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(caller, storeId);
    return this.customers.signOut(storeId, id, null);
  }
}

/** Admin app (Storefront > Customers and Settings): bitocard.com's own customers and store settings. Resellers' are theirs. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/storefront')
export class AdminStoreCustomersController {
  constructor(private readonly customers: StoreCustomersService) {}

  @Get('customers')
  list(@Query() query: CustomerFilterDto) {
    return this.customers.list(houseStoreId, query);
  }

  @Get('customers/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(houseStoreId, id);
  }

  @AdminRoles('operations')
  @Patch('customers/:id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCustomerDto) {
    return this.customers.update(houseStoreId, id, body, { adminId: adminId(caller) });
  }

  @AdminRoles('operations', 'support')
  @Post('customers/:id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.unlock(houseStoreId, id, { adminId: adminId(caller) });
  }

  @AdminRoles('operations', 'support')
  @Post('customers/:id/sign-out')
  @HttpCode(HttpStatus.OK)
  signOut(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.signOut(houseStoreId, id, { adminId: adminId(caller) });
  }

  @Get('settings')
  settings() {
    return this.customers.houseSettings();
  }

  @AdminRoles('operations')
  @Put('settings')
  setSettings(@CurrentCaller() caller: Caller, @Body() body: StorefrontSettingsDto) {
    return this.customers.setHouseSettings(adminId(caller), body);
  }
}
