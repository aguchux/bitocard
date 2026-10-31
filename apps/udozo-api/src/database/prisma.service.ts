import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const PRISMA_ADAPTER = Symbol('PRISMA_ADAPTER');

export type DatabaseAdapter = Extract<Prisma.PrismaClientOptions, { adapter: unknown }>['adapter'];

/**
 * The database client. Uses the Postgres driver adapter with DATABASE_URL, or an adapter supplied
 * through createApp (tests use an in-process Postgres). Connects lazily on the first query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly configured: boolean;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(PRISMA_ADAPTER) adapter: DatabaseAdapter | null,
  ) {
    const resolved = adapter ?? (config.DATABASE_URL ? new PrismaPg({ connectionString: config.DATABASE_URL }) : null);
    // Without a database the client is still constructed so the app can start; queries then fail with database_unavailable.
    super({ adapter: resolved ?? new PrismaPg({ connectionString: 'postgresql://unconfigured.invalid/none' }) });
    this.configured = resolved !== null;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
