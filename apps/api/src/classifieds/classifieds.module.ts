import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminClassifiedsController, AdminSafePayController, ClassifiedsAdminService } from './admin.controller.js';
import { ClassifiedChatsController, ClassifiedListingsController, ClassifiedReferenceController, ClassifiedSafePayController } from './classifieds.controller.js';
import { SafePayService } from './safe-pay.service.js';
import { SafePayGuardsService } from './safe-pay-guards.service.js';
import { IdentityModule } from '../identity/identity.module.js';
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
import { ShopDirectoryService } from './directory.service.js';
import { AdminRegistryController, ClassifiedRegistryService, ClassifiedSuggestionsController } from './registry.service.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule, IdentityModule],
  controllers: [ClassifiedReferenceController, ClassifiedListingsController, ClassifiedChatsController, ClassifiedSafePayController, ClassifiedSuggestionsController, AdminClassifiedsController, AdminSafePayController, AdminRegistryController],
  providers: [MediaStorage, ModerationService, ListingsService, ClassifiedsAdminService, ListingMediaService, ClassifiedReferenceService, ListingSearchService, FavouritesService, KycStorage, ConversationsService, LeadsService, SafePayService, SafePayGuardsService, ClassifiedRegistryService, ShopDirectoryService],
  exports: [ListingsService, ListingMediaService, ConversationsService, SafePayService],
})
export class ClassifiedsModule {}
