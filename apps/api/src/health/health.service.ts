import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

type DatabaseStatus = 'ok' | 'unavailable' | 'not_configured';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const database = await this.database();
    return {
      status: database === 'unavailable' ? 'degraded' : 'ok',
      service: 'bitocard-api',
      environment: process.env.VERCEL_ENV ?? 'local',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checks: { database },
    };
  }

  private async database(): Promise<DatabaseStatus> {
    if (!this.prisma.configured) return 'not_configured';
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      return 'ok';
    } catch {
      return 'unavailable';
    }
  }
}
