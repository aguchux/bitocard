import { DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { loggerParams } from './common/request/logging';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import type { DatabaseAdapter } from './database/prisma.service';
import { HealthModule } from './health/health.module';

export type AppOptions = {
  /** Database driver adapter to use instead of DATABASE_URL (tests use an in-process Postgres). */
  databaseAdapter?: DatabaseAdapter;
  /** Extra modules mounted alongside the app (tests use this for fixture endpoints). */
  extraModules?: Type[];
};

@Module({})
export class AppModule {
  static register(options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule,
        LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (config: AppConfig) => loggerParams(config) }),
        DatabaseModule.register(options.databaseAdapter),
        HealthModule,
        ...(options.extraModules ?? []),
      ],
      controllers: [AppController],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
