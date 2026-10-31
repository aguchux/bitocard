import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';

type DatabaseStatus = 'ok' | 'unavailable' | 'not_configured';

/**
 * A short fingerprint of the database an instance uses (its host and name, hashed): BitoCard's and Udozo's instances on
 * one droplet each show theirs, so a deploy can check neither reaches the other's (docs/UDOZO_SPINOFF_PLAN.md, step 5)
 * without naming either database.
 */
export function databaseId(url: string | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/-pooler(?=\.)/, '');
    return createHash('sha256').update(`${host}/${parsed.pathname.replace(/^\//, '')}`).digest('hex').slice(0, 8);
  } catch {
    return null;
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async status() {
    const database = await this.database();
    return {
      status: database === 'unavailable' ? 'degraded' : 'ok',
      service: `${this.config.APP_PRODUCT}-api`,
      product: this.config.APP_PRODUCT,
      environment: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'local',
      // The droplet's deploy sets GIT_COMMIT_SHA; Vercel sets its own.
      commit: (process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) ?? null,
      database_id: databaseId(this.config.DATABASE_URL),
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
