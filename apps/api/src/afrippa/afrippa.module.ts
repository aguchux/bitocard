import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CustomerGuard } from '../customers/customer-session.js';
import { AfrippaAccountController, AfrippaTraderAdminController } from './accounts.controller.js';
import { AfrippaBooksController } from './books.controller.js';
import { AfrippaBooksService } from './books.service.js';
import { TraderGoogleService } from './google.service.js';
import { TraderTwoStepService } from './two-step.service.js';

/** Afrippa's own surface in the API (docs/CRYPTO_SPINOFF_PLAN.md, step 2): its traders' accounts and their two-step sign-in, and its own books. */
@Module({
  imports: [CheckoutModule],
  controllers: [AfrippaAccountController, AfrippaTraderAdminController, AfrippaBooksController],
  providers: [TraderTwoStepService, TraderGoogleService, AfrippaBooksService, CustomerGuard],
  exports: [TraderTwoStepService],
})
export class AfrippaModule {}
