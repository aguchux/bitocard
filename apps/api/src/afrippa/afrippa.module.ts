import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { CustomerGuard } from '../customers/customer-session.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AfrippaAccountController, AfrippaTraderAdminController } from './accounts.controller.js';
import { AfrippaBooksController } from './books.controller.js';
import { AfrippaBooksService } from './books.service.js';
import { AfrippaFeeRatesAdminController, AfrippaOrdersAdminController, P2pOrdersController } from './orders.controller.js';
import { P2pOrdersService } from './orders.service.js';
import { PaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { TraderGoogleService } from './google.service.js';
import { TraderTwoStepService } from './two-step.service.js';

/** Afrippa's own surface in the API (docs/CRYPTO_SPINOFF_PLAN.md, step 2): its traders' accounts and their two-step sign-in, their payment methods and P2P orders, and its own books. */
@Module({
  imports: [CheckoutModule, CryptoModule, IdentityModule],
  controllers: [AfrippaAccountController, AfrippaTraderAdminController, AfrippaBooksController, PaymentMethodsController, P2pOrdersController, AfrippaOrdersAdminController, AfrippaFeeRatesAdminController],
  providers: [TraderTwoStepService, TraderGoogleService, AfrippaBooksService, PaymentMethodsService, P2pOrdersService, CustomerGuard],
  exports: [TraderTwoStepService, PaymentMethodsService, P2pOrdersService],
})
export class AfrippaModule {}
