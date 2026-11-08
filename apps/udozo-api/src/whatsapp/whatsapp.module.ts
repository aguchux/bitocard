import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ShopAssistantModule } from '../classifieds/assistant/assistant.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { KycStorage } from '../kyc/storage.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WhatsappAdminService } from './admin.service.js';
import { WhatsappAnjio } from './anjio.service.js';
import { WhatsappCodes } from './codes.service.js';
import { WhatsappDirect } from './direct.service.js';
import { WhatsappBot } from './bot.service.js';
import { WhatsappContactsService } from './contacts.service.js';
import { SellFlow } from './flows/sell.flow.js';
import { SignupFlow } from './flows/signup.flow.js';
import { WhatsappSignIns } from './sign-in.service.js';
import { WantedFlow } from './flows/wanted.flow.js';
import { WhatsappJobs } from './jobs.service.js';
import { WhatsappNotices } from './notices.service.js';
import { WhatsappOutbox } from './outbox.service.js';
import { WhatsappRelay } from './relay.service.js';
import { ClassifiedChannelsController, WhatsappAccountController, WhatsappAdminController, WhatsappSignInController, WhatsappWebhookController } from './whatsapp.controller.js';

/** Udozo on WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): Udozo's own number through Meta's Cloud API. */
@Module({
  imports: [CheckoutModule, ClassifiedsModule, SettingsModule, ShopAssistantModule],
  controllers: [ClassifiedChannelsController, WhatsappWebhookController, WhatsappAccountController, WhatsappSignInController, WhatsappAdminController],
  providers: [KycStorage, WhatsappAnjio, WhatsappCodes, WhatsappDirect, WhatsappOutbox, WhatsappContactsService, WhatsappBot, WhatsappNotices, WhatsappRelay, WhatsappAdminService, WhatsappJobs, SellFlow, WantedFlow, SignupFlow, WhatsappSignIns],
  exports: [WhatsappJobs, WhatsappContactsService],
})
export class WhatsappModule {}
