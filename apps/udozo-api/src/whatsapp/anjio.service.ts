import { createHash, createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { ShopAssistantService, type Asker } from '../classifieds/assistant/assistant.service.js';
import { ShopAssistantsService } from '../classifieds/assistant/shop-assistants.service.js';
import type { AssistantCard } from '../classifieds/assistant/tools.js';
import { ConversationsService } from '../classifieds/conversations.service.js';
import { priceText } from '../classifieds/rules.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { SupportBot } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import type { OutgoingMessage, Row } from './cloud-api.js';
import { type BotContext, problemText } from './flows/context.js';
import { words } from './messages.js';

const hourMs = 3_600_000;
/** A WhatsApp conversation with Anjio carries on this long after its last message, then a new one starts. */
export const anjioThreadMs = 24 * hourMs;

const questionStart = /^(how|what|whats|what's|where|when|why|which|who|whom|whose|can|could|should|would|will|is|are|am|do|does|did|was|were|has|have|any|tell|help|explain|please|pls|i need|i want|i'm looking|im looking|i am looking|looking for|recommend|suggest|compare)\b/i;

/**
 * Whether words sent with no menu going on read as a question for Anjio rather than a search: a question mark, a
 * question word first, or a sentence of five words or more. Short words ("iphone 13") stay a search.
 */
export const looksLikeQuestion = (text: string) => {
  const clean = text.trim();
  if (clean.length < 4) return false;
  return clean.includes('?') || questionStart.test(clean) || clean.split(/\s+/).length >= 5;
};

const stopWords = new Set('a an and any are at be buy can could do does find for from get has have how i im in is it looking me much my near need of on or please pls price prices show some tell that the there this to under want what whats where which who will with would you'.split(' '));

/** A question's key words, for searching it when Anjio cannot answer ("Where can I find an oled?" is "oled"). */
export const searchWordsOf = (question: string) =>
  question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(word => word && !stopWords.has(word))
    .join(' ')
    .slice(0, 100);

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/**
 * An answer's few HTML tags (`answerHtml`) as WhatsApp writes text: *bold*, _italic_, bullets, paragraphs, and a link
 * as its words then the address.
 */
export function whatsappText(html: string) {
  return html
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return !text || text === href ? href : `${text} (${href})`;
    })
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''))
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => (inner.trim() ? `_${inner.trim()}_` : ''))
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => entities[name] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type ListingItem = { id?: string; ref?: number | string; title?: string | null; price?: { amount: number | null; kind?: string; currency: string }; area?: { name?: string } };

const isListing = (item: unknown): item is ListingItem & { ref: number | string } => Boolean(item && typeof item === 'object' && 'ref' in item && (item as ListingItem).ref !== undefined);

/** A listing from Anjio's cards as a row to tap (opens the same card as search). */
export const listingRow = (item: ListingItem & { ref: number | string }): Row => ({
  id: `l:${item.ref}`,
  title: item.title ?? 'Listing',
  description: [item.price && item.price.amount !== null && item.price.kind !== 'on_request' ? priceText(item.price.amount, item.price.currency) : 'Ask for price', item.area?.name].filter(Boolean).join(' · '),
});

/** What happened when a question was put to Anjio. */
export type AnjioOutcome = 'answered' | 'search' | 'refused';

/**
 * Anjio on WhatsApp: the market's shop assistant answers what a person asks Udozo's number, through the very service
 * udozo.com's Ask Anjio uses (its rules, the country's knowledge, its tools, the daily limits and monthly budget), in
 * one conversation per number held on WhatsApp. A connected number asks as its account; any other as a visitor known by
 * the number (counted per number per day). Answers come as WhatsApp text, listings as a list to tap, a drafted first
 * message with Send to seller, and Talk to a person. Never inside a chat between a buyer and a seller.
 */
@Injectable()
export class WhatsappAnjio {
  private readonly logger = new Logger('WhatsappAnjio');

  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: ShopAssistantService,
    private readonly shops: ShopAssistantsService,
    private readonly settings: SettingsService,
    private readonly conversations: ConversationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The assistant answering on WhatsApp in a country (whatsapp_assistant, classifieds and its assistant on), or null. */
  async botFor(country: string): Promise<SupportBot | null> {
    const on = (key: 'whatsapp_assistant' | 'classifieds_assistant' | 'classifieds') => this.settings.isOnForCountry(key, country).catch(() => false);
    const [whatsapp, assistant, shop] = await Promise.all([on('whatsapp_assistant'), on('classifieds_assistant'), on('classifieds')]);
    if (!whatsapp || !assistant || !shop) return null;
    const bot = await this.shops.resolve(country, 'en');
    return bot && this.surfaceOf(bot) ? bot : null;
  }

  private surfaceOf(bot: Pick<SupportBot, 'roles'>) {
    return bot.roles.includes('browse') ? ('browse' as const) : bot.roles.includes('help') ? ('help' as const) : null;
  }

  /** A visitor's token made from their number, so the same number keeps its conversation and its day's questions. */
  private visitorToken(waId: string) {
    return `bav_${createHmac('sha256', String(this.config.ENCRYPTION_KEY)).update(`whatsapp-assistant:${waId}`).digest('base64url')}`;
  }

  private asker(ctx: Pick<BotContext, 'customer' | 'contact'>): Asker {
    return ctx.customer ? { customer: ctx.customer, visitorToken: null, address: null } : { customer: null, visitorToken: this.visitorToken(ctx.contact.waId), address: `whatsapp:${ctx.contact.waId}` };
  }

  /** The number's conversation with Anjio, carried on for a day and only as the same person (else a new one). */
  private async threadFor(ctx: BotContext, bot: SupportBot, surface: 'browse' | 'help') {
    const current = ctx.contact.assistantThreadId ? await this.prisma.assistantThread.findUnique({ where: { id: ctx.contact.assistantThreadId } }) : null;
    const same = current && (ctx.customer ? current.customerId === ctx.customer.id : !current.customerId && current.visitorHash === createHash('sha256').update(this.visitorToken(ctx.contact.waId)).digest('hex'));
    if (current && same && current.botId === bot.id && current.country === ctx.country && Date.now() - current.lastMessageAt.getTime() < anjioThreadMs) return current.id;
    const started = await this.assistant.start(this.asker(ctx), { country: ctx.country, language: bot.languages[0] ?? 'en', surface, channel: 'whatsapp' });
    await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { assistantThreadId: started.id } });
    ctx.contact = { ...ctx.contact, assistantThreadId: started.id };
    return started.id;
  }

  /**
   * Puts a question to Anjio and sends the answer. `search` when Anjio does not answer here (switched off, none for
   * the market, out of budget or failing): the caller searches instead. `refused` when its answer was a refusal the
   * person was told (the day's questions used up, a question too long).
   */
  async ask(ctx: BotContext, question: string, typing?: () => Promise<void>): Promise<AnjioOutcome> {
    const bot = await this.botFor(ctx.country);
    const surface = bot ? this.surfaceOf(bot) : null;
    if (!bot || !surface) return 'search';
    void typing?.().catch(() => undefined);
    let answer: Awaited<ReturnType<ShopAssistantService['send']>>;
    let threadId: string;
    try {
      threadId = await this.threadFor(ctx, bot, surface);
      answer = await this.assistant.send(this.asker(ctx), threadId, { body: question });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === 'assistant_limit_reached') {
        await ctx.say({ type: 'text', body: problemText(error) });
        return 'search';
      }
      if (code === 'assistant_unavailable' || code === 'assistant_budget_reached' || !code) {
        this.logger.warn({ err: error }, 'Anjio could not answer on WhatsApp');
        return 'search';
      }
      await ctx.say({ type: 'text', body: problemText(error) });
      return 'refused';
    }
    for (const message of this.messagesFor(bot.name, answer.id, threadId, answer.body, answer.cards, Boolean(ctx.customer))) await ctx.say(message);
    return 'answered';
  }

  /** One answer as WhatsApp messages: the words (with the listings as a list to tap), then each other card. */
  messagesFor(name: string, messageId: string, threadId: string, body: string, cards: AssistantCard[], signedIn: boolean): OutgoingMessage[] {
    const text = whatsappText(body);
    const listings = new Map<string, ListingItem & { ref: number | string }>();
    for (const card of cards) if (card.type === 'listings' || card.type === 'compare') for (const item of card.items) if (isListing(item)) listings.set(String(item.ref), item);
    const out: OutgoingMessage[] = [];
    if (listings.size) {
      out.push({ type: 'list', body: text || words.anjioListings, button: words.resultsButton, rows: [...listings.values()].slice(0, 10).map(listingRow) });
    } else if (text) out.push({ type: 'text', body: text, previewUrl: false });

    cards.forEach((card, index) => {
      switch (card.type) {
        case 'safe_pay':
          out.push({ type: 'text', body: words.anjioSafePay(priceText(card.price, card.currency), priceText(card.fee, card.currency), priceText(card.total, card.currency)) });
          break;
        case 'price_range':
          out.push({ type: 'text', body: words.anjioPriceRange(card.category, priceText(card.low, card.currency), priceText(card.high, card.currency), priceText(card.median, card.currency), card.count) });
          break;
        case 'checklist':
          if (card.items.length) out.push({ type: 'text', body: [words.anjioChecklist, ...card.items.slice(0, 12).map(item => `• ${item}`)].join('\n') });
          break;
        case 'message_draft':
          out.push({ type: 'buttons', body: words.anjioDraft(card.title, card.text), buttons: [{ id: `adraft:${messageId}:${index}`, title: 'Send to seller' }] });
          break;
        case 'person':
          out.push(signedIn ? { type: 'buttons', body: words.anjioPerson, buttons: [{ id: `aperson:${threadId}`, title: 'Talk to a person' }] } : { type: 'text', body: words.anjioPersonSignIn });
          break;
        default:
          break;
      }
    });
    if (!out.length) out.push({ type: 'text', body: words.anjioNothing(name) });
    return out;
  }

  /** Send to seller: the first message Anjio drafted goes into that listing's chat (a new one, or the open one). */
  async sendDraft(ctx: BotContext, messageId: string, index: number) {
    if (!ctx.customer) return ctx.needAccount();
    const message = await this.prisma.assistantMessage.findUnique({ where: { id: messageId }, select: { role: true, cards: true, threadId: true } });
    const card = message && message.role === 'assistant' && message.threadId === ctx.contact.assistantThreadId ? (message.cards as AssistantCard[] | null)?.[index] : null;
    if (!card || card.type !== 'message_draft') return ctx.say({ type: 'text', body: words.anjioDraftGone });
    try {
      const existing = await this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId: card.listing_id, buyerId: ctx.customer.id } }, select: { id: true } });
      const chatId = existing ? (await this.conversations.send(ctx.customer, existing.id, card.text, { channel: 'whatsapp' }), existing.id) : (await this.conversations.start(ctx.customer, { listing_id: card.listing_id, body: card.text }, { channel: 'whatsapp' })).id;
      await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { activeConversationId: chatId } });
      await ctx.setFlow('chat', { conversationId: chatId });
      return ctx.say({ type: 'text', body: words.anjioDraftSent(card.title) });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  /** Talk to a person: a support chat with Udozo's team, opened with the conversation (signed in only). */
  async person(ctx: BotContext, threadId: string) {
    if (!ctx.customer) return ctx.needAccount();
    if (threadId !== ctx.contact.assistantThreadId) return ctx.say({ type: 'text', body: words.anjioDraftGone });
    try {
      await this.assistant.human(this.asker(ctx), threadId);
      return ctx.say({ type: 'text', body: words.anjioHandedOver });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  /** "Ask Anjio" in the menu, where Anjio answers on WhatsApp: its name for the row (null: no row). */
  async menuName(country: string) {
    return (await this.botFor(country))?.name ?? null;
  }
}
