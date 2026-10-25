import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminClassifiedsController, ClassifiedsAdminService } from './admin.controller.js';
import { ClassifiedChatsController, ClassifiedListingsController, ClassifiedReferenceController } from './classifieds.controller.js';
import { ConversationsService } from './conversations.service.js';
import { LeadsService } from './leads.service.js';
import { KycStorage } from '../kyc/storage.js';
import { ModerationService } from './moderation.service.js';
import { MediaStorage } from '../media/storage.js';
import { ListingsService } from './listings.service.js';
import { ListingMediaService } from './media.service.js';
import { ClassifiedReferenceService } from './reference.service.js';
import { ListingSearchService } from './search.service.js';
import { FavouritesService } from './favourites.service.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [ClassifiedReferenceController, ClassifiedListingsController, ClassifiedChatsController, AdminClassifiedsController],
  providers: [MediaStorage, ModerationService, ListingsService, ClassifiedsAdminService, ListingMediaService, ClassifiedReferenceService, ListingSearchService, FavouritesService, KycStorage, ConversationsService, LeadsService],
  exports: [ListingsService, ListingMediaService, ConversationsService],
})
export class ClassifiedsModule {}
