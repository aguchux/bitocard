import { Module } from '@nestjs/common';
import { DomainsModule } from '../domains/domains.module.js';
import { FxModule } from '../fx/fx.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { AdminStoreSubscriptionsController, BillingController, StoreSubscriptionsController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { AdminInvoicesController, InvoicesController } from './invoices.controller.js';
import { StoreSubscriptionsService } from './store-subscriptions.service.js';
import { AdminSetupFeesController, SetupFeeController } from './setup-fees.controller.js';
import { SetupFeesService } from './setup-fees.service.js';

@Module({
  imports: [FxModule, PlansModule, DomainsModule],
  controllers: [BillingController, StoreSubscriptionsController, AdminStoreSubscriptionsController, InvoicesController, AdminInvoicesController, SetupFeeController, AdminSetupFeesController],
  providers: [BillingService, StoreSubscriptionsService, SetupFeesService],
  exports: [BillingService, StoreSubscriptionsService, SetupFeesService],
})
export class BillingModule {}
