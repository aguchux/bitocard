import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ClassifiedListingsController, ClassifiedReferenceController } from './classifieds.controller.js';
import { MediaStorage } from '../media/storage.js';
import { ListingsService } from './listings.service.js';
import { ListingMediaService } from './media.service.js';
import { ClassifiedReferenceService } from './reference.service.js';
import { ListingSearchService } from './search.service.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [ClassifiedReferenceController, ClassifiedListingsController],
  providers: [MediaStorage, ListingsService, ListingMediaService, ClassifiedReferenceService, ListingSearchService],
  exports: [ListingsService, ListingMediaService],
})
export class ClassifiedsModule {}
