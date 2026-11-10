import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { AdminRoles, Public, RealmOnly } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ConnectStockService } from './connect-stock.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class StockCheckDto {
  @IsOptional() @IsUUID()
  shelf_id?: string | null;

  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true })
  found: string[];

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class MoveDto {
  @IsIn(['live', 'test'])
  mode: 'live' | 'test';

  @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency: string;

  @IsInt() @Min(1)
  amount: number;
}

class CountryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** A Connect Centre's stock checks (any of its people) and earnings (its owner). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres/:centre')
@ProductOnly('udozo')
export class ConnectCentreStockController {
  constructor(private readonly stock: ConnectStockService) {}

  @Get('stock')
  expected(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string) {
    return this.stock.expected(caller.customer, centre);
  }

  @Get('stock-checks')
  checks(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string) {
    return this.stock.checks(caller.customer, centre);
  }

  @Post('stock-checks')
  record(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Body() body: StockCheckDto) {
    return this.stock.record(caller.customer, centre, body);
  }

  @Get('earnings')
  earnings(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string) {
    return this.stock.earnings(caller.customer, centre);
  }

  @Post('earnings/move')
  @HttpCode(HttpStatus.OK)
  move(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Body() body: MoveDto) {
    return this.stock.move(caller.customer, centre, body);
  }
}

/** Udozo's team: items a centre's stock check did not find. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/connect/missing')
@ProductOnly('udozo')
export class AdminMissingController {
  constructor(private readonly stock: ConnectStockService) {}

  @Get()
  list(@Query() query: CountryDto) {
    return this.stock.missingForAdmin(query.country);
  }
}
