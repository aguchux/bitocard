import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { WhatsappCloud } from './cloud-api.js';
import { WhatsappContactsService, countryOfNumber } from './contacts.service.js';
import { templateLanguage } from './templates.js';

/** Meta's verification template for codes (authentication category, its words Meta's, with a Copy code button). */
export const codeTemplate = 'udozo_verification_code';

/**
 * Codes that confirm a mobile number, sent from Udozo's WhatsApp number with Meta's verification template: when the
 * person asks for WhatsApp, when their country cannot text, or when the text could not be sent (`SmsService.sendCode`).
 * Sent at once (not through the outbox), so a refusal is known while the person waits; Meta lets a verification
 * template go whenever the person asked for it, window or not. The code itself is never kept or logged: the message's
 * row records only that the template went, and Meta's delivery reports update it.
 */
@Injectable()
export class WhatsappCodes implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly contacts: WhatsappContactsService,
    private readonly sms: SmsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    this.sms.useWhatsapp({ open: country => this.contacts.openIn(country), send: (to, code) => this.send(to, code) });
  }

  async send(to: string, code: string) {
    const waId = to.replace(/\D/g, '').slice(0, 20);
    const cloud = new WhatsappCloud(this.integrations.config);
    const wamid = await cloud.send(waId, { type: 'template', name: codeTemplate, language: templateLanguage, params: [code], otp: code });
    // The number joins Udozo's WhatsApp contacts (not opted in: a code they asked for is not consent to anything else).
    const contact = await this.prisma.whatsappContact.upsert({ where: { waId }, create: { waId, country: countryOfNumber(waId) }, update: {} });
    await this.prisma.whatsappMessage.create({ data: { wamid, contactId: contact.id, direction: 'out', kind: 'template', template: codeTemplate, status: 'sent' } });
  }
}
