import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Notification } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { type ChatMessageEvent, ConversationsService } from '../classifieds/conversations.service.js';
import { budgetText, wantedPlace } from '../classifieds/wanted/wanted.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { whatsappConfigured } from './cloud-api.js';
import { words } from './messages.js';
import { WhatsappOutbox } from './outbox.service.js';
import type { TemplateCall } from './templates.js';

/**
 * Notices also sent on WhatsApp to a linked number (inbox and push as before). Chat messages are not among them: the
 * relay forwards the message itself.
 */
export const whatsappTypes: ReadonlySet<string> = new Set([
  'customer.classifieds.wanted_match',
  'customer.classifieds.wanted_response',
  'customer.classifieds.contact_answered',
  'customer.classifieds.callback_request',
  'customer.classifieds.contact_request',
  'customer.classifieds.call_missed',
  'customer.classifieds.offer',
  'customer.classifieds.offer_accepted',
  'customer.classifieds.buy_request',
  'customer.classifieds.buy_accepted',
  'customer.classifieds.buy_countered',
  'customer.classifieds.buy_declined',
  'customer.classifieds.buy_cancelled',
  'customer.classifieds.buy_completed',
  'customer.classifieds.buy_meet_reminder',
  'customer.classifieds.listing_live',
  'customer.classifieds.listing_rejected',
]);

/**
 * Udozo on WhatsApp's outgoing side: a chat message is forwarded to the other side's linked number (their chats on,
 * not opted out, WhatsApp open in their country), worded "*Listing* Name: message", a photo uploaded to Meta from the
 * private bucket, and outside the 24-hour window the new-message template instead. Their reply to it (or a plain
 * message while that chat is the one they are in) goes back into the chat. Notices of the types above go too.
 */
@Injectable()
export class WhatsappRelay implements OnModuleInit {
  private readonly logger = new Logger('WhatsappRelay');

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly inbox: InboxService,
    private readonly outbox: WhatsappOutbox,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    this.conversations.onMessage(event => this.forward(event));
    this.inbox.useChannel(created => this.notices(created));
  }

  /** The linked contact of a customer who can be written to on WhatsApp now (else null). */
  private async reachable(customerId: string, want: 'chats' | 'alerts') {
    if (!whatsappConfigured(this.integrations.config)) return null;
    const contact = await this.prisma.whatsappContact.findUnique({ where: { customerId }, include: { customer: { select: { country: true, status: true } } } });
    if (!contact || contact.optedOutAt || contact.unreachableAt || contact.customer?.status !== 'active') return null;
    if (want === 'chats' ? !contact.chatsOn : !contact.alertsOn) return null;
    const country = contact.customer?.country ?? contact.country;
    if (!country || !(await this.settings.isOnForCountry('whatsapp_channel', country))) return null;
    return contact;
  }

  async forward(event: ChatMessageEvent) {
    const contact = await this.reachable(event.recipientId, 'chats');
    if (!contact) return;
    const fallback: TemplateCall = { name: 'udozo_new_message', params: [event.senderName, event.listingTitle], payload: `open:conv:${event.conversationId}` };
    const options = { fallback, conversationId: event.conversationId, classifiedMessageId: event.messageId };
    if (event.kind === 'photo' && event.objectKey) {
      await this.outbox.queue(contact.id, { type: 'chat_photo', objectKey: event.objectKey, contentType: event.contentType ?? 'image/jpeg', caption: words.forwardedPhoto(event.listingTitle, event.senderName) + (event.body ? `\n${event.body}` : '') }, options);
    } else {
      await this.outbox.queue(contact.id, { type: 'text', body: words.forwarded(event.listingTitle, event.senderName, event.body) }, options);
    }
    // Their plain replies go to this chat while they are not in another menu.
    await this.prisma.whatsappContact.updateMany({ where: { id: contact.id, OR: [{ flow: null }, { flow: 'chat' }] }, data: { activeConversationId: event.conversationId, flow: 'chat', flowState: { conversationId: event.conversationId }, flowUpdatedAt: new Date() } });
  }

  /** New notifications of the WhatsApp types, to customers who connected WhatsApp and did not turn the type off. */
  async notices(created: Notification[]) {
    for (const notice of created) {
      if (!notice.customerId || !whatsappTypes.has(notice.type)) continue;
      try {
        await this.notice(notice);
      } catch (error) {
        this.logger.warn({ err: error, type: notice.type }, 'Could not send a notice on WhatsApp');
      }
    }
  }

  private async notice(notice: Notification) {
    const preference = await this.prisma.notificationPreference.findUnique({ where: { customerId_type: { customerId: notice.customerId!, type: notice.type } }, select: { whatsapp: true } });
    if (preference?.whatsapp === false) return;
    const contact = await this.reachable(notice.customerId!, 'alerts');
    if (!contact) return;
    const site = String(this.integrations.config.STOREFRONT_URL ?? this.config.STOREFRONT_URL).replace(/\/+$/, '');
    const wantedId = /^\/account\/wanted\/([0-9a-f-]{36})$/.exec(notice.link ?? '')?.[1];
    if (notice.type === 'customer.classifieds.wanted_match' && wantedId) {
      const request = await this.prisma.classifiedWantedRequest.findUnique({ where: { id: wantedId }, include: { area: { include: { parent: true } }, state: true } });
      if (!request) return;
      const place = wantedPlace(request);
      await this.outbox.queue(contact.id, { type: 'buttons', body: words.wantedForYou(request.words, place, budgetText(request)).replace(/ Answer with one of your listings:$/, ''), buttons: [{ id: `wanted:${request.id}`, title: 'See request' }] }, {
        fallback: { name: 'udozo_wanted_match', params: [request.words, place || 'your country'], payload: `wanted:${request.id}` },
      });
      return;
    }
    const chatId = /^\/account\/messages\/([0-9a-f-]{36})$/.exec(notice.link ?? '')?.[1];
    if (notice.type === 'customer.classifieds.wanted_response' && chatId) {
      await this.outbox.queue(contact.id, { type: 'buttons', body: `${notice.title}\n${notice.body}`, buttons: [{ id: `open:conv:${chatId}`, title: 'Open the chat' }] }, {
        fallback: { name: 'udozo_wanted_response', params: [notice.title.replace(/^A seller answered your request for /, ''), notice.body], payload: `open:conv:${chatId}` },
        conversationId: chatId,
      });
      return;
    }
    const link = notice.link?.startsWith('/') ? notice.link : null;
    await this.outbox.queue(contact.id, { type: 'text', body: [`*${notice.title}*`, notice.body, link ? `${site}${link}` : null].filter(Boolean).join('\n'), previewUrl: Boolean(link) }, {
      fallback: { name: 'udozo_account_update', params: [notice.title], payload: link ? `link:${link}` : 'menu:home' },
    });
  }
}
