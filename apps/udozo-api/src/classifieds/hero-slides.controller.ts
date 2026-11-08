import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { type HeroLayout, heroLayouts, type HeroLinkKind, heroLinkKinds, HeroSlidesService, maxHeroSlides } from './hero-slides.service.js';

class PageQueryDto {
  /** A market's code, or `global` for the page across countries. */
  @IsString() @Matches(/^(global|[A-Za-z]{2})$/) page: string;
}

class ScopeQueryDto {
  /** A market's code, or `global` for the columns shown in every market. */
  @IsOptional() @IsString() @Matches(/^(global|[A-Za-z]{2})$/) scope?: string;
}

class LinkDto {
  @IsOptional() @IsIn(heroLinkKinds) kind?: HeroLinkKind;
  /** A listing's number or SKU, a brand's slug, a seller's handle or username, a category's slug, or an address. */
  @IsOptional() @IsString() @MaxLength(500) target?: string;
}

class TileDto {
  @IsOptional() @IsString() @MaxLength(500) image_url?: string;
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
  @IsOptional() @ValidateNested() @Type(() => LinkDto) link?: LinkDto;
  /** Labelled Ad on udozo.com (off for Udozo's own promotions). */
  @IsOptional() @IsBoolean() ad?: boolean;
}

class SlideDto {
  /** A market's code, or null for every market. */
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string | null;
  @IsOptional() @IsIn(heroLayouts) layout?: HeroLayout;
  /** Its banners, top first (as many as the split holds). */
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => TileDto) tiles?: TileDto[];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) starts_at?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) ends_at?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

class TargetsQueryDto {
  @IsIn(['listing', 'brand', 'seller', 'category']) kind: Exclude<HeroLinkKind, 'url'>;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @Matches(/^(global|[A-Za-z]{2})$/) scope?: string;
}

class OrderDto {
  @IsString() @Matches(/^(global|[A-Za-z]{2})$/) scope: string;
  @IsArray() @ArrayMaxSize(maxHeroSlides) @IsUUID('all', { each: true }) ids: string[];
}

/** udozo.com's hero reel for a home page (public; a minute in caches). */
@ApiExcludeController()
@Public()
@Controller('classifieds/hero-slides')
@ProductOnly('udozo')
export class ClassifiedHeroSlidesController {
  constructor(private readonly slides: HeroSlidesService) {}

  @Get()
  async showing(@Query() query: PageQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.slides.showing(query.page);
  }
}

/** Admins: the hero reel's columns (operations change them; support reads). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/hero-slides')
@ProductOnly('udozo')
export class AdminHeroSlidesController {
  constructor(private readonly slides: HeroSlidesService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() query: ScopeQueryDto) {
    return this.slides.list(query.scope ?? 'global');
  }

  /** What a banner's link may point at, as the admin types: listings, brands, sellers or categories (up to 8). */
  @AdminRoles('operations', 'support')
  @Get('targets')
  targets(@Query() query: TargetsQueryDto) {
    return this.slides.suggest(query.kind, query.q ?? '', query.scope ?? 'global');
  }

  @AdminRoles('operations')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: SlideDto) {
    return this.slides.create(adminId(caller), body);
  }

  /** A market's columns in a new order. */
  @AdminRoles('operations')
  @Post('order')
  @HttpCode(HttpStatus.OK)
  reorder(@CurrentCaller() caller: Caller, @Body() body: OrderDto) {
    return this.slides.reorder(adminId(caller), body.scope, body.ids);
  }

  @AdminRoles('operations')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SlideDto) {
    return this.slides.update(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.slides.remove(adminId(caller), id);
  }
}
