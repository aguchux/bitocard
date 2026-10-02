import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { IdentityModule } from '../identity/identity.module';
import { FxModule } from '../fx/fx.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { CronController } from './cron.controller';

@Module({ imports: [FxModule, PaymentsModule, PayoutsModule, BillingModule, OrdersModule, IdentityModule], controllers: [CronController] })
export class CronModule {}
