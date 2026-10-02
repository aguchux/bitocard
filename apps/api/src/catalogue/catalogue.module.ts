import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminPricingController, CatalogueController, PricingController, QuotesController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { PricingService } from './pricing.service';
import { QuotesService } from './quotes.service';

@Module({
  imports: [FxModule, SettingsModule],
  controllers: [CatalogueController, QuotesController, PricingController, AdminPricingController],
  providers: [PricingService, CatalogueService, QuotesService],
  exports: [PricingService, QuotesService],
})
export class CatalogueModule {}
