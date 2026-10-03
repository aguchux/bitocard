import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminPricingController, CatalogueController, PricingController, QuotesController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { PricingService } from './pricing.service.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [FxModule, SettingsModule],
  controllers: [CatalogueController, QuotesController, PricingController, AdminPricingController],
  providers: [PricingService, CatalogueService, QuotesService],
  exports: [PricingService, QuotesService],
})
export class CatalogueModule {}
