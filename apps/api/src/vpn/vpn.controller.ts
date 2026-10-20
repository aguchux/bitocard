import { StoreScope } from '../stores/store-scope.js';
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, Scopes, StepUp, storeScopeOf } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CheckoutService } from '../checkout/checkout.service.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { OrderAccessService } from '../orders/order-access.service.js';
import { vpnStatuses } from './presenter.js';
import { VpnService } from './vpn.service.js';

class VpnFilterDto extends PageDto {
  @ApiPropertyOptional({ description: 'Only the VPN access this order bought.' })
  @IsOptional() @IsUUID()
  order_id?: string;

  @ApiPropertyOptional({ description: 'Only VPN access in this state.', enum: vpnStatuses })
  @IsOptional() @IsIn(vpnStatuses)
  status?: string;
}

/** VPN access bought by your orders: its state and expiry, and resetting its password. */
@ApiTags('VPN')
@ApiBearerAuth()
@modeHeader
@Controller('vpn-subscriptions')
export class VpnController {
  constructor(private readonly vpn: VpnService, private readonly scope: StoreScope) {}

  @ApiOperation({ summary: 'List VPN access', description: 'VPN access your orders bought, newest first, with its state and expiry. The username and password are only on `GET /v1/orders/{id}`.' })
  @Scopes('orders:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: VpnFilterDto) {
    return this.vpn.list(resellerOf(caller), mode, filter, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Get VPN access', description: 'Its state and expiry, read again from the supplier when older than ten minutes. Access never renews automatically.' })
  @Scopes('orders:read')
  @Get(':id')
  async get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    await this.scope.check(caller, 'vpn', id);
    return this.vpn.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Reset the VPN password',
    description:
      'Gives active VPN access a new password and returns it (with the username). The old password stops working; `GET /v1/orders/{id}` shows the new one from then on. At most once a minute (`password_recently_reset`). `vpn_password_reset_pending` (503) means the supplier has not confirmed it yet: call again and the same reset continues.',
  })
  @Roles('admin', 'support')
  @Scopes('orders:write')
  @Post(':id/password-reset')
  @HttpCode(HttpStatus.OK)
  async reset(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    await this.scope.check(caller, 'vpn', id);
    return this.vpn.resellerReset(resellerOf(caller), mode, id);
  }
}

const proofOf = (req: Request) => ({ customerSession: req.get('bitocard-customer-session') ?? undefined, pass: req.get('bitocard-access-pass') ?? undefined });

/** VPN access on its order's page (`/a/<token>`), for the customer who proved the order is theirs. */
@ApiExcludeController()
@Public()
@Controller('store/access')
export class VpnAccessController {
  constructor(
    private readonly access: OrderAccessService,
    private readonly vpn: VpnService,
  ) {}

  @Get(':token/vpn')
  @Header('Cache-Control', 'no-store')
  async get(@Param('token') token: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'vpn_access' as const, vpn_subscription: await this.vpn.forOrder(order.id) };
  }

  /** Never stored for replay: the response carries the new password. */
  @Post(':token/vpn/password-reset')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async reset(@Param('token') token: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return this.vpn.customerReset(order);
  }
}

/** The signed-in customer's own VPN access, from their order in the account app. */
@ApiExcludeController()
@Public()
@Controller('store')
export class VpnCustomerController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly vpn: VpnService,
  ) {}

  @UseGuards(CustomerGuard)
  @Get('checkouts/:id/vpn')
  @Header('Cache-Control', 'no-store')
  async get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.checkout.orderFor(caller.customer, id);
    return { object: 'vpn_access' as const, vpn_subscription: await this.vpn.forOrder(order.id) };
  }

  @UseGuards(CustomerGuard)
  @Post('checkouts/:id/vpn/password-reset')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async reset(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.checkout.orderFor(caller.customer, id);
    return this.vpn.customerReset(order);
  }
}

class AdminVpnFilterDto {
  @IsOptional() @IsIn(vpnStatuses)
  status?: string;

  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;

  /** A subscription, order or reseller ID, a supplier account ID or a username. */
  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

/**
 * Admin: every VPN subscription with the supplier's own state, the health summary and the daily reconciliations;
 * operations check, suspend, enable and reset passwords (never seeing them). Every action is audited.
 */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('admin/vpn')
export class AdminVpnController {
  constructor(private readonly vpn: VpnService) {}

  @Get('health')
  health() {
    return this.vpn.health();
  }

  @Get('subscriptions')
  list(@Query() filter: AdminVpnFilterDto) {
    return this.vpn.adminList(filter);
  }

  @Get('reconciliations')
  reconciliations() {
    return this.vpn.reconciliations();
  }

  @AdminRoles('operations')
  @Post('reconciliations/run')
  @HttpCode(HttpStatus.OK)
  reconcile(@CurrentCaller() caller: Caller) {
    return this.vpn.reconcile(adminId(caller));
  }

  @AdminRoles('operations')
  @Post('subscriptions/:id/sync')
  @HttpCode(HttpStatus.OK)
  sync(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.vpn.adminSync(adminId(caller)!, id);
  }

  @AdminRoles('operations')
  @Post('subscriptions/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.vpn.adminSuspend(adminId(caller)!, id, body.reason);
  }

  /** Turning paid-for access back on is an access decision: it needs the step-up window. */
  @AdminRoles('operations')
  @StepUp()
  @Post('subscriptions/:id/enable')
  @HttpCode(HttpStatus.OK)
  enable(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.vpn.adminEnable(adminId(caller)!, id, body.reason);
  }

  @AdminRoles('operations')
  @Post('subscriptions/:id/password-reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.vpn.adminReset(adminId(caller)!, id, body.reason);
  }
}
