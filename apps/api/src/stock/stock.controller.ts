import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { StockCodeStatus } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { stockCategories } from '../suppliers/stock.adapter.js';
import { type StockCategory, StockService } from './stock.service.js';

/** At most this many codes in one request. */
const maxCodes = 1000;
const httpsUrl = /^https:\/\/\S+$/;

class StockCodeDto {
  @IsString() @Length(4, 200) code: string;
  @IsOptional() @IsString() @Length(1, 100) pin?: string;
}

class CodesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(maxCodes) @ValidateNested({ each: true }) @Type(() => StockCodeDto) codes: StockCodeDto[];
}

class CreateStockDto {
  @IsIn(stockCategories) category: StockCategory;
  /** Where the code can be used (the licence or card region). */
  @Matches(/^[A-Za-z]{2}$/) country: string;
  @IsString() @Length(2, 60) brand: string;
  @IsString() @Length(2, 120) title: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsString() @Length(0, 2000) redeem_instructions?: string;
  @Matches(/^[A-Za-z]{3}$/) currency: string;
  /** The face value shown on stores, minor units. */
  @IsInt() @Min(1) @Max(100_000_000) face_value: number;
  /** What BitoCard paid for one code, minor units. */
  @IsInt() @Min(1) @Max(100_000_000) cost: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) margin_bps?: number;
  @IsOptional() @Matches(httpsUrl, { message: 'image_url must be an https:// address' }) @Length(0, 1000) image_url?: string;
  /** List it on bitocard.com straight away. */
  @IsOptional() @IsBoolean() listed?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(maxCodes) @ValidateNested({ each: true }) @Type(() => StockCodeDto) codes?: StockCodeDto[];
}

class UpdateStockDto {
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) cost?: number;
  /** null goes back to the category or default rule. */
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsInt() @Min(0) @Max(5000) margin_bps?: number | null;
  /** Pause or resume sales without withdrawing codes. */
  @IsOptional() @IsBoolean() on_sale?: boolean;
}

class StockFilterDto {
  @IsOptional() @IsIn(stockCategories) category?: StockCategory;
  @IsOptional() @IsString() @Length(1, 60) q?: string;
}

class CodesFilterDto extends PageDto {
  @IsOptional() @IsIn(['available', 'sold', 'withdrawn']) status?: StockCodeStatus;
}

class WithdrawDto {
  @IsString() @Length(3, 500) reason: string;
}

/** BitoCard's own stock (Catalog > Stock). Admin only; never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/stock')
export class AdminStockController {
  constructor(private readonly stock: StockService) {}

  @AdminRoles('operations', 'finance', 'support')
  @Get()
  list(@Query() filter: StockFilterDto) {
    return this.stock.list(filter);
  }

  @AdminRoles('operations')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: CreateStockDto) {
    return this.stock.create(adminId(caller), body);
  }

  @AdminRoles('operations', 'finance', 'support')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.stock.get(id);
  }

  @AdminRoles('operations', 'finance')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStockDto) {
    return this.stock.update(adminId(caller), id, body);
  }

  @AdminRoles('operations', 'finance', 'support')
  @Get(':id/codes')
  codes(@Param('id', ParseUUIDPipe) id: string, @Query() filter: CodesFilterDto) {
    return this.stock.codes(id, filter);
  }

  @AdminRoles('operations')
  @Post(':id/codes')
  @HttpCode(HttpStatus.OK)
  addCodes(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodesDto) {
    return this.stock.addCodes(adminId(caller), id, body.codes);
  }

  @AdminRoles('operations')
  @Post(':id/codes/:codeId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('codeId', ParseUUIDPipe) codeId: string, @Body() body: WithdrawDto) {
    return this.stock.withdrawCode(adminId(caller), id, codeId, body.reason);
  }
}
