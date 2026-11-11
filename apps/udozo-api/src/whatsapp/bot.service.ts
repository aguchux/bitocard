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
import { ListingSearchService, publicName } from '../classifieds/search.service.js';
import { WhatsappAnjio, looksLikeQuestion, searchWordsOf } from './anjio.service.js';
import { WhatsappContactsService, linkCodeIn } from './contacts.service.js';
import { receiptCodeIn, WhatsappReceiptsHub } from './receipts.js';
import { WhatsappDirect, directGreeting, directLink, phoneText } from './direct.service.js';
import { type Inbound } from './inbound.js';
import { words } from './messages.js';
import { WhatsappOutbox } from './outbox.service.js';
import { type BotContext, type FlowName, type FlowState, problemText, typed } from './flows/context.js';
import { SellFlow } from './flows/sell.flow.js';
import { SignupFlow } from './flows/signup.flow.js';
import { WhatsappSignIns, signInCodeIn } from './sign-in.service.js';
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
    private readonly anjio: WhatsappAnjio,
    private readonly direct: WhatsappDirect,
    private readonly signup: SignupFlow,
    private readonly signIns: WhatsappSignIns,
    private readonly receipts: WhatsappReceiptsHub,
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
    // Signing in (or up) on udozo.com: the code its link filled in. Sending it is asking to hear back, so it opts in.
    const signInCode = ctx.input.kind === 'text' ? signInCodeIn(text) : null;
    if (signInCode) {
      if (ctx.contact.optedOutAt) ctx.contact = await this.contacts.optIn(ctx.contact.id);
      if (!(await this.contacts.openIn(ctx.country))) return ctx.say({ type: 'text', body: words.notOpen });
      return this.signInWith(ctx, signInCode);
    }
    // A shop's receipt (its QR code fills the words in): sending it is asking for the PDF, so it opts in. Udozo POS
    // checks WhatsApp is open in the shop's country.
    const receipt = ctx.input.kind === 'text' && this.receipts.handler ? receiptCodeIn(text) : null;
    if (receipt) {
      if (ctx.contact.optedOutAt) ctx.contact = await this.contacts.optIn(ctx.contact.id);
      const problem = await this.receipts.handler!.request({ contactId: ctx.contact.id, waId: ctx.contact.waId }, receipt.number, receipt.code);
      if (problem) await ctx.say({ type: 'text', body: problem });
      return;
    }
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
        if (isWord(text, 'JOIN', 'SIGNUP', 'SIGN UP', 'REGISTER', 'CREATE ACCOUNT')) return this.signup.start(ctx);
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
      case 'ask':
        if (ctx.input.kind !== 'text') return ctx.say({ type: 'text', body: words.photoUnsupported });
        return this.ask(ctx, text);
      case 'chat_start':
        return this.startChat(ctx);
      case 'chat':
        return this.relayIn(ctx, String(ctx.state.conversationId ?? ctx.contact.activeConversationId ?? ''));
      case 'sell':
        return this.sell.step(ctx);
      case 'wanted':
        return this.wanted.step(ctx);
      case 'signup':
        return this.signup.step(ctx);
    }
    if (ctx.input.kind === 'image') return ctx.say({ type: 'text', body: words.photoUnsupported });
    if (ctx.input.kind === 'other') return ctx.say({ type: 'text', body: words.photoUnsupported });
    // Words with nothing going on: a question for Anjio where it answers here, else a search.
    if (text.length >= 3) return looksLikeQuestion(text) ? this.ask(ctx, text) : this.find(ctx, text, 0);
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
        if (id === 'ask') return this.startAsking(ctx);
        if (id === 'join') return this.signup.start(ctx);
        return this.menu(ctx);
      case 'find':
        return this.find(ctx, String(ctx.state.words ?? ''), Number(ctx.state.offset ?? 0) + resultsPerPage);
      case 'l':
        return this.card(ctx, Number(id));
      case 'more':
        return ctx.say({ type: 'buttons', body: `${words.listingActions} Or open it on udozo.com.`, buttons: words.moreButtons(id!) });
      case 'chat':
        return this.askFirstMessage(ctx, id!);
      case 'ct':
        return this.contactSeller(ctx, id!);
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
      case 'join':
        if (ctx.contact.flow !== 'signup') return this.signup.start(ctx);
        return this.signup.step(ctx);
      case 'wsi':
        return this.answerSignIn(ctx, id!, action);
      case 'adraft':
        return this.anjio.sendDraft(ctx, id!, Number(action));
      case 'aperson':
        return this.anjio.person(ctx, id!);
      case 'rcpt':
      case 'rinv': {
        const problem = this.receipts.handler ? await this.receipts.handler.choose({ contactId: ctx.contact.id, waId: ctx.contact.waId }, head === 'rinv' ? 'invoice' : 'receipt', id ?? '') : null;
        if (problem) await ctx.say({ type: 'text', body: problem });
        return;
      }
      default:
        return this.menu(ctx);
    }
  }

  // ---- Menu and linking ----

  private async menu(ctx: BotContext) {
    await ctx.setFlow(null);
    const name = ctx.customer?.firstName ?? ctx.contact.profileName?.split(' ')[0] ?? null;
    const anjio = await this.anjio.menuName(ctx.country);
    const base = anjio ? [words.menuRows[0]!, words.askRow(anjio), ...words.menuRows.slice(1)] : words.menuRows;
    // A number with no account is offered one, made right here (lists hold at most 10 rows).
    const rows = ctx.customer ? base : [...base.slice(0, -1), words.joinRow, base[base.length - 1]!];
    return ctx.say({ type: 'list', body: words.greeting(name), button: words.menuButton, rows });
  }

  // ---- Anjio ----

  /** Ask Anjio from the menu: what they write next goes to Anjio until MENU (a search where Anjio is not answering). */
  private async startAsking(ctx: BotContext) {
    const name = await this.anjio.menuName(ctx.country);
    if (!name) return this.askWords(ctx);
    await ctx.setFlow('ask', {});
    return ctx.say({ type: 'text', body: words.askIntro(name) });
  }

  /** A question for Anjio; where it is not answering here, the words are searched instead. */
  private async ask(ctx: BotContext, question: string) {
    const outcome = await this.anjio.ask(ctx, question, () => this.outbox.cloud().typing(ctx.input.wamid));
    if (outcome === 'search') return this.find(ctx, searchWordsOf(question) || question, 0);
    // Follow-up questions carry on the conversation.
    if (ctx.contact.flow !== 'ask') await ctx.setFlow('ask', {});
  }

  // ---- Signing up and in ----

  /** A sign-in's code from udozo.com: an account asks yes or no; a number without one makes its account here. */
  private async signInWith(ctx: BotContext, code: string) {
    const signIn = await this.signIns.claim(ctx.contact, code);
    if (!signIn) return ctx.say({ type: 'text', body: words.signInInvalid });
    if (!ctx.customer) return this.signup.start(ctx, signIn.id);
    return ctx.say({ type: 'buttons', body: words.signInAsk(ctx.customer.firstName ?? ctx.customer.name.split(' ')[0] ?? 'you', signIn.device), buttons: words.signInButtons(signIn.id) });
  }

  private async answerSignIn(ctx: BotContext, id: string, answer: string | undefined) {
    const signIn = await this.signIns.waiting(ctx.contact, id);
    if (!signIn) return ctx.say({ type: 'text', body: words.signInOver });
    if (answer !== 'yes') {
      await this.signIns.decline(signIn, ctx.contact);
      return ctx.say({ type: 'text', body: words.signInDeclined });
    }
    if (!ctx.customer) return this.signup.start(ctx, signIn.id);
    return ctx.say({ type: 'text', body: (await this.signIns.approve(signIn, ctx.contact, ctx.customer.id)) ? words.signedIn : words.signInOver });
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

  /**
   * Contact seller: a seller who chose "Let buyers WhatsApp me directly" is shown with their own WhatsApp number and a
   * button opening a chat with them there, about this listing. A seller who shared their details with this buyer before
   * (an accepted contact request) is shown with those. Anyone else is asked for their details, as Ask for contact did.
   */
  private async contactSeller(ctx: BotContext, listingId: string) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      const direct = await this.direct.reveal(ctx.customer, listingId);
      const card = (await this.search.cards([listingId])).get(listingId);
      const title = card?.title ?? 'this listing';
      if (direct) return this.sellerCard(ctx, { name: direct.name, phone: direct.phone, email: null, shared: false }, title, card?.url ?? '');
      const listing = await this.prisma.classifiedListing.findUniqueOrThrow({ where: { id: listingId }, select: { customerId: true } });
      const share = await this.prisma.classifiedContactShare.findUnique({
        where: { sellerId_buyerId: { sellerId: listing.customerId, buyerId: ctx.customer.id } },
        select: { seller: { select: { name: true, email: true, phone: true, phoneVerifiedAt: true } } },
      });
      if (share?.seller.phone && share.seller.phoneVerifiedAt) {
        return this.sellerCard(ctx, { name: publicName(share.seller.name), phone: share.seller.phone, email: share.seller.email, shared: true }, title, card?.url ?? '');
      }
      await this.contactRequests.requestContact(ctx.customer, listingId);
      return ctx.say({ type: 'text', body: words.contactNotShared });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  private sellerCard(ctx: BotContext, seller: { name: string; phone: string; email: string | null; shared: boolean }, title: string, url: string) {
    return ctx.say({
      type: 'link',
      body: words.sellerContact(seller.name, title, phoneText(seller.phone), seller.email, seller.shared),
      button: words.sellerContactButton,
      url: directLink(seller.phone, directGreeting(title, url)),
      footer: words.sellerContactFooter(seller.shared),
    });
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
