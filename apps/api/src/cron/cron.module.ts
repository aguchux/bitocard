import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FxModule } from '../fx/fx.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { CronController } from './cron.controller.js';

@Module({ imports: [FxModule, PaymentsModule, PayoutsModule, BillingModule, OrdersModule, IdentityModule], controllers: [CronController] })
export class CronModule {}
