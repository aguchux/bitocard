import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ResaleController, SupplierResaleController } from './resale.controller.js';
import { ResaleStoresService } from './resale-stores.service.js';
import { ResaleTradeService } from './resale-trade.service.js';

/** B2B reselling for resellers and suppliers (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, stage 2). */
@Module({
  imports: [CheckoutModule, ClassifiedsModule, SettingsModule],
  controllers: [ResaleController, SupplierResaleController],
  providers: [ResaleStoresService, ResaleTradeService],
  exports: [ResaleStoresService, ResaleTradeService],
})
export class ResaleModule {}