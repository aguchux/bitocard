import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { ProviderWebhooksController } from './webhooks.controller.js';

@Module({
  imports: [PayoutsModule, IdentityModule],
  controllers: [PaymentsController, ProviderWebhooksController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
