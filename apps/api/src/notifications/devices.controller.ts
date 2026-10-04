import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { type Caller, CurrentCaller, RealmOnly, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { type PushCaller, PushService } from './push.service.js';

class PushKeysDto {
  @ApiProperty({ description: 'The subscription’s P-256 public key (base64url), from `PushSubscription.toJSON().keys`.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{80,100}$/, { message: 'p256dh must be a base64url key' })
  p256dh: string;

  @ApiProperty({ description: 'The subscription’s auth secret (base64url).' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,30}$/, { message: 'auth must be a base64url secret' })
  auth: string;
}

class RegisterDeviceDto {
  @ApiProperty({ description: 'The push service address, from `PushSubscription.endpoint`.' })
  @IsString()
  @Length(10, 1000)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @ApiPropertyOptional({ description: 'How the device is shown; defaults to the browser and system, for example "Chrome on Windows".' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

class PreferenceDto {
  @ApiProperty({ description: 'Push this notification type to your devices.' })
  @IsBoolean()
  push: boolean;
}

/** The signed-in person (sessions only: API keys never register devices). */
function pushCaller(caller: Caller): PushCaller {
  if (caller.kind !== 'session') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'session_required', 'Sign in to do this; API keys cannot.');
  return { owner: { userId: caller.userId }, audience: caller.realm, sessionId: caller.sessionId, adminRoles: caller.adminRoles };
}

/**
 * Push notifications to your own devices: each browser you turn them on in is registered with its own ID, receives
 * your notifications while you stay signed in there, and is dropped when you sign out. Choose which notifications are
 * pushed; urgent and security ones always are.
 */
@ApiTags('Notifications')
@SessionOnly()
@Controller()
export class DevicesController {
  constructor(private readonly push: PushService) {}

  @ApiOperation({ summary: 'Get the push key', description: 'Whether push is switched on, and the public key a browser subscribes with.' })
  @Get('devices/push-settings')
  settings() {
    return this.push.settings();
  }

  @ApiOperation({ summary: 'List your devices' })
  @Get('devices')
  list(@CurrentCaller() caller: Caller) {
    return this.push.list(pushCaller(caller));
  }

  @ApiOperation({ summary: 'Register this browser for push', description: 'Send the browser’s push subscription. Registering the same browser again updates it.' })
  @Post('devices')
  register(@CurrentCaller() caller: Caller, @Body() body: RegisterDeviceDto, @Req() req: Request) {
    return this.push.register(pushCaller(caller), body, req.get('user-agent'));
  }

  @ApiOperation({ summary: 'Send a test push to a device' })
  @Post('devices/:id/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.push.test(pushCaller(caller), id);
  }

  @ApiOperation({ summary: 'Remove a device', description: 'It gets no more pushes.' })
  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.push.remove(pushCaller(caller), id);
  }

  @ApiOperation({ summary: 'List your push preferences', description: 'Every notification you can get, and whether it is pushed. `locked` ones are always pushed.' })
  @Get('notification-preferences')
  preferences(@CurrentCaller() caller: Caller) {
    return this.push.preferences(pushCaller(caller));
  }

  @ApiOperation({ summary: 'Choose whether a notification is pushed' })
  @Put('notification-preferences/:type')
  setPreference(@CurrentCaller() caller: Caller, @Param('type') type: string, @Body() body: PreferenceDto) {
    return this.push.setPreference(pushCaller(caller), type, body.push);
  }
}

/** The same for admins, in the admin app. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminDevicesController {
  constructor(private readonly push: PushService) {}

  @Get('devices/push-settings')
  settings() {
    return this.push.settings();
  }

  @Get('devices')
  list(@CurrentCaller() caller: Caller) {
    return this.push.list(pushCaller(caller));
  }

  @Post('devices')
  register(@CurrentCaller() caller: Caller, @Body() body: RegisterDeviceDto, @Req() req: Request) {
    return this.push.register(pushCaller(caller), body, req.get('user-agent'));
  }

  @Post('devices/:id/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.push.test(pushCaller(caller), id);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.push.remove(pushCaller(caller), id);
  }

  @Get('notification-preferences')
  preferences(@CurrentCaller() caller: Caller) {
    return this.push.preferences(pushCaller(caller));
  }

  @Put('notification-preferences/:type')
  setPreference(@CurrentCaller() caller: Caller, @Param('type') type: string, @Body() body: PreferenceDto) {
    return this.push.setPreference(pushCaller(caller), type, body.push);
  }
}
