import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { cryptoAmount } from '../crypto/crypto.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode, P2pOrderStatus } from '../generated/prisma/client.js';
import { P2pOrdersService } from './orders.service.js';

class OpenOrderDto {
  @IsUUID() ad_id: string;
  /** The ad's price as you saw it: a changed price is refused. */
  @IsInt() @Min(1) price: number;
  @IsOptional() @cryptoAmount() amount?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00) fiat?: number;
  /** Where the buyer pays: one of a sell ad's payment methods, or (taking a buy ad) one of your own the ad accepts. */
  @IsUUID() payment_method_id: string;
  @IsOptional() @IsBoolean() preview?: boolean;
}

class AppealDto {
  @IsString() @Length(10, 1000) reason: string;
}

class OrdersQueryDto {
  @IsOptional() @IsIn(['open', 'closed']) status?: 'open' | 'closed';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class AdminOrdersQueryDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
  @IsOptional() @IsIn(['pending_payment', 'paid', 'appealed', 'released', 'cancelled', 'returned']) status?: P2pOrderStatus;
  @IsOptional() @IsUUID() customer_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class DecideDto {
  @IsIn(['release', 'return']) outcome: 'release' | 'return';
  @IsIn(['buyer', 'seller', 'none']) fault: 'buyer' | 'seller' | 'none';
  @IsString() @Length(5, 1000) note: string;
}

/** A trader's P2P orders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 3), through Afrippa's signed server, past two-step. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p/orders')
export class P2pOrdersController {
  constructor(private readonly orders: P2pOrdersService) {}

  @Post()
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: OpenOrderDto) {
    return this.orders.open(caller.customer, body);
  }

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: OrdersQueryDto) {
    return this.orders.list(caller.customer, query);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(caller.customer, id);
  }

  @Post(':id/paid')
  @HttpCode(HttpStatus.OK)
  paid(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.markPaid(caller.customer, id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  release(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.release(caller.customer, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(caller.customer, id);
  }

  @Post(':id/appeal')
  @HttpCode(HttpStatus.OK)
  appeal(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AppealDto) {
    return this.orders.appeal(caller.customer, id, body.reason);
  }
}

/** Afrippa's admins: every order, and deciding appeals (operations, with step-up). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/p2p/orders')
export class AfrippaOrdersAdminController {
  constructor(private readonly orders: P2pOrdersService) {}

  @Get()
  list(@Query() query: AdminOrdersQueryDto) {
    return this.orders.adminList(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGet(id);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideDto) {
    return this.orders.decide(adminId(caller), id, body);
  }
}
