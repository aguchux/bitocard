import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { AdminTicketsController, CustomerTicketsController, TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Support: tickets now; chat and support bots come next (docs/BITOCARD_SUPPORT_ASSISTANT_PLAN.md). */
@Module({
  imports: [CheckoutModule],
  controllers: [TicketsController, CustomerTicketsController, AdminTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class SupportModule {}
