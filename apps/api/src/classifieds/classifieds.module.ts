import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ClassifiedListingsController, ClassifiedReferenceController } from './classifieds.controller.js';
import { ListingsService } from './listings.service.js';
import { ClassifiedReferenceService } from './reference.service.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [ClassifiedReferenceController, ClassifiedListingsController],
  providers: [ListingsService, ClassifiedReferenceService],
  exports: [ListingsService],
})
export class ClassifiedsModule {}
