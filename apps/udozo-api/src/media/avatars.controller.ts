import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, RealmOnly, SessionOnly } from '../auth/caller.js';
import { ProductOnly } from '../products/product.js';
import { AvatarsService } from './avatars.service.js';

export class AvatarUploadDto {
  @IsString() @Length(1, 200) filename: string;
  @IsString() @Length(3, 100) content_type: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(50 * 1024 * 1024) size: number;
}

export class AvatarSetDto {
  /** The upload's id (`avatar/uploads`), once the file was sent to storage. */
  @IsUUID() media_id: string;
}

const personOf = (caller: Caller) => {
  if (caller.kind !== 'session') throw new Error('A profile photo needs a session');
  return { kind: 'user' as const, id: caller.userId };
};

/** Seller HQ's people: their own profile photo (Settings > Your profile), shown in Seller HQ. */
@ApiExcludeController()
@ProductOnly('udozo')
@SessionOnly()
@Controller('auth/avatar')
export class AvatarController {
  constructor(private readonly avatars: AvatarsService) {}

  @Get('settings')
  settings() {
    return this.avatars.settings();
  }

  @Post('uploads')
  upload(@CurrentCaller() caller: Caller, @Body() body: AvatarUploadDto) {
    return this.avatars.startUpload(personOf(caller), body);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  set(@CurrentCaller() caller: Caller, @Body() body: AvatarSetDto) {
    return this.avatars.set(personOf(caller), body.media_id);
  }

  @Delete()
  async remove(@CurrentCaller() caller: Caller) {
    const { object, avatar_url } = await this.avatars.remove(personOf(caller));
    return { object, avatar_url };
  }
}

/** Udozo's admins: their own profile photo (Your account), shown in the admin. */
@ApiExcludeController()
@ProductOnly('udozo')
@RealmOnly('admin')
@Controller('admin/auth/avatar')
export class AdminAvatarController {
  constructor(private readonly avatars: AvatarsService) {}

  @Get('settings')
  settings() {
    return this.avatars.settings();
  }

  @Post('uploads')
  upload(@CurrentCaller() caller: Caller, @Body() body: AvatarUploadDto) {
    return this.avatars.startUpload(personOf(caller), body);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  set(@CurrentCaller() caller: Caller, @Body() body: AvatarSetDto) {
    return this.avatars.set(personOf(caller), body.media_id);
  }

  @Delete()
  async remove(@CurrentCaller() caller: Caller) {
    const { object, avatar_url } = await this.avatars.remove(personOf(caller));
    return { object, avatar_url };
  }
}
