import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type WhatsappContact } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ContactRequestsService } from '../classifieds/contact.service.js';
import { ConversationsService } from '../classifieds/conversations.service.js';
import { FavouritesService } from '../classifieds/favourites.service.js';
import { conditionName, isOnShop, priceText } from '../classifieds/rules.js';
import { ListingSearchService } from '../classifieds/search.service.js';
import { WhatsappContactsService, linkCodeIn } from './contacts.service.js';
import { type Inbound } from './inbound.js';
import { words } from './messages.js';
import { WhatsappOutbox } from './outbox.service.js';
import { type BotContext, type FlowName, type FlowState, problemText, typed } from './flows/context.js';
import { SellFlow } from './flows/sell.flow.js';
import { WantedFlow } from './flows/wanted.flow.js';

const minuteMs = 60_000;
/** A menu left this long starts again. */
export const flowIdleMs = 24 * 60 * minuteMs;
/** Messages one number may send in a minute before the rest are ignored (floods). */
export const inboundPerMinute = 30;
const resultsPerPage = 9;

const isWord = (text: string, ...options: string[]) => options.includes(text.trim().toUpperCase().replace(/[.!]+$/, ''));

/**
 * Udozo's WhatsApp number: each message a person sends is handled once (by Meta's message id), in order: STOP and
 * START, a connect code, the menu words, a choice from a list or button, then the step of the menu they are in. Every
 * action goes through the services udozo.com uses, so no rule is skipped on WhatsApp.
 */
@Injectable()
export class WhatsappBot {
  private readonly logger = new Logger('WhatsappBot');

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: WhatsappContactsService,
    private readonly outbox: WhatsappOutbox,
    private readonly integrations: IntegrationsService,
    private readonly conversations: ConversationsService,
    private readonly search: ListingSearchService,
    private readonly contactRequests: ContactRequestsService,
    private readonly favourites: FavouritesService,
    private readonly sell: SellFlow,
    private readonly wanted: WantedFlow,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get site() {
    return String(this.integrations.config.STOREFRONT_URL ?? this.config.STOREFRONT_URL).replace(/\/+$/, '');
  }

  /** One inbound message: handled once, at most 30 a minute per number. */
  async handle(input: Inbound) {
    const contact = await this.contacts.inbound(input.from, input.profileName, input.at);
    try {
      await this.prisma.whatsappMessage.create({ data: { wamid: input.wamid, contactId: contact.id, direction: 'in', kind: input.kind, status: 'received' } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    const recent = await this.prisma.whatsappMessage.count({ where: { contactId: contact.id, direction: 'in', createdAt: { gt: new Date(Date.now() - minuteMs) } } });
    if (recent > inboundPerMinute) return;
    void this.outbox.cloud().markRead(input.wamid).catch(() => undefined);
    const fresh = contact.flowUpdatedAt && Date.now() - contact.flowUpdatedAt.getTime() > flowIdleMs ? await this.prisma.whatsappContact.update({ where: { id: contact.id }, data: { flow: null, flowState: Prisma.DbNull, flowUpdatedAt: null } }) : contact;
    const ctx = await this.context(fresh, input);
    try {
      await this.route(ctx);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not answer a WhatsApp message');
      await ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  private async context(contact: WhatsappContact, input: Inbound): Promise<BotContext> {
    const customer = await this.contacts.customerOf(contact);
    const ctx: BotContext = {
      contact,
      customer,
      country: customer?.country ?? contact.country ?? 'NG',
      input,
      state: (contact.flowState as FlowState | null) ?? {},
      site: this.site,
      say: async (message, options) => {
        await this.outbox.queue(contact.id, message, options);
      },
      setFlow: async (flow: FlowName | null, state: FlowState = {}) => {
        const updated = await this.prisma.whatsappContact.update({
          where: { id: contact.id },
          data: flow ? { flow, flowState: state as Prisma.InputJsonValue, flowUpdatedAt: new Date() } : { flow: null, flowState: Prisma.DbNull, flowUpdatedAt: null },
        });
        ctx.contact = updated;
        ctx.state = state;
      },
      needAccount: () => ctx.say({ type: 'text', body: words.needAccount(`${this.site}/account/profile/whatsapp`) }),
    };
    return ctx;
  }

  private async route(ctx: BotContext) {
    const text = typed(ctx);
    const choice = ctx.input.choice;
    if (ctx.input.kind === 'text' && isWord(text, 'STOP', 'UNSUBSCRIBE', 'STOP ALL')) {
      // Answered once: a STOP sent again while opted out gets nothing.
      if (ctx.contact.optedOutAt) return;
      await this.contacts.optOut(ctx.contact.id);
      return ctx.say({ type: 'text', body: words.stopped }, { always: true });
    }
    const code = ctx.input.kind === 'text' ? linkCodeIn(text) : null;
    if (code) return this.link(ctx, code);
    if (ctx.contact.optedOutAt) {
      if (!isWord(text, 'START')) return;
      await this.contacts.optIn(ctx.contact.id);
      await ctx.say({ type: 'text', body: words.started });
      return this.menu(ctx);
    }
    if (!(await this.contacts.openIn(ctx.country))) return ctx.say({ type: 'text', body: words.notOpen });

    // A reply to a forwarded chat message answers that chat, whatever menu they are in.
    const quotedChat = !choice && ctx.input.replyTo && (ctx.input.kind === 'text' || ctx.input.kind === 'image') ? await this.quotedChat(ctx) : null;
    // While chatting, everyday words ("Hi", "Hello", "Buy") are messages to the other side: only the words that leave
    // or move around (MENU, CANCEL, HELP, CHATS) are commands.
    const chatting = Boolean(quotedChat) || ctx.contact.flow === 'chat';

    if (ctx.input.kind === 'text') {
      if (isWord(text, 'MENU', 'HOME', '0') || (!chatting && isWord(text, 'HI', 'HELLO', 'HEY', 'START'))) return this.menu(ctx);
      if (isWord(text, 'CANCEL', 'STOP IT', 'EXIT', 'QUIT')) {
        await ctx.setFlow(null);
        await ctx.say({ type: 'text', body: words.cancelled });
        return this.menu(ctx);
      }
      if (isWord(text, 'HELP')) return ctx.say({ type: 'text', body: words.help });
      if (isWord(text, 'CHATS', 'MY CHATS')) return this.myChats(ctx);
      if (!chatting) {
        if (isWord(text, 'SELL')) return this.sell.start(ctx);
        if (isWord(text, 'WANT', 'REQUEST', 'WANTED')) return this.wanted.start(ctx);
        if (isWord(text, 'FIND', 'SEARCH', 'BUY')) return this.askWords(ctx);
        const ref = /^l\s*-?\s*(\d{1,12})$/i.exec(text)?.[1];
        if (ref) return this.card(ctx, Number(ref));
      }
    }
    if (choice) return this.choose(ctx, choice);
    if (quotedChat) return this.relayIn(ctx, quotedChat);
    switch (ctx.contact.flow) {
      case 'find':
        return this.find(ctx, text, 0);
      case 'chat_start':
        return this.startChat(ctx);
      case 'chat':
        return this.relayIn(ctx, String(ctx.state.conversationId ?? ctx.contact.activeConversationId ?? ''));
      case 'sell':
        return this.sell.step(ctx);
      case 'wanted':
        return this.wanted.step(ctx);
    }
    if (ctx.input.kind === 'image') return ctx.say({ type: 'text', body: words.photoUnsupported });
    if (ctx.input.kind === 'other') return ctx.say({ type: 'text', body: words.photoUnsupported });
    // Words with nothing going on: a search.
    if (text.length >= 3) return this.find(ctx, text, 0);
    return this.menu(ctx);
  }

  /** The chat of the Udozo message they quoted (WhatsApp's reply), when it was one of theirs about a chat. */
  private async quotedChat(ctx: BotContext) {
    const quoted = await this.prisma.whatsappMessage.findUnique({ where: { wamid: ctx.input.replyTo! }, select: { conversationId: true, contactId: true } });
    return quoted?.conversationId && quoted.contactId === ctx.contact.id ? quoted.conversationId : null;
  }

  private async choose(ctx: BotContext, choice: string) {
    const [head, id, action] = choice.split(':');
    switch (head) {
      case 'menu':
        if (id === 'find') return this.askWords(ctx);
        if (id === 'want') return this.wanted.start(ctx);
        if (id === 'sell') return this.sell.start(ctx);
        if (id === 'chats') return this.myChats(ctx);
        if (id === 'help') return ctx.say({ type: 'text', body: words.help });
        return this.menu(ctx);
      case 'find':
        return this.find(ctx, String(ctx.state.words ?? ''), Number(ctx.state.offset ?? 0) + resultsPerPage);
      case 'l':
        return this.card(ctx, Number(id));
      case 'more':
        return ctx.say({ type: 'buttons', body: `${words.listingActions} Or open it on udozo.com.`, buttons: words.moreButtons(id!) });
      case 'chat':
        return this.askFirstMessage(ctx, id!);
      case 'cb':
      case 'contact':
      case 'save':
        return this.listingAction(ctx, head, id!);
      case 'conv':
        return this.conversation(ctx, id!, action);
      case 'open':
        if (id === 'conv') return this.conversation(ctx, action!, 'open');
        return this.menu(ctx);
      case 'link':
        return ctx.say({ type: 'text', body: `${this.site}${choice.slice('link:'.length)}`, previewUrl: true });
      case 'sell':
        if (ctx.contact.flow !== 'sell') return this.sell.start(ctx);
        return this.sell.step(ctx);
      case 'want':
        if (ctx.contact.flow !== 'wanted') return this.wanted.start(ctx);
        return this.wanted.step(ctx);
      case 'wanted':
        return this.wanted.show(ctx, id!);
      case 'wresp':
        return this.wanted.respond(ctx, id!, action!);
      default:
        return this.menu(ctx);
    }
  }

  // ---- Menu and linking ----

  private async menu(ctx: BotContext) {
    await ctx.setFlow(null);
    const name = ctx.customer?.firstName ?? ctx.contact.profileName?.split(' ')[0] ?? null;
    return ctx.say({ type: 'list', body: words.greeting(name), button: words.menuButton, rows: words.menuRows });
  }

  private async link(ctx: BotContext, code: string) {
    const linked = await this.contacts.redeem(ctx.contact, code);
    if (!linked) return ctx.say({ type: 'text', body: words.linkInvalid });
    ctx.contact = linked.contact;
    ctx.customer = await this.contacts.customerOf(linked.contact);
    ctx.country = ctx.customer?.country ?? ctx.country;
    await ctx.say({ type: 'text', body: words.linked(linked.customer.firstName ?? linked.customer.name.split(' ')[0] ?? 'there') });
    return this.menu(ctx);
  }

  // ---- Finding ----

  private async askWords(ctx: BotContext) {
    await ctx.setFlow('find', {});
    return ctx.say({ type: 'text', body: words.askWords });
  }

  /** Where the customer lives (their profile's area), for nearer results first. */
  private async home(customer: CustomerWithStore | null) {
    if (!customer?.areaId) return null;
    return this.prisma.classifiedArea.findUnique({ where: { id: customer.areaId }, select: { slug: true, name: true, parent: { select: { slug: true } } } });
  }

  private async find(ctx: BotContext, query: string, offset: number) {
    const q = query.trim().slice(0, 100);
    if (q.length < 2) return this.askWords(ctx);
    const home = await this.home(ctx.customer);
    const found = await this.search.search({ country: ctx.country, q, ...(home ? { area: home.slug, state: home.parent?.slug } : {}), offset, limit: resultsPerPage });
    await ctx.setFlow('find', { words: q, offset });
    if (!found.data.length) return ctx.say({ type: 'text', body: offset ? 'No more results. Try other words.' : words.noResults(q) });
    const rows = found.data.map(card => ({
      id: `l:${card.ref}`,
      title: card.title,
      description: [card.price.amount !== null && card.price.kind !== 'on_request' ? priceText(card.price.amount, card.price.currency) : 'Ask for price', card.area.name, card.in_stock ? null : 'Out of stock'].filter(Boolean).join(' · '),
    }));
    if (found.total > offset + resultsPerPage) rows.push(words.moreRow);
    return ctx.say({ type: 'list', body: words.searching(q, home?.name ?? null), button: words.resultsButton, rows });
  }

  /** A listing: its photo with what it is, then what they can do. */
  private async card(ctx: BotContext, ref: number) {
    const listing = Number.isSafeInteger(ref) ? await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(ref) }, select: { id: true, status: true, onShop: true, country: true } }) : null;
    if (!listing || !isOnShop(listing) || listing.status !== 'active' || listing.country !== ctx.country) return ctx.say({ type: 'text', body: words.gone });
    const card = (await this.search.cards([listing.id])).get(listing.id);
    if (!card) return ctx.say({ type: 'text', body: words.gone });
    const caption = [
      `*${card.title}*`,
      card.price.amount !== null && card.price.kind !== 'on_request' ? priceText(card.price.amount, card.price.currency) + (card.price.kind === 'negotiable' ? ' (negotiable)' : '') : 'Ask for price',
      [`${card.area.name}, ${card.area.state.name}`, conditionName(card.condition), card.in_stock ? null : 'Out of stock'].filter(Boolean).join(' · '),
      `Seller: ${card.seller.name}${card.seller.badges.includes('phone_confirmed') ? ' (phone confirmed)' : ''}`,
      card.url,
    ].join('\n');
    await ctx.say(card.cover?.url ? { type: 'image', link: card.cover.url, caption } : { type: 'text', body: caption, previewUrl: true });
    return ctx.say({ type: 'buttons', body: words.listingActions, buttons: words.listingButtons(listing.id) });
  }

  private async listingAction(ctx: BotContext, action: 'cb' | 'contact' | 'save', listingId: string) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      if (action === 'save') {
        await this.favourites.add(ctx.customer, listingId);
        return ctx.say({ type: 'text', body: words.saved });
      }
      if (action === 'cb') {
        await this.contactRequests.requestCallback(ctx.customer, listingId);
        return ctx.say({ type: 'text', body: words.callbackSent });
      }
      await this.contactRequests.requestContact(ctx.customer, listingId);
      return ctx.say({ type: 'text', body: words.contactSent });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  // ---- Chats ----

  private async askFirstMessage(ctx: BotContext, listingId: string) {
    if (!ctx.customer) return ctx.needAccount();
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { id: true, title: true, status: true, onShop: true } });
    if (!listing || !isOnShop(listing) || listing.status !== 'active') return ctx.say({ type: 'text', body: words.gone });
    const existing = await this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: ctx.customer.id } }, select: { id: true } });
    if (existing) return this.conversation(ctx, existing.id, 'reply');
    await ctx.setFlow('chat_start', { listingId });
    return ctx.say({ type: 'text', body: words.askFirstMessage(listing.title ?? 'this listing') });
  }

  private async startChat(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    if (ctx.input.kind !== 'text' || !typed(ctx)) return ctx.say({ type: 'text', body: 'Write your message as text.' });
    try {
      const chat = await this.conversations.start(ctx.customer, { listing_id: String(ctx.state.listingId), body: typed(ctx) }, { channel: 'whatsapp' });
      await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { activeConversationId: chat.id } });
      await ctx.setFlow('chat', { conversationId: chat.id });
      return ctx.say({ type: 'text', body: words.chatStarted(chat.with.name) });
    } catch (error) {
      await ctx.setFlow(null);
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  /** What they wrote (or a photo) goes into the chat, as written on udozo.com but marked "via WhatsApp". */
  async relayIn(ctx: BotContext, conversationId: string) {
    if (!ctx.customer) return ctx.needAccount();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return this.menu(ctx);
    try {
      if (ctx.input.kind === 'image' && ctx.input.imageId) {
        const file = await this.outbox.cloud().media(ctx.input.imageId, 4 * 1024 * 1024);
        await this.conversations.sendPhoto(ctx.customer, conversationId, { buffer: file.bytes, mimetype: file.contentType, size: file.bytes.length }, ctx.input.text || undefined, { channel: 'whatsapp' });
      } else if (ctx.input.kind === 'text' && typed(ctx)) {
        await this.conversations.send(ctx.customer, conversationId, typed(ctx), { channel: 'whatsapp' });
      } else return ctx.say({ type: 'text', body: words.photoUnsupported });
      await this.prisma.whatsappMessage.updateMany({ where: { wamid: ctx.input.wamid }, data: { conversationId } });
      await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { activeConversationId: conversationId } });
      // Their next plain message goes to the chat they last answered (a quoted reply to another chat moves it there),
      // unless they are in the middle of selling or a request.
      if (!ctx.contact.flow || ctx.contact.flow === 'chat') await ctx.setFlow('chat', { conversationId });
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 404) return ctx.say({ type: 'text', body: words.noChat });
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  private async myChats(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      const chats = await this.conversations.list(ctx.customer, { limit: 10 });
      if (!chats.data.length) return ctx.say({ type: 'text', body: words.noChats });
      return ctx.say({
        type: 'list',
        body: 'Your latest chats:',
        button: words.chatsButton,
        rows: chats.data.map(chat => ({ id: `conv:${chat.id}`, title: chat.listing.title ?? 'Listing', description: `${chat.role === 'buyer' ? 'Seller' : 'Buyer'}: ${chat.with.name}${chat.unread ? ` · ${chat.unread} new` : ''}` })),
      });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  /** A chat chosen from My chats (or a template's Read it): its latest messages, then write, block or report. */
  private async conversation(ctx: BotContext, id: string, action?: string) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      if (action === 'block') {
        await this.conversations.block(ctx.customer, id, true);
        await ctx.setFlow(null);
        return ctx.say({ type: 'text', body: words.blocked });
      }
      if (action === 'report') {
        await this.conversations.report(ctx.customer, id, { reason: 'other', details: 'Reported from WhatsApp.' });
        return ctx.say({ type: 'text', body: words.reported });
      }
      const chat = await this.conversations.get(ctx.customer, id, { limit: 5 });
      await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { activeConversationId: id } });
      await ctx.setFlow('chat', { conversationId: id });
      if (action === 'reply') return ctx.say({ type: 'text', body: words.chatOpen(chat.listing.title ?? 'the listing', chat.with.name) });
      const lines = chat.messages
        .filter(message => message.from !== 'bitocard')
        .map(message => `${message.from === 'me' ? 'You' : chat.with.name}: ${message.photo ? '(a photo)' : ''}${message.body}`.trim());
      await ctx.say({ type: 'text', body: [`*${chat.listing.title ?? 'Listing'}*`, ...(lines.length ? lines : ['No messages yet.'])].join('\n') }, { conversationId: id });
      return ctx.say({ type: 'buttons', body: words.chatOpen(chat.listing.title ?? 'the listing', chat.with.name), buttons: words.chatChoices(id) }, { conversationId: id });
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      return ctx.say({ type: 'text', body: status === 404 ? words.noChat : problemText(error) });
    }
  }
}
