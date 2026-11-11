import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { CurrentStaff, PosAllows, PosGuard } from './pos.guard.js';
import type { PosStaffContext } from './staff.service.js';
import { maxTransferLines, PosStockTransfersService } from './transfers.service.js';

class TransferLineDto {
  @IsUUID()
  listing_id: string;

  @IsInt() @Min(1)
  quantity: number;
}

class TransferDto {
  /** The shop it leaves; null or missing: online. */
  @IsOptional() @IsUUID()
  from_shop_id?: string | null;

  /** The shop it goes to; null or missing: online. */
  @IsOptional() @IsUUID()
  to_shop_id?: string | null;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(maxTransferLines) @ValidateNested({ each: true }) @Type(() => TransferLineDto)
  lines: TransferLineDto[];

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class TransfersDto {
  @IsOptional() @IsUUID()
  shop?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

/** The owner's stock transfers between shops (several shops only). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerTransfersController {
  constructor(private readonly transfers: PosStockTransfersService) {}

  @Get('stock-transfers')
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: TransfersDto) {
    return this.transfers.list(caller.customer, query);
  }

  @Post('stock-transfers')
  transfer(@CurrentCustomer() caller: CustomerCaller, @Body() body: TransferDto) {
    return this.transfers.transfer(caller.customer, body);
  }
}

/** Staff move stock between shops with `stock_adjust`, and see the transfers with `stock_view`. */
@ApiExcludeController()
@Public()
@UseGuards(PosGuard)
@Controller('pos/staff')
@ProductOnly('udozo')
export class PosStaffTransfersController {
  constructor(private readonly transfers: PosStockTransfersService) {}

  @Get('stock-transfers')
  @PosAllows(['stock_view', 'stock_adjust'])
  list(@CurrentStaff() context: PosStaffContext, @Query() query: TransfersDto) {
    return this.transfers.list(context.owner, query);
  }

  @Post('stock-transfers')
  @PosAllows('stock_adjust')
  transfer(@CurrentStaff() context: PosStaffContext, @Body() body: TransferDto) {
    return this.transfers.transfer(context.owner, body, context.by);
  }
}
