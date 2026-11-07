import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { mediaSignatureHeader, mediaSignatureValid, photoOwnerHeader } from './watermarks.js';
import { WatermarkService } from './watermarks.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class WatermarkTextDto {
  @Transform(trim) @IsString() @Length(2, 30)
  text!: string;
}

class ClearStoreWatermarkDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason!: string;
}

class StoresQueryDto {
  @IsOptional() @IsString() @MaxLength(60)
  q?: string;
}

class MarkQueryDto {
  /** The store's ID or subdomain; none: Udozo's mark. */
  @IsOptional() @IsString() @MaxLength(60)
  store?: string;
}

/**
 * udozo.com's image route (docs/UDOZO_WATERMARK_PLAN.md): the mark to draw (public, a minute in caches), and a photo's
 * original, for udozo.com's server only (signed with STORE_SERVER_SECRET; anything else answers as an unknown route).
 */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedWatermarkController {
  constructor(
    private readonly watermarks: WatermarkService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('watermark')
  async mark(@Query() query: MarkQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.watermarks.publicMark(query.store);
  }

  @Get('media/:id/original')
  async original(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!mediaSignatureValid(req.get(mediaSignatureHeader), this.config.STORE_SERVER_SECRET, id)) throw new NotFoundException();
    const original = await this.watermarks.original(id);
    if (!original) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', original.contentType);
    res.setHeader('Content-Length', String(original.bytes.length));
    // The seller's username, for the mark across the photo's middle (empty: none chosen yet).
    res.setHeader(photoOwnerHeader, original.username ?? '');
    res.end(original.bytes);
  }

  /** Whose photo it is (`{ username }`, null before they choose one): what udozo.com's image route puts in its address. */
  @Get('media/:id/owner')
  async owner(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    if (!mediaSignatureValid(req.get(mediaSignatureHeader), this.config.STORE_SERVER_SECRET, id)) throw new NotFoundException();
    const owner = await this.watermarks.owner(id);
    if (!owner) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    return { object: 'photo_owner' as const, username: owner.username };
  }
}

/** Admins: Udozo's watermark text (operations change it; support reads) and stores with their own. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/watermark')
@ProductOnly('udozo')
export class AdminWatermarkController {
  constructor(private readonly watermarks: WatermarkService) {}

  @AdminRoles('operations', 'support')
  @Get()
  get() {
    return this.watermarks.settingsView();
  }

  @AdminRoles('operations')
  @Put()
  set(@CurrentCaller() caller: Caller, @Body() body: WatermarkTextDto) {
    return this.watermarks.setText(adminId(caller), body.text);
  }

  @AdminRoles('operations', 'support')
  @Get('stores')
  stores(@Query() query: StoresQueryDto) {
    return this.watermarks.storesWithText(query);
  }
}

/** Admins clear a store's own watermark text (operations; audited, the reseller told). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/stores')
@ProductOnly('udozo')
export class AdminStoreWatermarkController {
  constructor(private readonly watermarks: WatermarkService) {}

  @AdminRoles('operations')
  @Delete(':id/watermark')
  @HttpCode(HttpStatus.OK)
  clear(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ClearStoreWatermarkDto) {
    return this.watermarks.clearStoreText(adminId(caller), id, body.reason);
  }
}
