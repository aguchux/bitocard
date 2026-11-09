import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { InboxService } from './inbox.service.js';
import { type PushCaller, PushService } from './push.service.js';

class NotificationsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

class PushKeysDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{80,100}$/, { message: 'p256dh must be a base64url key' })
  p256dh: string;

  @IsString() @Matches(/^[A-Za-z0-9_-]{16,30}$/, { message: 'auth must be a base64url secret' })
  auth: string;
}

class RegisterDeviceDto {
  @IsString() @Length(10, 1000)
  endpoint: string;

  @ValidateNested() @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @IsOptional() @IsString() @MaxLength(80)
  label?: string;
}

class PreferenceDto {
  @IsBoolean()
  push: boolean;
}

/** The signed-in customer's own browsers, on their account's store (one Udozo account on udozo.com and every store). */
const pushCaller = (caller: CustomerCaller): PushCaller => ({ owner: { customerId: caller.customer.id }, audience: 'customer', sessionId: caller.sessionId, storeId: caller.customer.storeId, platform: 'bitocard' });

/**
 * A Udozo customer's inbox and push on udozo.com: what Udozo tells them about their listings, chats, requests, buy
 * orders, UdozoPay orders, reviews, payouts and account, newest first, each read or not; the browsers they turned
 * push on in (pushed while that session stays signed in) and which notices are pushed (security ones always are).
 * Read by udozo.com's server with the customer's session.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@ProductOnly('udozo')
@Controller('store/account')
export class CustomerNotificationsController {
  constructor(
    private readonly inbox: InboxService,
    private readonly push: PushService,
  ) {}

  @Get('notifications')
  list(@CurrentCustomer() caller: CustomerCaller, @Query() filter: NotificationsDto) {
    return this.inbox.list({ customerId: caller.customer.id }, filter);
  }

  @Get('notifications/unread-count')
  async unread(@CurrentCustomer() caller: CustomerCaller) {
    return { object: 'unread_count' as const, count: await this.inbox.unreadCount({ customerId: caller.customer.id }) };
  }

  @Post('notifications/read-all')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentCustomer() caller: CustomerCaller) {
    return this.inbox.markAllRead({ customerId: caller.customer.id });
  }

  @Post('notifications/:id/read')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  read(@CurrentCustomer() caller: CustomerCaller, @Param('id') id: string) {
    return this.inbox.markRead({ customerId: caller.customer.id }, id);
  }

  @Get('devices/push-settings')
  settings() {
    return this.push.settings('bitocard');
  }

  @Get('devices')
  devices(@CurrentCustomer() caller: CustomerCaller) {
    return this.push.list(pushCaller(caller));
  }

  @Post('devices')
  @SkipIdempotency()
  register(@CurrentCustomer() caller: CustomerCaller, @Body() body: RegisterDeviceDto, @Req() req: Request) {
    // udozo.com's server forwards its visitor's browser, for the device's label.
    const agent = req.get('bitocard-client-agent') ?? req.get('user-agent');
    return this.push.register(pushCaller(caller), body, agent);
  }

  @Post('devices/:id/test')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  test(@CurrentCustomer() caller: CustomerCaller, @Param('id') id: string) {
    return this.push.test(pushCaller(caller), id);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentCustomer() caller: CustomerCaller, @Param('id') id: string) {
    await this.push.remove(pushCaller(caller), id);
  }

  @Get('notification-preferences')
  preferences(@CurrentCustomer() caller: CustomerCaller) {
    return this.push.preferences(pushCaller(caller));
  }

  @Put('notification-preferences/:type')
  setPreference(@CurrentCustomer() caller: CustomerCaller, @Param('type') type: string, @Body() body: PreferenceDto) {
    return this.push.setPreference(pushCaller(caller), type, body.push);
  }
}
