import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StorefrontModule } from '../storefront/storefront.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { AdminResaleShopController, ResaleShopController } from './resale-shop.controller.js';
import { ResaleShopService } from './resale-shop.service.js';
import { ResaleController, SupplierResaleController } from './resale.controller.js';
import { ResaleStoresService } from './resale-stores.service.js';
import { ResaleTradeService } from './resale-trade.service.js';

/** B2B reselling for resellers and suppliers (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, stages 2 and 3). */
@Module({
  imports: [CheckoutModule, ClassifiedsModule, SettingsModule, StorefrontModule, StoresModule],
  controllers: [ResaleController, SupplierResaleController, ResaleShopController, AdminResaleShopController],
  providers: [ResaleStoresService, ResaleTradeService, ResaleShopService],
  exports: [ResaleStoresService, ResaleTradeService],
})
export class ResaleModule {}