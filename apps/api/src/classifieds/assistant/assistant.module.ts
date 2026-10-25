import { Module } from '@nestjs/common';
import { CheckoutModule } from '../../checkout/checkout.module.js';
import { MediaStorage } from '../../media/storage.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { SupportModule } from '../../support/support.module.js';
import { ClassifiedsModule } from '../classifieds.module.js';
import { AdminShopAssistantsController, ShopAssistantController } from './assistant.controller.js';
import { ShopAssistantService } from './assistant.service.js';
import { ShopAssistantsService } from './shop-assistants.service.js';
import { ShopKnowledgeService } from './shop-knowledge.js';
import { ShopAssistantTools } from './tools.js';

/** BitoCard Shop's assistants (Anjio): docs/BITOCARD_CLASSIFIEDS_PLAN.md, Shop assistants. */
@Module({
  imports: [CheckoutModule, SettingsModule, SupportModule, ClassifiedsModule],
  controllers: [ShopAssistantController, AdminShopAssistantsController],
  providers: [MediaStorage, ShopKnowledgeService, ShopAssistantsService, ShopAssistantTools, ShopAssistantService],
  exports: [ShopAssistantsService, ShopAssistantService],
})
export class ShopAssistantModule {}
