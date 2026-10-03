import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, RealmOnly } from '../auth/caller';
import type { LedgerMode } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AdminOverviewService } from './overview.service';

class OverviewQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
}

/** The admin dashboard. Admin only; never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/overview')
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @AdminRoles('operations', 'support', 'finance')
  @Get()
  get(@Query() query: OverviewQueryDto) {
    return this.overview.overview({ days: query.days ?? 30, mode: query.mode ?? 'live' });
  }
}

class ActivityQueryDto {
  @IsOptional() @IsString() @Length(1, 40) target_type?: string;
  @IsOptional() @IsUUID() actor_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() starting_after?: string;
}

/** Every admin change across the platform (the audit trail), newest first. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/activity')
export class AdminActivityController {
  constructor(private readonly prisma: PrismaService) {}

  @AdminRoles('operations', 'support', 'finance')
  @Get()
  async list(@Query() query: ActivityQueryDto) {
    const limit = query.limit ?? 50;
    const entries = await this.prisma.auditLog.findMany({
      where: { targetType: query.target_type, actorId: query.actor_id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.starting_after ? { cursor: { id: query.starting_after }, skip: 1 } : {}),
    });
    const actorIds = [...new Set(entries.map(entry => entry.actorId).filter((id): id is string => id !== null))];
    const actors = new Map((await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })).map(user => [user.id, user]));
    return {
      object: 'list' as const,
      data: entries.slice(0, limit).map(entry => ({
        object: 'audit_entry' as const,
        id: entry.id,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        actor: entry.actorId ? (actors.get(entry.actorId) ?? { id: entry.actorId, name: null, email: null }) : null,
        before: entry.before,
        after: entry.after,
        created_at: entry.createdAt.toISOString(),
      })),
      has_more: entries.length > limit,
    };
  }
}

@Module({ controllers: [AdminOverviewController, AdminActivityController], providers: [AdminOverviewService] })
export class AdminModule {}
