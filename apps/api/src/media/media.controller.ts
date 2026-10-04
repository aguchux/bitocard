import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { MediaService } from './media.service.js';
import { mediaPurposeKeys } from './purposes.js';

class UploadDto {
  /** Checked against the caller's realm in the service, so the message lists only what they may upload. */
  @IsString() @Length(1, 40) purpose: string;
  @IsOptional() @IsString() @Length(1, 200) target_id?: string;
  @IsString() @Length(1, 200) filename: string;
  @IsString() @Length(3, 100) content_type: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(50 * 1024 * 1024) size: number;
}

class MediaQueryDto {
  @IsOptional() @IsIn(mediaPurposeKeys) purpose?: string;
  @IsOptional() @IsString() @Length(1, 200) target_id?: string;
  /** Admins: platform, resellers, or one reseller's ID. */
  @IsOptional() @IsString() @Length(1, 40) owner?: string;
  @IsOptional() @IsString() @Length(1, 80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() starting_after?: string;
}

/** Admins: logos, icons and images for brands, products, suppliers, categories and the storefront. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  private actor(caller: Caller) {
    return { realm: 'admin' as const, userId: adminId(caller) };
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('settings')
  settings() {
    return this.media.settings('admin');
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get()
  list(@CurrentCaller() caller: Caller, @Query() query: MediaQueryDto) {
    return this.media.list(this.actor(caller), query);
  }

  @AdminRoles('operations')
  @Post('uploads')
  upload(@CurrentCaller() caller: Caller, @Body() body: UploadDto) {
    return this.media.createUpload(this.actor(caller), body);
  }

  @AdminRoles('operations')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.complete(this.actor(caller), id);
  }

  @AdminRoles('operations')
  @Delete(':id')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(this.actor(caller), id);
  }
}

/** Resellers (SHQ only): images for their own store, kept in their own folder. */
@ApiExcludeController()
@SessionOnly()
@Controller('media')
export class ResellerMediaController {
  constructor(private readonly media: MediaService) {}

  private actor(caller: Caller) {
    return { realm: 'reseller' as const, userId: caller.kind === 'session' ? caller.userId : null, resellerId: resellerOf(caller) };
  }

  @Get('settings')
  settings() {
    return this.media.settings('reseller');
  }

  @Get()
  list(@CurrentCaller() caller: Caller, @Query() query: MediaQueryDto) {
    return this.media.list(this.actor(caller), { ...query, owner: undefined });
  }

  @Roles('admin')
  @Post('uploads')
  upload(@CurrentCaller() caller: Caller, @Body() body: UploadDto) {
    return this.media.createUpload(this.actor(caller), body);
  }

  @Roles('admin')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.complete(this.actor(caller), id);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(this.actor(caller), id);
  }
}
