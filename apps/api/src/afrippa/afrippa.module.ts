import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CustomerGuard } from '../customers/customer-session.js';
import { AfrippaAccountController, AfrippaTraderAdminController } from './accounts.controller.js';
import { TraderGoogleService } from './google.service.js';
import { TraderTwoStepService } from './two-step.service.js';

/** Afrippa's own surface in the API (docs/CRYPTO_SPINOFF_PLAN.md, step 2): its traders' accounts and their two-step sign-in. */
@Module({
  imports: [CheckoutModule],
  controllers: [AfrippaAccountController, AfrippaTraderAdminController],
  providers: [TraderTwoStepService, TraderGoogleService, CustomerGuard],
  exports: [TraderTwoStepService],
})
export class AfrippaModule {}
