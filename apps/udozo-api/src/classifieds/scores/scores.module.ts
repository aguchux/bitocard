import { Module } from '@nestjs/common';
import { CheckoutModule } from '../../checkout/checkout.module.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { SupportModule } from '../../support/support.module.js';
import { ShopAssistantModule } from '../assistant/assistant.module.js';
import { ClassifiedsModule } from '../classifieds.module.js';
import { AdminSellerScoresController, SellerScoresController } from './scores.controller.js';
import { SellerScoresService } from './scores.service.js';

/** Anjio's seller scores and summaries (docs/UDOZO_RATINGS_PLAN.md phase 3): apart, as they need the AI and the assistants. */
@Module({
  imports: [CheckoutModule, SettingsModule, SupportModule, ClassifiedsModule, ShopAssistantModule],
  controllers: [SellerScoresController, AdminSellerScoresController],
  providers: [SellerScoresService],
  exports: [SellerScoresService],
})
export class SellerScoresModule {}
