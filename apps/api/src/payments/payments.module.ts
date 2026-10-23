import { FxModule } from '../fx/fx.module.js';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PaymentsController } from './payments.controller.js';
import { AdminChargebacksController } from './chargebacks.controller.js';
import { ChargebacksService } from './chargebacks.service.js';
import { AdminPaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { AdminPawapayCoverageController, PawapayCoverageService } from './pawapay-coverage.js';
import { PaymentsService } from './payments.service.js';
import { AdminReservedAccountsController, ReservedAccountsAdminService } from './reserved-accounts.admin.js';
import { ProviderWebhooksController } from './webhooks.controller.js';

@Module({
  imports: [PayoutsModule, IdentityModule, SettingsModule, FxModule],
  controllers: [PaymentsController, ProviderWebhooksController, AdminPaymentMethodsController, AdminChargebacksController, AdminPawapayCoverageController, AdminReservedAccountsController],
  providers: [PaymentsService, PaymentMethodsService, ChargebacksService, PawapayCoverageService, ReservedAccountsAdminService],
  exports: [PaymentsService, PaymentMethodsService, ChargebacksService],
})
export class PaymentsModule {}
