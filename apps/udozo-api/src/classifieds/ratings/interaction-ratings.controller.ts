import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { type InteractionChannel, interactionChannels, interactionTags, InteractionRatingsService, maxComment } from './interaction-ratings.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const truthy = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class StateQueryDto {
  @IsUUID()
  listing_id: string;

  /** Asking now: true counts as asking (at most one listing a day). */
  @IsOptional() @Transform(truthy) @IsBoolean()
  prompt?: boolean;
}

class ScoresDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  responsiveness?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  helpfulness?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  courtesy?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(interactionTags.length) @IsIn(interactionTags, { each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(maxComment)
  comment?: string | null;
}

class CreateDto {
  @IsUUID()
  listing_id: string;

  @IsOptional() @IsIn(interactionChannels)
  channel?: InteractionChannel;

  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  responsiveness: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  helpfulness: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  courtesy: number;

  @IsOptional() @IsArray() @ArrayMaxSize(interactionTags.length) @IsIn(interactionTags, { each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(maxComment)
  comment?: string;
}

class DismissDto {
  @IsUUID()
  listing_id: string;
}

/** Buyers rating sellers after being in touch, and sellers' own anonymous summary (signed in). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class InteractionRatingsController {
  constructor(private readonly ratings: InteractionRatingsService) {}

  @Get('interaction-ratings/state')
  state(@CurrentCustomer() caller: CustomerCaller, @Query() query: StateQueryDto) {
    return this.ratings.state(caller.customer, query.listing_id, query.prompt === true);
  }

  @Post('interaction-ratings')
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: CreateDto) {
    return this.ratings.create(caller.customer, body);
  }

  @Patch('interaction-ratings/:id')
  update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ScoresDto) {
    return this.ratings.update(caller.customer, id, body);
  }

  @Post('interaction-ratings/prompt/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@CurrentCustomer() caller: CustomerCaller, @Body() body: DismissDto) {
    return this.ratings.dismiss(caller.customer, body.listing_id);
  }

  @Get('me/ratings')
  mine(@CurrentCustomer() caller: CustomerCaller) {
    return this.ratings.summaryFor(caller.customer);
  }
}

class AdminListQueryDto {
  @IsOptional() @Transform(truthy) @IsBoolean()
  flagged?: boolean;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  seller?: string;

  @IsOptional() @IsUUID()
  rater?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class ExcludeDto {
  @IsString() @Length(3, 500)
  reason: string;
}

/** Admins: every rating, with who wrote it and the note; flagged ones first to read; leaving one out of a summary. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminInteractionRatingsController {
  constructor(private readonly ratings: InteractionRatingsService) {}

  @Get('interaction-ratings')
  list(@Query() query: AdminListQueryDto) {
    return this.ratings.adminList(query);
  }

  @Get('sellers/:customer/ratings')
  seller(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.ratings.adminSeller(customer);
  }

  @Post('interaction-ratings/:id/exclude')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  exclude(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExcludeDto) {
    return this.ratings.exclude(adminId(caller), id, true, body.reason);
  }

  @Post('interaction-ratings/:id/restore')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  restore(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExcludeDto) {
    return this.ratings.exclude(adminId(caller), id, false, body.reason);
  }
}
