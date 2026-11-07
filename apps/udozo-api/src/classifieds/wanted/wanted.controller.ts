import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { conditions } from '../rules.js';
import { WantedService } from './wanted.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const statuses = ['open', 'fulfilled', 'closed', 'expired', 'removed'] as const;

class CreateWantedDto {
  @IsString() @Length(1, 120)
  words: string;

  @IsUUID()
  category_id: string;

  @IsOptional() @IsUUID()
  area_id?: string | null;

  @IsOptional() @IsUUID()
  state_id?: string | null;

  @IsOptional() @IsString() @MaxLength(600)
  details?: string | null;

  /** Minor units. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  budget_min?: number | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  budget_max?: number | null;

  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(conditions, { each: true })
  conditions?: string[];
}

class PageDto {
  @IsOptional() @IsIn(statuses)
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class CloseDto {
  /** Found what they wanted (else just closed). */
  @IsOptional() @IsBoolean()
  fulfilled?: boolean;
}

class RespondDto {
  @IsUUID()
  listing_id: string;

  @IsOptional() @IsString() @MaxLength(600)
  note?: string | null;
}

class AdminQueryDto extends PageDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsString() @MaxLength(80)
  q?: string;
}

class RemoveDto {
  @IsString() @Length(3, 500)
  reason: string;
}

/** Wanted requests (docs/UDOZO_WHATSAPP_PLAN.md): buyers ask, matching sellers are told and answer with a listing. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class WantedController {
  constructor(private readonly wanted: WantedService) {}

  @Post('wanted')
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: CreateWantedDto) {
    return this.wanted.create(caller.customer, body);
  }

  @Get('me/wanted')
  mine(@CurrentCustomer() caller: CustomerCaller, @Query() query: PageDto) {
    return this.wanted.mine(caller.customer, query);
  }

  @Get('me/wanted-for-you')
  forYou(@CurrentCustomer() caller: CustomerCaller, @Query() query: PageDto) {
    return this.wanted.forYou(caller.customer, query);
  }

  @Get('wanted/:id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wanted.get(caller.customer, id);
  }

  @Post('wanted/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseDto) {
    return this.wanted.close(caller.customer, id, body.fulfilled ?? false);
  }

  @Post('wanted/:id/respond')
  respond(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RespondDto) {
    return this.wanted.respond(caller.customer, id, body);
  }
}

/** Admin Marketplace > Wanted requests: every request, and removing one. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds/wanted')
@ProductOnly('udozo')
export class AdminWantedController {
  constructor(private readonly wanted: WantedService) {}

  @Get()
  list(@Query() query: AdminQueryDto) {
    return this.wanted.adminList(query);
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RemoveDto) {
    return this.wanted.adminRemove(adminId(caller), id, body.reason);
  }
}
