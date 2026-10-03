import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** JSON-safe copy of a record for the audit trail (BigInt and Date become strings). */
function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
}

/** Records every admin change with who made it and the state before and after. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: { actorId: string | null; action: string; targetType: string; targetId: string; before?: unknown; after?: unknown }) {
    return this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: snapshot(entry.before),
        after: snapshot(entry.after),
      },
    });
  }

  list(targetType: string, targetId: string) {
    return this.prisma.auditLog.findMany({ where: { targetType, targetId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
