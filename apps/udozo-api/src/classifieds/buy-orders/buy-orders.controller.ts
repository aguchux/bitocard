import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { invalid } from '../rules.js';
import { BuyOrdersService } from './buy-orders.service.js';
import { type BuyOrderAction, buyOrderActions, buyOrderStatuses, maxBuyNote } from './present.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
/** Addresses use hyphens (`accept-counter`, `no-show`); the actions underscores. */
const actionOf = (raw: string): BuyOrderAction => {
  const action = raw.replace(/-/g, '_') as BuyOrderAction;
  if (!buyOrderActions.includes(action)) throw invalid('parameter_invalid', 'No such step.', 'action');
  return action;
};

class CreateBuyOrderDto {
  /** For all the units, in minor units. */
  @Type(() => Number) @IsInt() @Min(1)
  price: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  quantity?: number;

  @IsOptional() @IsString() @MaxLength(maxBuyNote)
  note?: string;

  /** Where and when the buyer would like to meet. */
  @IsOptional() @IsString() @MaxLength(maxBuyNote)
  meet_note?: string;
}

class BuyOrderStepDto {
  /** The seller's counter price (counter). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  price?: number;

  /** Why (decline, cancel, no-show; required to say they did not buy it). */
  @IsOptional() @IsString() @MaxLength(maxBuyNote)
  reason?: string;
}

class BuyOrdersQueryDto {
  @IsOptional() @IsIn(['buying', 'selling'])
  role?: 'buying' | 'selling';

  @IsOptional() @IsIn([...buyOrderStatuses, 'open'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;
}

class AdminBuyOrdersQueryDto {
  @IsOptional() @IsIn([...buyOrderStatuses, 'open'])
  status?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  seller?: string;

  @IsOptional() @IsUUID()
  buyer?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class PauseDto {
  @IsString() @Length(3, 500)
  reason: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  days?: number;
}

/**
 * Udozo's buy orders (docs/UDOZO_RATINGS_PLAN.md phase 0): the buyer asks to buy a listing at a price, the seller
 * accepts or counters before they meet, they pay each other in person, and the seller marks it sold.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class BuyOrdersController {
  constructor(private readonly orders: BuyOrdersService) {}

  @Post('listings/:id/buy-orders')
  create(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateBuyOrderDto) {
    return this.orders.create(caller.customer, id, body);
  }

  /** A seller's accepted buy orders for one of their listings (Mark sold offers them first). */
  @Get('me/listings/:id/buy-orders')
  accepted(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.acceptedFor(caller.customer, id);
  }

  @Get('me/buy-orders')
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: BuyOrdersQueryDto) {
    return this.orders.list(caller.customer, query);
  }

  @Get('buy-orders/:id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(caller.customer, id);
  }

  /** accept, counter, decline (the seller); accept-counter, bought, void (the buyer); cancel, no-show (either); complete and extend (the seller). */
  @Post('buy-orders/:id/:action')
  @HttpCode(HttpStatus.OK)
  act(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() body: BuyOrderStepDto) {
    return this.orders.act(caller.customer, id, actionOf(action), body);
  }
}

/** Admin Marketplace > Buy orders: every buy order with its steps, and pausing a seller's buy orders. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminBuyOrdersController {
  constructor(private readonly orders: BuyOrdersService) {}

  @Get('buy-orders')
  list(@Query() query: AdminBuyOrdersQueryDto) {
    return this.orders.adminList(query);
  }

  @Get('buy-orders/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGet(id);
  }

  @Post('sellers/:customer/buy-orders/pause')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  pause(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: PauseDto) {
    return this.orders.pause(adminId(caller), customer, true, body.reason, body.days);
  }

  @Post('sellers/:customer/buy-orders/unpause')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  unpause(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: PauseDto) {
    return this.orders.pause(adminId(caller), customer, false, body.reason);
  }
}
