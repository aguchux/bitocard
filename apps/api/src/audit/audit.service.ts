import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { type Platform, Prisma } from '../generated/prisma/client.js';

/** JSON-safe copy of a record for the audit trail (BigInt and Date become strings). */
function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
}

/**
 * Records every admin change with who made it and the state before and after, in the trail of the product whose admin
 * made it: an Afrippa admin's changes are Afrippa's, read only by Afrippa's admins (`platform`). A change with no actor
 * says whose it is, else it is BitoCard's.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: { actorId: string | null; action: string; targetType: string; targetId: string; before?: unknown; after?: unknown; platform?: Platform }) {
    return this.prisma.auditLog.create({
      data: {
        platform: entry.platform ?? (await this.platformOf(entry.actorId)),
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: snapshot(entry.before),
        after: snapshot(entry.after),
      },
    });
  }

  /** One record's history in a product's trail (BitoCard's unless said). */
  list(targetType: string, targetId: string, platform: Platform = 'bitocard') {
    return this.prisma.auditLog.findMany({ where: { targetType, targetId, platform }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** Afrippa's admins' changes are Afrippa's; everyone else's BitoCard's. */
  private async platformOf(actorId: string | null): Promise<Platform> {
    if (!actorId) return 'bitocard';
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { realm: true } });
    return actor?.realm === 'afrippa_admin' ? 'afrippa' : 'bitocard';
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
