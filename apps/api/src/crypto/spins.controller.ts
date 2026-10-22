import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { AdminRoles, Public, RealmOnly } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SpinsService } from './spins.service.js';
import { StoreKey } from '../customers/store-key.js';

const publicClaimHeader = 'bitocard-spin-claim';

class PublicSpinMarketDto {
  @IsOptional() @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;
}

class PublicSpinClaimDto {
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a currency code' })
  currency: string;
}

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

  /** A visitor's saved Customer Catcher win, checked on first login. */
  @Get('public-claim')
  publicClaimStatus(@CurrentCustomer() caller: CustomerCaller, @Headers(publicClaimHeader) token?: string) {
    return this.spins.publicClaimStatus(caller.customer, token);
  }

  @Post('public-claim')
  @HttpCode(HttpStatus.OK)
  claimPublic(@CurrentCustomer() caller: CustomerCaller, @Headers(publicClaimHeader) token: string | undefined, @Body() body: PublicSpinClaimDto) {
    return this.spins.claimPublic(caller.customer, token, body.currency);
  }
}

/** Customer Catcher: BitoCard's public wheel for signed-out visitors on root and country stores. */
@ApiExcludeController()
@Public()
@Controller('store/spins/public')
export class PublicSpinsController {
  constructor(private readonly spins: SpinsService) {}

  @Get()
  status(@StoreKey() store: string | null, @Query() query: PublicSpinMarketDto, @Headers(publicClaimHeader) token?: string) {
    return this.spins.publicStatus(store, query.country, token);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  spin(@StoreKey() store: string | null, @Body() body: PublicSpinMarketDto, @Headers(publicClaimHeader) token?: string) {
    return this.spins.publicSpin(store, body.country, token);
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
