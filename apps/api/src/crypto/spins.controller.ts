import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { AdminRoles, Public, RealmOnly } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SpinsService } from './spins.service.js';

class AdminSpinsQueryDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

class SpinExchangeDto {
  /** The wallet to credit: US dollars or the customer's country's currency (default). */
  @IsOptional() @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a currency code' })
  currency?: string;

  @IsOptional() @IsBoolean()
  preview?: boolean;

  /** The amount the preview showed (minor units): a lower amount is refused (`rate_changed`). */
  @IsOptional() @IsInt() @Min(1)
  expected_amount?: number;
}

/** Spin and win for store customers (sessions only; hosted stores, so left out of the public OpenAPI document). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/spins')
export class CustomerSpinsController {
  constructor(private readonly spins: SpinsService) {}

  @Get()
  status(@CurrentCustomer() caller: CustomerCaller) {
    return this.spins.status(caller.customer);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  spin(@CurrentCustomer() caller: CustomerCaller) {
    return this.spins.spin(caller.customer);
  }

  /** Exchanges the customer's spin rewards into their store wallet (`preview: true` only quotes). */
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  exchange(@CurrentCustomer() caller: CustomerCaller, @Body() body: SpinExchangeDto) {
    return this.spins.exchange(caller.customer, body);
  }
}

/** Admin: every Spin and win, with totals per coin (BitoCard's promotion spend). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto/spins')
export class AdminSpinsController {
  constructor(private readonly spins: SpinsService) {}

  @Get()
  list(@Query() query: AdminSpinsQueryDto) {
    return this.spins.adminList(query);
  }
}
