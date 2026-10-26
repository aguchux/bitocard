import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { ResaleShopService } from './resale-shop.service.js';

const storeSubdomain = /^[a-z0-9-]{2,30}$/;
const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class StoreDto {
  @Matches(storeSubdomain, { message: 'store must be a store subdomain' })
  store: string;
}

class ListingsDto extends StoreDto {
  @IsOptional() @Matches(slug)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc'])
  sort?: 'newest' | 'price_asc' | 'price_desc';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000)
  offset?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48)
  limit?: number;
}

class SupplierDto extends StoreDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  listing?: number;
}

class PhraseDto {
  @IsString() @Length(3, 120)
  phrase: string;
}

/**
 * A Resale shop's public reads, for the store's server (B2B reselling): what it sells now, one listing, a supplier's
 * page and its categories. Cached a minute, like the store's catalogue.
 */
@ApiExcludeController()
@Public()
@Controller('store/resale')
export class ResaleShopController {
  constructor(private readonly shop: ResaleShopService) {}

  @Get('listings')
  @Header('Cache-Control', 'public, max-age=60')
  listings(@Query() query: ListingsDto) {
    return this.shop.listings(query.store, query);
  }

  @Get('listings/:ref')
  @Header('Cache-Control', 'public, max-age=60')
  listing(@Query() query: StoreDto, @Param('ref', ParseIntPipe) ref: number) {
    return this.shop.listing(query.store, ref);
  }

  @Get('suppliers/:id')
  @Header('Cache-Control', 'public, max-age=60')
  supplier(@Query() query: SupplierDto, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.supplier(query.store, id, query.listing);
  }

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  categories(@Query() query: StoreDto) {
    return this.shop.categories(query.store);
  }
}

/** The words a Resale shop's own text may not use (claims of owning, making or stocking what it resells). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds/resale-claim-phrases')
export class AdminResaleShopController {
  constructor(private readonly shop: ResaleShopService) {}

  @Get()
  list() {
    return this.shop.phrases();
  }

  @Post()
  @AdminRoles('operations')
  add(@CurrentCaller() caller: Caller, @Body() body: PhraseDto) {
    return this.shop.addPhrase(adminId(caller), body.phrase);
  }

  @Delete(':id')
  @AdminRoles('operations')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.removePhrase(adminId(caller), id);
  }
}
