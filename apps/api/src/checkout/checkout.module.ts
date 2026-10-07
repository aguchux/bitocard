import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { FeesModule } from '../fees/fees.module.js';
import { CustomerGuard } from '../customers/customer-session.js';
import { CustomersService } from '../customers/customers.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ResellerIntegrationsModule } from '../reseller-integrations/reseller-integrations.module.js';
import { CheckoutController, CustomerAccountController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { HouseService } from './house.service.js';
import { StoreSellers } from './store-sellers.js';

/** Store customers (accounts and sign-in) and checkout on hosted stores: bitocard.com and resellers' stores. */
@Module({
  imports: [AuthModule, CatalogueModule, FeesModule, IdentityModule, OrdersModule, PaymentsModule, ResellerIntegrationsModule],
  controllers: [CustomerAccountController, CheckoutController],
  providers: [CustomersService, CustomerGuard, CheckoutService, HouseService, StoreSellers],
  exports: [CheckoutService, HouseService, CustomersService, StoreSellers],
})
export class CheckoutModule {}
