import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminClassifiedsController, AdminSafePayController, ClassifiedsAdminService } from './admin.controller.js';
import { ClassifiedChatsController, ClassifiedListingsController, ClassifiedReferenceController, ClassifiedSafePayController, ClassifiedVideoUploadsController } from './classifieds.controller.js';
import { SafePayService } from './safe-pay.service.js';
import { SafePayGuardsService } from './safe-pay-guards.service.js';
import { ShopEmails } from './shop-emails.service.js';
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
import { SellerProfilesService } from './sellers.service.js';
import { FavouritesService } from './favourites.service.js';
import { ShopDirectoryService } from './directory.service.js';
import { ContactRequestsService } from './contact.service.js';
import { CallsService } from './calls.service.js';
import { ClassifiedContactController } from './contact.controller.js';
import { ShopTermsService } from './terms.service.js';
import { ResaleService } from './resale.service.js';
import { AdminRegistryController, ClassifiedRegistryService, ClassifiedSuggestionsController } from './registry.service.js';
import { AdminBrandsController, ClassifiedBrandsController, ClassifiedBrandsService } from './brands.service.js';
import { AdminModelsController, ClassifiedModelsController, ClassifiedModelsService } from './models.service.js';
import { AdminHomeController, AdminSponsoredController, ClassifiedHomeController } from './home/home.controller.js';
import { AdminBannersController, ClassifiedBannersController } from './banners.controller.js';
import { BannersService } from './banners.service.js';
import { HomeResolver } from './home/home-resolver.js';
import { HomeService } from './home/home.service.js';
import { SponsoredService } from './home/sponsored.service.js';
import { ListingViewsService } from './home/views.service.js';
import { AdminDiscoveryController, DiscoveryAccountController, DiscoveryController } from './discovery/discovery.controller.js';
import { DiscoveryAdminService } from './discovery/discovery-admin.service.js';
import { DiscoveryService } from './discovery/discovery.service.js';
import { DiscoveryRecorder } from './discovery/recorder.service.js';
import { UsernamesController } from './usernames.controller.js';
import { UsernamesService } from './usernames.service.js';
import { AdminBuyOrdersController, BuyOrdersController } from './buy-orders/buy-orders.controller.js';
import { BuyOrdersService } from './buy-orders/buy-orders.service.js';
import { AdminReviewsController, PublicReviewsController, ReviewsController } from './reviews/reviews.controller.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { ReviewStatsService } from './reviews/stats.service.js';
import { AdminInteractionRatingsController, InteractionRatingsController } from './ratings/interaction-ratings.controller.js';
import { InteractionRatingsService } from './ratings/interaction-ratings.service.js';
import { SellerScoreReader } from './scores/reader.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule, IdentityModule],
  controllers: [ClassifiedReferenceController, ClassifiedVideoUploadsController, ClassifiedListingsController, ClassifiedChatsController, ClassifiedContactController, ClassifiedSafePayController, ClassifiedSuggestionsController, AdminClassifiedsController, AdminSafePayController, AdminRegistryController, ClassifiedHomeController, AdminHomeController, AdminSponsoredController, ClassifiedBannersController, AdminBannersController, ClassifiedBrandsController, AdminBrandsController, ClassifiedModelsController, AdminModelsController, DiscoveryController, DiscoveryAccountController, AdminDiscoveryController, UsernamesController, BuyOrdersController, AdminBuyOrdersController, ReviewsController, PublicReviewsController, AdminReviewsController, InteractionRatingsController, AdminInteractionRatingsController],
  providers: [MediaStorage, ModerationService, ListingsService, ClassifiedsAdminService, ListingMediaService, ClassifiedReferenceService, ListingSearchService, SellerProfilesService, FavouritesService, KycStorage, ConversationsService, LeadsService, SafePayService, SafePayGuardsService, ClassifiedRegistryService, ShopDirectoryService, ShopTermsService, ResaleService, ShopEmails, ContactRequestsService, CallsService, HomeResolver, HomeService, SponsoredService, BannersService, ListingViewsService, ClassifiedBrandsService, ClassifiedModelsService, DiscoveryRecorder, DiscoveryService, DiscoveryAdminService, UsernamesService, BuyOrdersService, ReviewStatsService, ReviewsService, InteractionRatingsService, SellerScoreReader],
  exports: [ShopEmails, ShopTermsService, ResaleService, ListingsService, ListingMediaService, ConversationsService, SafePayService, SafePayGuardsService, ListingSearchService, ContactRequestsService, CallsService, DiscoveryRecorder, DiscoveryAdminService, BuyOrdersService, ReviewsService, ReviewStatsService, InteractionRatingsService, SellerScoreReader],
})
export class ClassifiedsModule {}
