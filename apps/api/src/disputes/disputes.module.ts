import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminDisputesController, CustomerDisputesController, DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  imports: [OrdersModule, PaymentsModule, CheckoutModule],
  controllers: [DisputesController, CustomerDisputesController, AdminDisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
