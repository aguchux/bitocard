import { DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuditModule } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CountriesModule } from './countries/countries.module.js';
import { PlansModule } from './plans/plans.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StoresModule } from './stores/stores.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { TeamModule } from './team/team.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CronModule } from './cron/cron.module.js';
import { FxModule } from './fx/fx.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProvidersModule } from './payments/providers.module.js';
import { PayoutsModule } from './payouts/payouts.module.js';
import { TaxModule } from './tax/tax.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { AdminModule } from './admin/admin.module.js';
import { IntegrationsAdminModule } from './integrations/integrations.admin.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { ResellerIntegrationsModule } from './reseller-integrations/reseller-integrations.module.js';
import { FeesModule } from './fees/fees.module.js';
import { StorefrontModule } from './storefront/storefront.module.js';
import { ApiExceptionFilter } from './common/errors/api-exception.filter.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard.js';
import { loggerParams } from './common/request/logging.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import type { DatabaseAdapter } from './database/prisma.service.js';
import { HealthModule } from './health/health.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

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
        IntegrationsModule,
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
        WebhooksModule,
        IdentityModule,
        AdminModule,
        IntegrationsAdminModule,
        ResellerIntegrationsModule,
        FeesModule,
        StorefrontModule,
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
