import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { FeesModule } from '../fees/fees.module.js';
import { FxModule } from '../fx/fx.module.js';
import { EsimsModule } from '../esims/esims.module.js';
import { CustomerGuard } from '../customers/customer-session.js';
import { CustomersService } from '../customers/customers.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ResellerIntegrationsModule } from '../reseller-integrations/reseller-integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { AdminCountryStoresController } from './admin-country-stores.controller.js';
import { CheckoutController, CustomerAccountController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { CustomerWalletController, CustomerWalletsService } from './customer-wallets.js';
import { HouseService } from './house.service.js';
import { AdminStoreCustomersController, StoreCustomersService, StoreCustomersController } from './store-customers.js';
import { StoreSellers } from './store-sellers.js';

/** Store customers (accounts and sign-in) and checkout on hosted stores: bitocard.com and resellers' stores. */
@Module({
  imports: [AuthModule, CatalogueModule, EsimsModule, FeesModule, FxModule, IdentityModule, OrdersModule, PaymentsModule, ResellerIntegrationsModule, SettingsModule, StoresModule],
  controllers: [CustomerAccountController, CheckoutController, CustomerWalletController, StoreCustomersController, AdminStoreCustomersController, AdminCountryStoresController],
  providers: [CustomersService, CustomerGuard, CheckoutService, CustomerWalletsService, HouseService, StoreSellers, StoreCustomersService],
  exports: [CheckoutService, HouseService, CustomersService, StoreSellers],
})
export class CheckoutModule {}
