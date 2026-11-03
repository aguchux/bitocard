import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { type BannerPosition, bannerPositions, BannersService } from './banners.service.js';

class ShowingQueryDto {
  @IsIn(bannerPositions) position: BannerPosition;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string;
}

class ListQueryDto {
  @IsOptional() @IsIn(bannerPositions) position?: BannerPosition;
  @IsOptional() @IsString() @Matches(/^(global|[A-Za-z]{2})$/) country?: string;
}

class BannerDto {
  @IsOptional() @IsIn(bannerPositions) position?: BannerPosition;
  /** A market's code, or null for every market. */
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string | null;
  @IsOptional() @IsString() @MaxLength(500) image_url?: string;
  @IsOptional() @IsString() @MaxLength(500) href?: string;
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
  /** The gate: off, it never shows. */
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) starts_at?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) ends_at?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

/** udozo.com's banner ads in a place, for a market (public; a minute in caches). */
@ApiExcludeController()
@Public()
@Controller('classifieds/banners')
@ProductOnly('udozo')
export class ClassifiedBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  async showing(@Query() query: ShowingQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.banners.showing(query.position, query.country ?? null);
  }
}

/** Admins: banner ads on udozo.com (operations change them; support reads). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/banners')
@ProductOnly('udozo')
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() query: ListQueryDto) {
    return this.banners.list(query);
  }

  @AdminRoles('operations')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: BannerDto) {
    return this.banners.create(adminId(caller), body);
  }

  @AdminRoles('operations')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BannerDto) {
    return this.banners.update(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.banners.remove(adminId(caller), id);
  }
}
