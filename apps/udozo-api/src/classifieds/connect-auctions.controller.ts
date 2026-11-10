import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard, customerFor } from '../customers/customer-session.js';
import { CustomersService } from '../customers/customers.service.js';
import { ProductOnly } from '../products/product.js';
import { ConnectAuctionsService } from './connect-auctions.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class CountryDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;
}

class BidDto {
  @IsInt() @Min(1)
  amount: number;
}

class CreateDto {
  @IsUUID()
  order_id: string;

  @IsInt() @Min(1)
  start_price: number;

  @IsString()
  ends_at: string;

  @IsOptional() @IsString()
  starts_at?: string;

  @IsOptional() @IsInt() @Min(0)
  costs?: number;

  @IsOptional() @IsString() @MaxLength(140)
  title?: string;

  @IsOptional() @IsString() @MaxLength(3000)
  description?: string;

  @IsOptional() @IsBoolean()
  below_owed?: boolean;
}

class ReasonDto {
  @IsString() @MaxLength(300)
  reason: string;
}

class CodeDto {
  @Matches(/^\s*\d{6}\s*$/)
  code: string;
}

class AdminListDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsIn(['scheduled', 'live', 'awaiting_payment', 'sold', 'unsold', 'cancelled'])
  status?: string;
}

/** Udozo auctions on udozo.com: the lots open in a market (anyone), bidding, paying and the collection code (signed in). */
@ApiExcludeController()
@Public()
@Controller('classifieds/auctions')
@ProductOnly('udozo')
export class ClassifiedAuctionsController {
  constructor(
    private readonly auctions: ConnectAuctionsService,
    private readonly customers: CustomersService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  list(@Query() query: CountryDto) {
    return this.auctions.publicList(query.country);
  }

  @Get(':ref')
  async get(@Req() request: Request, @Param('ref') ref: string) {
    const viewer = await customerFor(this.customers, request).catch(() => null);
    return this.auctions.publicGet(ref, viewer?.customer);
  }

  @Post(':ref/bids')
  @UseGuards(CustomerGuard)
  bid(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string, @Body() body: BidDto) {
    return this.auctions.bid(caller.customer, ref, body.amount);
  }

  @Post(':ref/pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  pay(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string) {
    return this.auctions.pay(caller.customer, ref);
  }

  @Get(':ref/collection-code')
  @Header('Cache-Control', 'no-store')
  @UseGuards(CustomerGuard)
  code(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string) {
    return this.auctions.collectionCode(caller.customer, ref);
  }
}

/** Udozo's team: listing lots, cancelling one before bids, and handing a sold one to its buyer at the warehouse. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/connect/auctions')
@ProductOnly('udozo')
export class AdminAuctionsController {
  constructor(private readonly auctions: ConnectAuctionsService) {}

  @Get()
  list(@Query() query: AdminListDto) {
    return this.auctions.adminList(query);
  }

  @Get('eligible')
  eligible(@Query() query: AdminListDto) {
    return this.auctions.eligible(query.country);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.auctions.adminGet(id);
  }

  @Post()
  @AdminRoles('operations')
  create(@CurrentCaller() caller: Caller, @Body() body: CreateDto) {
    return this.auctions.create(adminId(caller), body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.auctions.cancel(adminId(caller), id, body.reason);
  }

  /** The buyer's collection code: never stored for replay. */
  @Post(':id/hand-over')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  @SkipIdempotency()
  handOver(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.auctions.handOver(adminId(caller), id, body.code);
  }
}
