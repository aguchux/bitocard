import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { ListingsService } from './listings.service.js';
import { ClassifiedReferenceService } from './reference.service.js';
import { conditions, contacts, deliveries, type ListingStatus, listingStatuses, maxDescription, maxFeatures, priceKinds } from './rules.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class CountryDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;
}

class FeatureSearchDto {
  @IsOptional() @IsString() @MaxLength(60)
  q?: string;
}

class FeatureValueDto {
  @IsString() @MaxLength(60)
  key: string;

  /** Text, a number, a choice or yes or no, checked against the key's registry entry. */
  @Allow()
  value: unknown;
}

class ListingDto {
  @IsOptional() @IsUUID()
  category_id?: string | null;

  @IsOptional() @IsUUID()
  area_id?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string | null;

  @IsOptional() @IsString() @MaxLength(maxDescription + 1000)
  description?: string | null;

  @IsOptional() @IsIn(priceKinds)
  price_kind?: (typeof priceKinds)[number];

  /** In the currency's minor units (kobo). */
  @IsOptional() @IsInt()
  price?: number | null;

  @IsOptional() @IsIn(conditions)
  condition?: (typeof conditions)[number] | null;

  @IsOptional() @IsIn(deliveries)
  delivery?: (typeof deliveries)[number];

  @IsOptional() @IsIn(contacts)
  contact?: (typeof contacts)[number];

  @IsOptional() @IsArray() @ArrayMaxSize(maxFeatures + 5) @ValidateNested({ each: true }) @Type(() => FeatureValueDto)
  features?: FeatureValueDto[];
}

class MyListingsDto extends PageDto {
  @IsOptional() @IsIn(listingStatuses)
  status?: ListingStatus;
}

/** BitoCard Shop's public reference data, cached a minute: the feature registry, a country's categories and areas. */
@ApiExcludeController()
@Public()
@Controller('classifieds')
export class ClassifiedReferenceController {
  constructor(private readonly reference: ClassifiedReferenceService) {}

  @Get('features')
  @Header('Cache-Control', 'public, max-age=60')
  features(@Query() query: FeatureSearchDto) {
    return this.reference.features(query.q);
  }

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  categories(@Query() query: CountryDto) {
    return this.reference.categories(query.country);
  }

  @Get('areas')
  @Header('Cache-Control', 'public, max-age=60')
  areas(@Query() query: CountryDto) {
    return this.reference.areas(query.country);
  }
}

/** A seller's own listings (bitocard.com customers, through the store's server). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
export class ClassifiedListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get('me/listings')
  mine(@CurrentCustomer() caller: CustomerCaller, @Query() query: MyListingsDto) {
    return this.listings.list(caller.customer, query);
  }

  @Get('me/listings/:id')
  one(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.get(caller.customer, id);
  }

  @Post('listings')
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: ListingDto) {
    return this.listings.create(caller.customer, body);
  }

  @Patch('listings/:id')
  update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ListingDto) {
    return this.listings.update(caller.customer, id, body);
  }

  @Post('listings/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.submit(caller.customer, id);
  }

  @Post('listings/:id/renew')
  @HttpCode(HttpStatus.OK)
  renew(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.renew(caller.customer, id);
  }

  @Post('listings/:id/sold')
  @HttpCode(HttpStatus.OK)
  sold(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.markSold(caller.customer, id);
  }

  @Delete('listings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.remove(caller.customer, id);
  }
}
