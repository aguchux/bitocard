import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ownerBy } from './actor.js';
import { maxUploadEntries, type OfflineEntry, PosOfflineService } from './offline.service.js';
import { CurrentDevice, CurrentStaff, PosAllows, PosDeviceGuard, PosDeviceUploadGuard, PosGuard } from './pos.guard.js';
import { PosShopPricesService } from './shop-prices.service.js';
import type { PosStaffContext } from './staff.service.js';

class UploadDto {
  /** What the till did offline, in the order it happened: sales and refunds, each with its own id. Checked entry by entry. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(maxUploadEntries)
  entries: OfflineEntry[];
}

class FlaggedDto {
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  resolved?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class HeldDto {
  @IsOptional() @IsIn(['held', 'accepted', 'rejected'])
  status?: 'held' | 'accepted' | 'rejected';
}

class ShopPriceDto {
  @IsUUID()
  shop_id: string;

  /** The shop's own price in minor units; null goes back to the listing's. */
  @ValidateIf((_, value) => value !== null) @IsInt() @Min(1)
  price: number | null;
}

/** A linked till's offline copy, and its uploads once back online (an unlinked device's sales are held). */
@ApiExcludeController()
@Public()
@Controller('pos/device')
@ProductOnly('udozo')
export class PosDeviceOfflineController {
  constructor(private readonly offline: PosOfflineService) {}

  @Get('sync')
  @UseGuards(PosDeviceGuard)
  sync(@CurrentDevice() device: { id: string; accountId: string; tillId: string }) {
    return this.offline.copy(device);
  }

  /** Each entry carries its own id, so the upload itself needs no idempotency key. */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  @UseGuards(PosDeviceUploadGuard)
  upload(@CurrentDevice() device: { id: string; accountId: string; tillId: string; revokedAt: Date | null; lastSyncedAt: Date | null; name: string | null }, @Body() body: UploadDto) {
    return this.offline.upload(device, body.entries);
  }
}

/** The owner's offline sales to look at, held sales of unlinked devices, and prices per shop. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerOfflineController {
  constructor(
    private readonly offline: PosOfflineService,
    private readonly prices: PosShopPricesService,
  ) {}

  @Get('offline/flagged')
  flagged(@CurrentCustomer() caller: CustomerCaller, @Query() query: FlaggedDto) {
    return this.offline.flagged(caller.customer, query);
  }

  @Post('sales/:id/flags/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.offline.resolve(caller.customer, id, ownerBy(caller.customer));
  }

  @Get('offline/held')
  held(@CurrentCustomer() caller: CustomerCaller, @Query() query: HeldDto) {
    return this.offline.held(caller.customer, query.status);
  }

  @Post('offline/held/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.offline.decide(caller.customer, id, 'accept', ownerBy(caller.customer));
  }

  @Post('offline/held/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.offline.decide(caller.customer, id, 'reject', ownerBy(caller.customer));
  }

  @Get('products/:listing/prices')
  shopPrices(@CurrentCustomer() caller: CustomerCaller, @Param('listing', ParseUUIDPipe) listing: string) {
    return this.prices.list(caller.customer, listing);
  }

  @Put('products/:listing/prices')
  setShopPrice(@CurrentCustomer() caller: CustomerCaller, @Param('listing', ParseUUIDPipe) listing: string, @Body() body: ShopPriceDto) {
    return this.prices.set(caller.customer, listing, body);
  }
}

/** Staff see flagged offline sales with `all_sales`, mark them looked at with `stock_adjust`, and set shop prices with `prices`. */
@ApiExcludeController()
@Public()
@UseGuards(PosGuard)
@Controller('pos/staff')
@ProductOnly('udozo')
export class PosStaffOfflineController {
  constructor(
    private readonly offline: PosOfflineService,
    private readonly prices: PosShopPricesService,
  ) {}

  @Get('offline/flagged')
  @PosAllows(['all_sales', 'stock_adjust'])
  flagged(@CurrentStaff() context: PosStaffContext, @Query() query: FlaggedDto) {
    return this.offline.flagged(context.owner, query);
  }

  @Post('sales/:id/flags/resolve')
  @HttpCode(HttpStatus.OK)
  @PosAllows('stock_adjust')
  resolve(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.offline.resolve(context.owner, id, context.by);
  }

  @Get('products/:listing/prices')
  @PosAllows(['prices', 'stock_view'])
  shopPrices(@CurrentStaff() context: PosStaffContext, @Param('listing', ParseUUIDPipe) listing: string) {
    return this.prices.list(context.owner, listing);
  }

  @Put('products/:listing/prices')
  @PosAllows('prices')
  setShopPrice(@CurrentStaff() context: PosStaffContext, @Param('listing', ParseUUIDPipe) listing: string, @Body() body: ShopPriceDto) {
    return this.prices.set(context.owner, listing, body, context.by);
  }
}
