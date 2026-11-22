import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { type Caller, CurrentCaller, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { ProductOnly } from '../products/product.js';

const dayMs = 86_400_000;

class OverviewQuery {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30])
  days?: 7 | 30;
}

type DayRow = { day: Date; count: bigint };

/** Whether the account can switch to live, and why not. */
function liveReadiness(reseller: { status: string; verifiedAt: Date | null; testAccountAt: Date | null }) {
  if (reseller.status === 'suspended') return { ready: false, reason: 'suspended' as const };
  if (reseller.status === 'active') return { ready: true, reason: reseller.verifiedAt ? ('verified' as const) : ('test_account' as const) };
  return { ready: false, reason: reseller.verifiedAt ? ('awaiting_activation' as const) : ('identity_check' as const) };
}

/**
 * SHQ's Developers > Overview: one environment's API keys, webhook endpoints, deliveries, events and orders over the
 * last 7 or 30 days, with both environments side by side and whether live is open. Only the account's own figures.
 */
@Injectable()
export class DevelopersService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(resellerId: string, mode: LedgerMode, days: 7 | 30) {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const since = new Date(today - (days - 1) * dayMs);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { status: true, verifiedAt: true, testAccountAt: true } });

    const usableKey = (keyMode: LedgerMode) => ({ resellerId, mode: keyMode, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
    const [keys, lastUsed, keysUsed, endpoints, liveKeys, testKeys, liveEndpoints, testEndpoints] = await Promise.all([
      this.prisma.apiKey.count({ where: usableKey(mode) }),
      this.prisma.apiKey.findFirst({ where: { resellerId, mode, lastUsedAt: { not: null } }, orderBy: { lastUsedAt: 'desc' }, select: { lastUsedAt: true, name: true } }),
      this.prisma.apiKey.count({ where: { ...usableKey(mode), lastUsedAt: { gte: since } } }),
      this.prisma.webhookEndpoint.findMany({ where: { resellerId, mode }, select: { status: true, failingSince: true } }),
      this.prisma.apiKey.count({ where: usableKey('live') }),
      this.prisma.apiKey.count({ where: usableKey('test') }),
      this.prisma.webhookEndpoint.count({ where: { resellerId, mode: 'live', status: 'enabled' } }),
      this.prisma.webhookEndpoint.count({ where: { resellerId, mode: 'test', status: 'enabled' } }),
    ]);

    const deliveryWhere = { endpoint: { resellerId, mode }, createdAt: { gte: since } };
    const [deliveries, eventTypes, orders, apiOrders, eventDays, deliveryDays, orderDays] = await Promise.all([
      this.prisma.webhookDelivery.groupBy({ by: ['status'], where: deliveryWhere, _count: { _all: true } }),
      this.prisma.event.groupBy({ by: ['type'], where: { resellerId, mode, endpointId: null, createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { type: 'desc' } }, take: 6 }),
      this.prisma.order.groupBy({ by: ['status'], where: { resellerId, mode, createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.order.count({ where: { resellerId, mode, createdAt: { gte: since }, customerId: null } }),
      this.prisma.$queryRaw<DayRow[]>`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(*)::bigint AS count FROM events
        WHERE reseller_id = ${resellerId}::uuid AND mode = ${mode}::"LedgerMode" AND endpoint_id IS NULL AND created_at >= ${since}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<DayRow & { status: string }>>`
        SELECT date_trunc('day', d.created_at AT TIME ZONE 'UTC') AS day, d.status::text AS status, count(*)::bigint AS count
        FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE e.reseller_id = ${resellerId}::uuid AND e.mode = ${mode}::"LedgerMode" AND d.created_at >= ${since}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(*)::bigint AS count FROM orders
        WHERE reseller_id = ${resellerId}::uuid AND mode = ${mode}::"LedgerMode" AND created_at >= ${since}
        GROUP BY 1`,
    ]);

    const count = <T extends { _count: { _all: number } }>(rows: T[], match: (row: T) => boolean) => rows.filter(match).reduce((sum, row) => sum + row._count._all, 0);
    const succeeded = count(deliveries, row => row.status === 'succeeded');
    const failed = count(deliveries, row => row.status === 'failed');
    const pending = count(deliveries, row => row.status === 'pending');
    const finished = succeeded + failed;
    const dayKey = (value: Date) => new Date(value).toISOString().slice(0, 10);
    const series = Array.from({ length: days }, (_, index) => {
      const day = new Date(since.getTime() + index * dayMs).toISOString().slice(0, 10);
      const of = (rows: DayRow[]) => Number(rows.find(row => dayKey(row.day) === day)?.count ?? 0);
      return {
        day,
        events: of(eventDays),
        orders: of(orderDays),
        deliveries_succeeded: of(deliveryDays.filter(row => row.status === 'succeeded')),
        deliveries_failed: of(deliveryDays.filter(row => row.status === 'failed')),
      };
    });

    return {
      object: 'developer_overview' as const,
      mode,
      days,
      from: since.toISOString().slice(0, 10),
      live: liveReadiness(reseller),
      environments: {
        live: { api_keys: liveKeys, webhook_endpoints: liveEndpoints },
        test: { api_keys: testKeys, webhook_endpoints: testEndpoints },
      },
      api_keys: { active: keys, used_in_period: keysUsed, last_used_at: lastUsed?.lastUsedAt?.toISOString() ?? null, last_used_by: lastUsed?.name ?? null },
      webhooks: {
        endpoints: endpoints.length,
        enabled: endpoints.filter(item => item.status === 'enabled').length,
        disabled: endpoints.filter(item => item.status !== 'enabled').length,
        failing: endpoints.filter(item => item.status === 'enabled' && item.failingSince).length,
      },
      deliveries: { total: succeeded + failed + pending, succeeded, failed, pending, success_rate: finished ? Math.round((succeeded / finished) * 1000) / 10 : null },
      events: { total: eventDays.reduce((sum, row) => sum + Number(row.count), 0), top_types: eventTypes.map(row => ({ type: row.type, count: row._count._all })) },
      orders: {
        total: count(orders, () => true),
        completed: count(orders, row => row.status === 'completed'),
        processing: count(orders, row => row.status === 'processing'),
        failed: count(orders, row => row.status === 'failed'),
        refunded: count(orders, row => row.status === 'refunded'),
        through_api: apiOrders,
      },
      series,
    };
  }
}

/** Dashboard sessions only: what the Developers overview shows. The mode comes from `BitoCard-Mode`, as everywhere. */
@ApiExcludeController()
@ProductOnly('bitocard')
@SessionOnly()
@Roles('admin', 'developer')
@Controller('developers')
export class DevelopersController {
  constructor(private readonly developers: DevelopersService) {}

  @Get('overview')
  overview(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: OverviewQuery) {
    return this.developers.overview(resellerOf(caller), mode, query.days ?? 7);
  }
}

@Module({ controllers: [DevelopersController], providers: [DevelopersService] })
export class DevelopersModule {}
