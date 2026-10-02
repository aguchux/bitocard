import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProviderWebhooksController } from './webhooks.controller';

@Module({
  imports: [PayoutsModule, IdentityModule],
  controllers: [PaymentsController, ProviderWebhooksController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
