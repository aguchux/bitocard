import { Body, Controller, Get, Header, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, Public, RealmOnly, resellerOf, Roles, SessionOnly, StepUp } from '../auth/caller.js';
import { Mode } from '../ledger/mode.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { ProductOnly } from '../products/product.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AirtimeExchangeService } from './airtime.service.js';

const networkKey = /^[a-z0-9-]{2,20}$/;
const maxMinor = 100_000_000;

class PoolQueryDto {
  @IsOptional() @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;
  /** A reseller's store (its subdomain): its market's pool at its customers' rates. */
  @IsOptional() @Matches(/^[a-z0-9-]{2,63}$/, { message: 'store must be a store subdomain' })
  store?: string;
}

class SellDto {
  @Matches(networkKey, { message: 'network must be a network key' }) network: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(maxMinor) amount: number;
  /** One of the seller's confirmed numbers; their default when left out. */
  @IsOptional() @IsString() @MinLength(7) @MaxLength(20) from_phone?: string;
  @IsOptional() @IsBoolean() preview?: boolean;
}

class BuyDto {
  @Matches(networkKey, { message: 'network must be a network key' }) network: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(maxMinor) amount: number;
  @IsString() @MinLength(7) @MaxLength(20) phone: string;
  @IsOptional() @IsBoolean() preview?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expected_price?: number;
}

class SimulateSaleDto {
  @IsIn(['received', 'not_received']) outcome: 'received' | 'not_received';
}

class SimulatePurchaseDto {
  @IsIn(['delivered', 'refunded']) outcome: 'delivered' | 'refunded';
}

/** The pool everyone sees: what BitoCard holds per network, what it bought and sold, and its rates. */
@ApiExcludeController()
@Public()
@Controller('store/airtime/pool')
@ProductOnly('bitocard')
export class AirtimePoolController {
  constructor(private readonly airtime: AirtimeExchangeService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=15')
  pool(@Query() query: PoolQueryDto) {
    return this.airtime.pool(query.country, query.store);
  }
}

/** A customer's airtime sales and purchases (bitocard.com's, or a reseller's store where it trades airtime). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/airtime')
@ProductOnly('bitocard')
export class CustomerAirtimeController {
  constructor(private readonly airtime: AirtimeExchangeService) {}

  @Get('sales')
  sales(@CurrentCustomer() caller: CustomerCaller) {
    return this.airtime.listSales(caller.customer);
  }

  @Post('sales')
  sell(@CurrentCustomer() caller: CustomerCaller, @Body() body: SellDto) {
    return this.airtime.sell(caller.customer, body);
  }

  /** Where the customer stands as a seller: completed sales, strikes, and today's limit per network. */
  @Get('seller')
  seller(@CurrentCustomer() caller: CustomerCaller) {
    return this.airtime.sellerStatus(caller.customer);
  }

  @Get('sales/:id')
  sale(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.airtime.getSale(caller.customer, id);
  }

  @Post('sales/:id/sent')
  @HttpCode(HttpStatus.OK)
  sent(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.airtime.markSent(caller.customer, id);
  }

  @Post('sales/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.airtime.cancelSale(caller.customer, id);
  }

  /** BitoCard's sandbox only. */
  @Post('sales/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulateSale(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateSaleDto) {
    return this.airtime.simulateSale(caller.customer, id, body.outcome);
  }

  @Get('purchases')
  purchases(@CurrentCustomer() caller: CustomerCaller) {
    return this.airtime.listPurchases(caller.customer);
  }

  @Post('purchases')
  buy(@CurrentCustomer() caller: CustomerCaller, @Body() body: BuyDto) {
    return this.airtime.buy(caller.customer, body);
  }

  @Get('purchases/:id')
  purchase(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.airtime.getPurchase(caller.customer, id);
  }

  /** BitoCard's sandbox only. */
  @Post('purchases/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulatePurchase(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulatePurchaseDto) {
    return this.airtime.simulatePurchase(caller.customer, id, body.outcome);
  }
}

class AdminListQueryDto {
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsIn(['live', 'test']) mode?: LedgerMode;
}

class NetworkUpdateDto {
  @IsOptional() @IsInt() @Min(1) @Max(9999) sell_rate_bps?: number;
  @IsOptional() @IsInt() @Min(2) @Max(10_000) buy_rate_bps?: number;
  @IsOptional() @IsInt() @Min(100) @Max(maxMinor) min_amount?: number;
  @IsOptional() @IsInt() @Min(100) @Max(maxMinor) max_amount?: number;
  @IsOptional() @IsInt() @Min(100) @Max(maxMinor) seller_daily?: number;
  @IsOptional() @IsInt() @Min(100) @Max(maxMinor) new_seller_daily?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) established_after?: number;
  @IsOptional() @IsInt() @Min(0) @Max(720) credit_hold_hours?: number;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(400) transfer_steps?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** The most a reseller's store may take of BitoCard's rate on this network, in basis points (0 to 5000). */
  @IsOptional() @IsInt() @Min(0) @Max(5000) reseller_cap_bps?: number;
}

class LineDto {
  @Matches(/^[A-Za-z]{2}$/) country: string;
  @Matches(networkKey) network: string;
  @IsString() @MinLength(7) @MaxLength(20) number: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsInt() @Min(0) @Max(maxMinor) daily_receive?: number;
  @IsOptional() @IsInt() @Min(0) @Max(maxMinor) daily_send?: number;
}

class LineUpdateDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(60) label?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(maxMinor) daily_receive?: number;
  @IsOptional() @IsInt() @Min(0) @Max(maxMinor) daily_send?: number;
  @IsOptional() @IsInt() @Min(0) @Max(maxMinor) balance?: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

class ClaimDto {
  @IsUUID() line_id: string;
}

class DeliverDto {
  @IsOptional() @IsUUID() line_id?: string;
}

/** The airtime exchange on a reseller's stores: whether it is open, their cut per network and their customers' trades (SHQ sessions only). */
@ApiExcludeController()
@SessionOnly()
@Roles('admin', 'finance', 'support')
@Controller('airtime')
@ProductOnly('bitocard')
export class ResellerAirtimeController {
  constructor(private readonly airtime: AirtimeExchangeService) {}

  @Get('exchange')
  exchange(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.airtime.resellerExchange(resellerOf(caller), mode);
  }
}

/** Admins: rates, collector lines, and checking, sending and refunding trades. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/airtime')
@ProductOnly('bitocard')
export class AdminAirtimeController {
  constructor(private readonly airtime: AirtimeExchangeService) {}

  @Get()
  @AdminRoles('operations', 'finance', 'support')
  overview() {
    return this.airtime.adminOverview();
  }

  @Patch('networks/:country/:network')
  @AdminRoles('finance')
  @StepUp()
  network(@CurrentCaller() caller: Caller, @Param('country') country: string, @Param('network') network: string, @Body() body: NetworkUpdateDto) {
    return this.airtime.updateNetwork(personOf(caller), country, network, body);
  }

  @Post('lines')
  @AdminRoles('operations')
  addLine(@CurrentCaller() caller: Caller, @Body() body: LineDto) {
    return this.airtime.addLine(personOf(caller), body);
  }

  @Patch('lines/:id')
  @AdminRoles('operations')
  updateLine(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: LineUpdateDto) {
    return this.airtime.updateLine(personOf(caller), id, body);
  }

  @Get('sales')
  @AdminRoles('operations', 'finance', 'support')
  sales(@Query() query: AdminListQueryDto) {
    return this.airtime.adminSales(query);
  }

  @Post('sales/:id/received')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async received(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.airtime.presentSale(await this.airtime.receive(id, personOf(caller), body.note));
  }

  @Post('sales/:id/not-received')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async notReceived(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.airtime.presentSale(await this.airtime.notReceived(id, personOf(caller), body.reason));
  }

  @Post('sales/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations', 'finance')
  async reverse(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.airtime.presentSale(await this.airtime.reverse(id, personOf(caller), body.reason));
  }

  /** A seller's standing: completed sales and strikes. */
  @Get('sellers/:customer')
  @AdminRoles('operations', 'finance', 'support')
  standing(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.airtime.adminStanding(customer);
  }

  /** Clears a seller's strikes, lifting a pause (operations, audited). */
  @Post('sellers/:customer/clear')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  clear(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.airtime.clearStrikes(personOf(caller), customer, body.reason);
  }

  @Get('purchases')
  @AdminRoles('operations', 'finance', 'support')
  purchases(@Query() query: AdminListQueryDto) {
    return this.airtime.adminPurchases(query);
  }

  @Post('purchases/:id/claim')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async claim(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ClaimDto) {
    return this.airtime.presentPurchase(await this.airtime.claim(id, personOf(caller), body.line_id));
  }

  @Post('purchases/:id/delivered')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async delivered(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DeliverDto) {
    return this.airtime.presentPurchase(await this.airtime.deliver(id, personOf(caller), body.line_id ?? null));
  }

  @Post('purchases/:id/refund')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async refund(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.airtime.presentPurchase((await this.airtime.refund(id, personOf(caller), body.reason))!);
  }
}

@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [AirtimePoolController, CustomerAirtimeController, ResellerAirtimeController, AdminAirtimeController],
  providers: [AirtimeExchangeService],
  exports: [AirtimeExchangeService],
})
export class AirtimeModule {}
