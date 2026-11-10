import { PostingRemindersService } from './posting-reminders.service.js';
import { Module } from '@nestjs/common';
import { PostingEventsController } from '../postings/events.controller.js';
import { CustomerNotificationsController } from '../notifications/customer-notifications.controller.js';
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
import { ConnectChargesService } from './connect-charges.service.js';
import { AdminMissingController, ConnectCentreStockController } from './connect-stock.controller.js';
import { ConnectStockService } from './connect-stock.service.js';
import { AdminConnectReportsController } from './connect-reports.controller.js';
import { ConnectReportsService } from './connect-reports.service.js';
import { AdminWarehousesController, ConnectCentrePickupsController } from './connect-warehouses.controller.js';
import { ConnectWarehousesService } from './connect-warehouses.service.js';
import { AdminAuctionsController, ClassifiedAuctionsController } from './connect-auctions.controller.js';
import { ConnectAuctionsService } from './connect-auctions.service.js';
import { ConnectCheckoutService } from './connect-checkout.service.js';
import { ConnectCounterController } from './connect-counter.controller.js';
import { ConnectCounterService } from './connect-counter.service.js';
import { AdminReturnsController, ConnectCentreReturnsController, SellerReturnsController } from './connect-returns.controller.js';
import { ConnectReturnsService } from './connect-returns.service.js';
import { ListingShippingService } from './connect-shipping.service.js';
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
import { BrandPagesService, ClassifiedBrandPagesController } from './brand-pages.service.js';
import { AdminModelsController, ClassifiedModelsController, ClassifiedModelsService } from './models.service.js';
import { AdminHomeController, AdminSponsoredController, ClassifiedHomeController } from './home/home.controller.js';
import { AdminBannersController, ClassifiedBannersController } from './banners.controller.js';
import { BannersService } from './banners.service.js';
import { AdminBoardController, DashboardController } from './dashboard/dashboard.controller.js';
import { BoardService } from './dashboard/board.service.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { AdminHeroSlidesController, ClassifiedHeroSlidesController } from './hero-slides.controller.js';
import { HeroSlidesService } from './hero-slides.service.js';
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
import { AdminWantedController, WantedController } from './wanted/wanted.controller.js';
import { WantedService } from './wanted/wanted.service.js';

/** BitoCard Shop (classifieds): docs/BITOCARD_CLASSIFIEDS_PLAN.md. */
@Module({
  imports: [CheckoutModule, SettingsModule, IdentityModule],
  controllers: [ConnectCounterController, ConnectCentreStockController, AdminMissingController, AdminConnectReportsController, AdminWarehousesController, ConnectCentrePickupsController, AdminAuctionsController, ClassifiedAuctionsController, ConnectCentreReturnsController, SellerReturnsController, AdminReturnsController, PostingEventsController, CustomerNotificationsController, ClassifiedReferenceController, ClassifiedVideoUploadsController, ClassifiedListingsController, ClassifiedChatsController, ClassifiedContactController, ClassifiedSafePayController, ClassifiedSuggestionsController, AdminClassifiedsController, AdminSafePayController, AdminRegistryController, ClassifiedHomeController, AdminHomeController, AdminSponsoredController, ClassifiedBannersController, AdminBannersController, DashboardController, AdminBoardController, ClassifiedHeroSlidesController, AdminHeroSlidesController, ClassifiedBrandsController, ClassifiedBrandPagesController, AdminBrandsController, ClassifiedModelsController, AdminModelsController, DiscoveryController, DiscoveryAccountController, AdminDiscoveryController, UsernamesController, BuyOrdersController, AdminBuyOrdersController, ReviewsController, PublicReviewsController, AdminReviewsController, InteractionRatingsController, AdminInteractionRatingsController, WantedController, AdminWantedController],
  providers: [MediaStorage, ModerationService, ListingShippingService, ConnectChargesService, ConnectCheckoutService, ConnectCounterService, ConnectReturnsService, ConnectStockService, ConnectReportsService, ConnectWarehousesService, ConnectAuctionsService, ListingsService, ClassifiedsAdminService, ListingMediaService, ClassifiedReferenceService, ListingSearchService, SellerProfilesService, FavouritesService, KycStorage, ConversationsService, LeadsService, SafePayService, SafePayGuardsService, ClassifiedRegistryService, ShopDirectoryService, ShopTermsService, ResaleService, ShopEmails, ContactRequestsService, CallsService, HomeResolver, HomeService, SponsoredService, BannersService, BoardService, DashboardService, HeroSlidesService, ListingViewsService, ClassifiedBrandsService, BrandPagesService, ClassifiedModelsService, DiscoveryRecorder, DiscoveryService, DiscoveryAdminService, UsernamesService, BuyOrdersService, ReviewStatsService, ReviewsService, InteractionRatingsService, SellerScoreReader, PostingRemindersService, WantedService],
  exports: [ListingShippingService, ConnectChargesService, ConnectReportsService, ConnectWarehousesService, ConnectAuctionsService, ConnectCheckoutService, ConnectCounterService, ConnectReturnsService, ShopEmails, ShopTermsService, ResaleService, ListingsService, ListingMediaService, ConversationsService, SafePayService, SafePayGuardsService, ListingSearchService, ContactRequestsService, CallsService, DiscoveryRecorder, DiscoveryAdminService, BuyOrdersService, ReviewsService, ReviewStatsService, InteractionRatingsService, SellerScoreReader, PostingRemindersService, WantedService, FavouritesService, ShopDirectoryService],
})
export class ClassifiedsModule {}
