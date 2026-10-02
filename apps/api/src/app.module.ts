import { DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { CountriesModule } from './countries/countries.module';
import { PlansModule } from './plans/plans.module';
import { SettingsModule } from './settings/settings.module';
import { StoresModule } from './stores/stores.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { TeamModule } from './team/team.module';
import { BillingModule } from './billing/billing.module';
import { CronModule } from './cron/cron.module';
import { FxModule } from './fx/fx.module';
import { LedgerModule } from './ledger/ledger.module';
import { PaymentsModule } from './payments/payments.module';
import { ProvidersModule } from './payments/providers.module';
import { PayoutsModule } from './payouts/payouts.module';
import { TaxModule } from './tax/tax.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { OrdersModule } from './orders/orders.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { loggerParams } from './common/request/logging';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import type { DatabaseAdapter } from './database/prisma.service';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';

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
        NotificationsModule,
        AuditModule,
        CountriesModule,
        SettingsModule,
        PlansModule,
        StoresModule,
        HealthModule,
        AuthModule,
        ApiKeysModule,
        TeamModule,
        LedgerModule,
        ProvidersModule,
        FxModule,
        PaymentsModule,
        PayoutsModule,
        TaxModule,
        BillingModule,
        SuppliersModule,
        CatalogueModule,
        OrdersModule,
        CronModule,
        ...(options.extraModules ?? []),
      ],
      controllers: [AppController],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        // Guards run in this order: identify the caller, then rate-limit per caller.
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
