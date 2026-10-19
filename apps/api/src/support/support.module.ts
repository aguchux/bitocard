import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { AdminChatsController, BitocardChatController, ChatsController, CustomerChatController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { AdminAiController, AiController } from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import { AdminTicketsController, CustomerTicketsController, TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Support: tickets now; chat and support bots come next (docs/BITOCARD_SUPPORT_ASSISTANT_PLAN.md). */
@Module({
  imports: [CheckoutModule],
  controllers: [TicketsController, CustomerTicketsController, AdminTicketsController, ChatsController, BitocardChatController, CustomerChatController, AdminChatsController, AiController, AdminAiController],
  providers: [TicketsService, ChatsService, AiService],
  exports: [TicketsService, ChatsService, AiService],
})
export class SupportModule {}
