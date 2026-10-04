import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, personOf, RealmOnly, SessionOnly } from '../auth/caller.js';
import { InboxService } from './inbox.service.js';

class NotificationFilterDto {
  @ApiPropertyOptional({ description: 'Only unread notifications.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'The last notification ID of the previous page.' })
  @IsOptional()
  @IsUUID()
  starting_after?: string;
}

/**
 * Your notifications in SHQ: what needs your attention in the reseller account you are using, by your role, and your
 * own security notices. Dashboard only; each person reads their own.
 */
@ApiTags('Notifications')
@SessionOnly()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @ApiOperation({ summary: 'List your notifications', description: 'Newest first, with your unread count.' })
  @Get()
  list(@CurrentCaller() caller: Caller, @Query() filter: NotificationFilterDto) {
    return this.inbox.list({ userId: personOf(caller), resellerId: caller.resellerId }, filter);
  }

  @ApiOperation({ summary: 'Count your unread notifications' })
  @Get('unread-count')
  async unread(@CurrentCaller() caller: Caller) {
    return { object: 'unread_count' as const, count: await this.inbox.unreadCount({ userId: personOf(caller), resellerId: caller.resellerId }) };
  }

  @ApiOperation({ summary: 'Mark every notification read' })
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentCaller() caller: Caller) {
    return this.inbox.markAllRead({ userId: personOf(caller), resellerId: caller.resellerId });
  }

  @ApiOperation({ summary: 'Mark a notification read' })
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.inbox.markRead({ userId: personOf(caller), resellerId: caller.resellerId }, id);
  }
}

/** Admins: their own notifications in the admin app, by admin role. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentCaller() caller: Caller, @Query() filter: NotificationFilterDto) {
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
  read(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.inbox.markRead({ userId: personOf(caller) }, id);
  }
}
