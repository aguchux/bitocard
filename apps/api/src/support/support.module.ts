import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminChatsController, BitocardChatController, ChatsController, CustomerChatController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { AdminAiController, AiController } from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import { AdminBotsController, AdminKnowledgeTemplateController, BotsController, KnowledgeTemplateController } from './bots.controller.js';
import { BotsService } from './bots.service.js';
import { StoreKnowledgeService } from './knowledge.js';
import { RepliesService } from './replies.service.js';
import { AdminTicketsController, CustomerTicketsController, TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Support: tickets now; chat and support bots come next (docs/BITOCARD_SUPPORT_ASSISTANT_PLAN.md). */
@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [TicketsController, CustomerTicketsController, AdminTicketsController, ChatsController, BitocardChatController, CustomerChatController, AdminChatsController, AiController, AdminAiController, BotsController, KnowledgeTemplateController, AdminBotsController, AdminKnowledgeTemplateController],
  providers: [TicketsService, ChatsService, AiService, StoreKnowledgeService, BotsService, RepliesService],
  exports: [TicketsService, ChatsService, AiService, BotsService, RepliesService],
})
export class SupportModule {}
