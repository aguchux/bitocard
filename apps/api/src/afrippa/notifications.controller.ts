import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, personOf, Public, RealmOnly } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { InboxService } from '../notifications/inbox.service.js';

class TraderNotificationsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

/**
 * A trader's inbox on Afrippa's site (docs/CRYPTO_SPINOFF_PLAN.md, step 4): the notices Afrippa leaves them (orders,
 * the order room, deposits and withdrawals, security), their own only, newest first. Under `/v1/afrippa/account`, so
 * only Afrippa's signed server reaches it, past two-step.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/account/notifications')
export class TraderNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() filter: TraderNotificationsDto) {
    return this.inbox.list({ customerId: caller.customer.id }, filter);
  }

  @Get('unread-count')
  async unread(@CurrentCustomer() caller: CustomerCaller) {
    return { object: 'unread_count' as const, count: await this.inbox.unreadCount({ customerId: caller.customer.id }) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentCustomer() caller: CustomerCaller) {
    return this.inbox.markAllRead({ customerId: caller.customer.id });
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markRead({ customerId: caller.customer.id }, id);
  }
}

/**
 * Afrippa's admins' own inbox (admin.afrippa.com): appeals, reports and the crypto alerts, by their roles. BitoCard's
 * admins never see these, nor Afrippa's admins BitoCard's.
 */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@Controller('afrippa/admin/notifications')
export class AfrippaAdminNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentCaller() caller: Caller, @Query() filter: TraderNotificationsDto) {
    return this.inbox.list({ userId: personOf(caller) }, filter);
  }

  @Get('unread-count')
  async unread(@CurrentCaller() caller: Caller) {
    return { object: 'unread_count' as const, count: await this.inbox.unreadCount({ userId: personOf(caller) }) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentCaller() caller: Caller) {
    return this.inbox.markAllRead({ userId: personOf(caller) });
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markRead({ userId: personOf(caller) }, id);
  }
}
