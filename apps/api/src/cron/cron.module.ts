import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FxModule } from '../fx/fx.module.js';
import { NumbersModule } from '../numbers/numbers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { ResellerIntegrationsModule } from '../reseller-integrations/reseller-integrations.module.js';
import { CronController } from './cron.controller.js';

@Module({ imports: [CheckoutModule, FxModule, PaymentsModule, PayoutsModule, BillingModule, OrdersModule, NumbersModule, IdentityModule, ResellerIntegrationsModule], controllers: [CronController] })
export class CronModule {}
