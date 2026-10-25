import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FxModule } from '../fx/fx.module.js';
import { NumbersModule } from '../numbers/numbers.module.js';
import { EsimsModule } from '../esims/esims.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { ResellerIntegrationsModule } from '../reseller-integrations/reseller-integrations.module.js';
import { DomainsModule } from '../domains/domains.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { CronController } from './cron.controller.js';
import { SupportModule } from '../support/support.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';

@Module({ imports: [CheckoutModule, CryptoModule, FxModule, PaymentsModule, PayoutsModule, BillingModule, OrdersModule, NumbersModule, EsimsModule, IdentityModule, ResellerIntegrationsModule, DomainsModule, StoresModule, SupportModule, ClassifiedsModule], controllers: [CronController] })
export class CronModule {}
