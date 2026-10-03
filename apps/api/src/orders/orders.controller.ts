import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { LedgerMode, OrderStatus } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { OrdersService } from './orders.service.js';

const statuses = ['processing', 'completed', 'failed', 'refunded'] as const;

class CreateOrderDto {
  @ApiProperty({ description: 'An open quote. Each quote can be used for one order.' })
  @IsUUID()
  quote_id: string;

  @ApiPropertyOptional({ enum: ['completed', 'failed', 'pending'], description: 'Test mode only: the outcome to simulate (default completed).' })
  @IsOptional() @IsIn(['completed', 'failed', 'pending'])
  simulate?: 'completed' | 'failed' | 'pending';
}

class OrderFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: statuses })
  @IsOptional() @IsIn(statuses)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(1, 100)
  customer_reference?: string;
}

class SimulateOrderDto {
  @ApiProperty({ enum: ['completed', 'failed'] })
  @IsIn(['completed', 'failed'])
  outcome: 'completed' | 'failed';
}

class AdminOrderFilterDto extends PageDto {
  @IsOptional() @IsIn(statuses) status?: OrderStatus;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() needs_review?: boolean;
  @IsOptional() @IsUUID() reseller_id?: string;
}

class DeliveryDto {
  @IsIn(['gift_card', 'token', 'confirmation']) kind: 'gift_card' | 'token' | 'confirmation';
  @IsOptional() @IsString() @Length(1, 200) code?: string;
  @IsOptional() @IsString() @Length(1, 100) pin?: string;
  @IsOptional() @IsString() @Length(1, 100) serial?: string;
}

class ResolveOrderDto {
  @IsIn(['completed', 'failed']) outcome: 'completed' | 'failed';
  @IsString() @Length(5, 500) reason: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DeliveryDto) deliveries?: DeliveryDto[];
}

class RefundOrderDto {
  @IsString() @Length(5, 500) reason: string;
  /** The supplier refunded BitoCard as well, so the supplier cost is reversed too. */
  @IsBoolean() supplier_refunded: boolean;
}

@ApiTags('Orders')
@ApiBearerAuth()
@modeHeader
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiOperation({
    summary: 'Place an order',
    description:
      'Uses an open quote. Wholesale cost plus tax is held from your wallet and taken only when the order completes; a failed order releases it. `processing` means the supplier has not confirmed yet: check again, or wait for the webhook. Gift card codes, PINs and electricity tokens appear only on this order, never in lists or webhooks.',
  })
  @Roles('admin', 'developer')
  @Scopes('orders:write')
  @Post()
  create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateOrderDto) {
    return this.orders.create(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'List orders', description: 'Newest first. Codes and tokens are not included; get the order for them.' })
  @Scopes('orders:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: OrderFilterDto) {
    return this.orders.list(resellerOf(caller), mode, filter);
  }

  @ApiOperation({ summary: 'Get an order', description: 'Includes what was delivered: gift card codes and PINs, electricity tokens.' })
  @Scopes('orders:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Get the receipt for an order',
    description: 'For completed orders. BitoCard (the Golojan entity for your region) is the seller of record; the receipt carries your store name.',
  })
  @Scopes('orders:read')
  @Get(':id/receipt')
  receipt(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.receipt(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'Simulate the outcome of a processing order (test mode)' })
  @Roles('admin', 'developer')
  @Scopes('orders:write')
  @Post(':id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateOrderDto) {
    return this.orders.simulate(resellerOf(caller), mode, id, body.outcome);
  }
}

/** Order tracing, the exception queue, manual resolution and refunds. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @AdminRoles('operations', 'support', 'finance')
  @Get()
  list(@Query() filter: AdminOrderFilterDto) {
    return this.orders.adminList(filter);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGet(id);
  }

  @AdminRoles('operations', 'support')
  @Post(':id/requery')
  @HttpCode(HttpStatus.OK)
  requery(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminRequery(id);
  }

  @AdminRoles('operations')
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveOrderDto) {
    return this.orders.resolve(adminId(caller), id, body);
  }

  @AdminRoles('finance')
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefundOrderDto) {
    return this.orders.refund(adminId(caller), id, body);
  }
}
