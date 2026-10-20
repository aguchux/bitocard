import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { AdminStoreSubscriptionsController, BillingController, StoreSubscriptionsController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { StoreSubscriptionsService } from './store-subscriptions.service.js';

@Module({
  imports: [FxModule, PlansModule],
  controllers: [BillingController, StoreSubscriptionsController, AdminStoreSubscriptionsController],
  providers: [BillingService, StoreSubscriptionsService],
  exports: [BillingService, StoreSubscriptionsService],
})
export class BillingModule {}
