import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StorefrontModule } from '../storefront/storefront.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { AdminResaleShopController, ResaleShopController } from './resale-shop.controller.js';
import { ResaleShopService } from './resale-shop.service.js';
import { AdminResaleOrdersController, AdminResaleReportsController, ResaleOrdersController, StoreResaleOrdersController, StoreResaleReportsController, SupplierResaleOrdersController } from './resale-orders.controller.js';
import { ResaleStoreReportsService } from './resale-store-reports.service.js';
import { ResaleOrdersService } from './resale-orders.service.js';
import { ResaleController, SupplierResaleController } from './resale.controller.js';
import { ResaleStoresService } from './resale-stores.service.js';
import { ResaleTradeService } from './resale-trade.service.js';

/** B2B reselling for resellers and suppliers (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, stages 2 to 5). */
@Module({
  imports: [CheckoutModule, ClassifiedsModule, SettingsModule, StorefrontModule, StoresModule],
  controllers: [ResaleOrdersController, ResaleController, SupplierResaleController, SupplierResaleOrdersController, StoreResaleOrdersController, StoreResaleReportsController, ResaleShopController, AdminResaleShopController, AdminResaleOrdersController, AdminResaleReportsController],
  providers: [ResaleStoresService, ResaleTradeService, ResaleShopService, ResaleOrdersService, ResaleStoreReportsService],
  exports: [ResaleStoresService, ResaleTradeService, ResaleOrdersService],
})
export class ResaleModule {}