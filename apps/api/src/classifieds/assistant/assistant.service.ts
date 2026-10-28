import { createHash, createHmac, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AssistantThread, Prisma, SupportBot } from '../../generated/prisma/client.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { MediaStorage } from '../../media/storage.js';
import { SettingsService } from '../../settings/settings.service.js';
import { AiService, monthStart } from '../../support/ai/ai.service.js';
import type { AiImage, AiProviderName, AiToolCall, AiTurn } from '../../support/ai/providers.js';
import { BotsService, type ShopRole, shopLimitsOf } from '../../support/bots.service.js';
import { ChatsService } from '../../support/chats.service.js';
import { knowledgeContext, shopSystemPrompt, type ShopSurface } from '../../support/prompt.js';
import { redact } from '../../support/redact.js';
import { cleanMessage } from '../conversations.service.js';
import { checkDescription, checkFeatureValue, checkTitle, conditions, isOnShop, linkPattern } from '../rules.js';
import { evalCases, type EvalOutcome, scoreCase } from './evals.js';
import { answerLanguage, greetingFor, languageName } from './languages.js';
import { quoted, sanitiseAnswer } from './sanitise.js';
import { ShopAssistantsService } from './shop-assistants.service.js';
import { type AssistantCard, ShopAssistantTools, type ToolScope } from './tools.js';

/** Tool rounds per answer, so a model cannot loop. */
const maxRounds = 4;
/** Earlier turns sent with each answer. */
const historyTurns = 20;
const maxCards = 6;
export const maxQuestion = 1000;
const quietFailure = (name: string) => `${name} can’t answer right now. Search and the help pages still work.`;

export const visitorHeader = 'bitocard-assistant-visitor';
export const visitorPattern = /^bav_[A-Za-z0-9_-]{43}$/;

/** Who is asking: a signed-in customer, or a visitor known by their token, and the address their store's server vouched for. */
export type Asker = { customer: CustomerWithStore | null; visitorToken: string | null; address: string | null };

export type AssistantEvent = { event: 'status'; data: { tool: string } } | { event: 'cards'; data: { cards: AssistantCard[] } } | { event: 'message'; data: unknown } | { event: 'error'; data: { code: string; message: string } };

const notFound = (what = 'conversation') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const signIn = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Sign in to continue.');
const unavailable = (name = 'The assistant') => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'assistant_unavailable', quietFailure(name));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The suggestions a seller asks for in the Shop tab. */
export const suggestionKinds = ['draft', 'price', 'improve', 'reply'] as const;
export type SuggestionKind = (typeof suggestionKinds)[number];

const suggestedQuestions: Record<ShopSurface, string[]> = {
  browse: ['A used phone under ₦300,000 near me', 'What should I check before buying a car?', 'How does Safe pay work?'],
  sell: ['What should I write in my title?', 'Which features should I fill in?', 'How do I get paid with Safe pay?'],
  help: ['How does Safe pay work?', 'What is a release code?', 'Where are my orders?'],
};

/**
 * Conversations with BitoCard Shop's assistants. The assistant is chosen on the server for the conversation's country and
 * language and kept on the thread. Each answer: limits and the monthly budget checked, the person's words redacted, the
 * model given BitoCard's rules, the country's knowledge and the tools for its surface, at most four tool rounds, then
 * its words sanitised (links only to listings its tools returned) beside cards drawn from the tool results. Failure is
 * quiet: the Shop never depends on the assistant. Sellers' suggestions are structured and checked before they are shown.
 */
@Injectable()
export class ShopAssistantService {
  private readonly logger = new Logger('ShopAssistant');

  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopAssistantsService,
    private readonly tools: ShopAssistantTools,
    private readonly ai: AiService,
    private readonly settings: SettingsService,
    private readonly chats: ChatsService,
    private readonly storage: MediaStorage,
    private readonly integrations: IntegrationsService,
    bots: BotsService,
  ) {
    bots.useShop({
      missing: bot => this.shops.missing(bot),
      activated: (tx, bot, actorId) => this.shops.takeSlots(tx, bot, actorId),
      deactivated: botId => this.shops.deactivated(botId),
      generate: async bot => ({ content: this.shops.sharedTemplate(bot.name) }),
      test: (bot, messages, options) => this.test(bot, messages, options),
      present: bot => this.shops.present(bot),
    });
  }

  private key() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return key;
  }

  /** A visitor's address as an HMAC that changes each UTC day: enough to count today's questions, never to follow them. */
  private addressHash(address: string | null) {
    return address ? createHmac('sha256', this.key()).update(`assistant:${new Date().toISOString().slice(0, 10)}:${address}`).digest('hex') : null;
  }

  /** BitoCard Shop and its assistants are open in the country (and the asker is a bitocard.com account, when signed in). */
  private async open(country: string) {
    const [shop, assistant] = await Promise.all([this.settings.isOnForCountry('classifieds', country).catch(() => false), this.settings.isOnForCountry('classifieds_assistant', country).catch(() => false)]);
    return shop && assistant;
  }

  private checkAsker(asker: Asker) {
    if (asker.customer && !asker.customer.store.reseller.house) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_unavailable', 'BitoCard Shop is for bitocard.com accounts.');
  }

  // -- Who answers ----------------------------------------------------------------------------------------------

  /** The assistant serving a country and language, as people see it (or null), and the languages offered there. */
  async profile(asker: Asker, country: string, language: string | undefined, surface: ShopSurface = 'browse') {
    this.checkAsker(asker);
    const code = country.toUpperCase();
    if (!(await this.open(code))) return { object: 'shop_assistant' as const, assistant: null, languages: [] };
    const asked = language ?? 'en';
    const [bot, languages] = await Promise.all([this.shops.resolve(code, asked), this.shops.languagesIn(code)]);
    if (!bot) return { object: 'shop_assistant' as const, assistant: null, languages };
    const answer = answerLanguage(bot.languages, asked);
    return {
      object: 'shop_assistant' as const,
      assistant: {
        id: bot.id,
        name: bot.name,
        avatar_url: bot.avatarUrl,
        label: 'AI assistant',
        language: answer,
        greeting: greetingFor(bot, answer),
        roles: bot.roles as ShopRole[],
        suggestions: answer.startsWith('en') && bot.roles.includes(surface === 'help' ? 'help' : surface) ? suggestedQuestions[surface] : [],
      },
      languages,
    };
  }

  // -- Threads --------------------------------------------------------------------------------------------------

  private async ownThread(asker: Asker, id: string) {
    const thread = await this.prisma.assistantThread.findUnique({ where: { id } });
    const mine = thread && (asker.customer ? thread.customerId === asker.customer.id : asker.visitorToken ? thread.visitorHash === sha(asker.visitorToken) : false);
    if (!thread || !mine) throw notFound();
    return thread;
  }

  /** Starts a conversation. A visitor without a token gets one, once (their store's server keeps it in a cookie). */
  async start(asker: Asker, input: { country: string; language?: string; surface: ShopSurface; listing_id?: string; conversation_id?: string }) {
    this.checkAsker(asker);
    const country = input.country.toUpperCase();
    if (!(await this.open(country))) throw unavailable();
    const bot = await this.shops.resolve(country, input.language ?? 'en');
    if (!bot) throw unavailable();
    if (!bot.roles.includes(input.surface)) throw invalid('parameter_invalid', `${bot.name} does not do that here.`, 'surface');
    if (input.surface === 'sell' && !asker.customer) throw signIn();
    if (input.listing_id) {
      const listing = await this.prisma.classifiedListing.findUnique({ where: { id: input.listing_id }, select: { country: true, status: true, onShop: true, customerId: true } });
      const visible = listing && listing.country === country && (isOnShop(listing) || listing.customerId === asker.customer?.id);
      if (!visible || (input.surface === 'sell' && listing.customerId !== asker.customer?.id)) throw notFound('listing');
    }
    if (input.conversation_id) {
      const chat = asker.customer ? await this.prisma.classifiedConversation.findFirst({ where: { id: input.conversation_id, OR: [{ buyerId: asker.customer.id }, { sellerId: asker.customer.id }] }, select: { id: true } }) : null;
      if (!chat) throw notFound('chat');
    }
    let visitorToken: string | null = null;
    if (!asker.customer) visitorToken = asker.visitorToken && /^bav_/.test(asker.visitorToken) ? asker.visitorToken : `bav_${randomBytes(32).toString('base64url')}`;
    const thread = await this.prisma.assistantThread.create({
      data: {
        botId: bot.id,
        customerId: asker.customer?.id ?? null,
        visitorHash: visitorToken ? sha(visitorToken) : null,
        country,
        language: answerLanguage(bot.languages, input.language),
        surface: input.surface,
        listingId: input.listing_id ?? null,
        conversationId: input.conversation_id ?? null,
      },
    });
    return { ...(await this.present(thread, bot)), ...(visitorToken && visitorToken !== asker.visitorToken ? { visitor_token: visitorToken } : {}) };
  }

  private async present(thread: AssistantThread, bot?: SupportBot | null) {
    const [owner, messages] = await Promise.all([bot ? bot : this.prisma.supportBot.findUnique({ where: { id: thread.botId } }), this.prisma.assistantMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: 'asc' }, take: 100 })]);
    return {
      object: 'assistant_thread' as const,
      id: thread.id,
      country: thread.country,
      language: thread.language,
      surface: thread.surface as ShopSurface,
      listing_id: thread.listingId,
      conversation_id: thread.conversationId,
      chat_id: thread.chatId,
      assistant: owner ? { name: owner.name, avatar_url: owner.avatarUrl, label: 'AI assistant', greeting: greetingFor(owner, thread.language) } : null,
      messages: messages.map(message => this.presentMessage(message)),
      created_at: thread.createdAt.toISOString(),
    };
  }

  private presentMessage(message: Prisma.AssistantMessageGetPayload<object>) {
    return { object: 'assistant_message' as const, id: message.id, role: message.role as 'user' | 'assistant', body: message.body, cards: message.cards as AssistantCard[], rating: message.rating, reported: Boolean(message.reportedAt), created_at: message.createdAt.toISOString() };
  }

  async thread(asker: Asker, id: string) {
    return this.present(await this.ownThread(asker, id));
  }

  // -- Limits ---------------------------------------------------------------------------------------------------

  /** `assistant_limit_reached` past the day's questions (per customer, or per visitor's address), else the address hash to keep. */
  private async checkLimits(asker: Asker, bot: SupportBot) {
    const limits = shopLimitsOf(bot);
    const day = new Date(Date.now() - 86_400_000);
    if (asker.customer) {
      const used = await this.prisma.assistantMessage.count({ where: { role: 'user', createdAt: { gte: day }, thread: { customerId: asker.customer.id } } });
      if (used >= limits.customer_daily) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'assistant_limit_reached', `You have asked ${bot.name} ${limits.customer_daily} questions today. Try again tomorrow, or use search.`);
      return null;
    }
    const hash = this.addressHash(asker.address) ?? sha(`visitor:${asker.visitorToken}`);
    const used = await this.prisma.assistantMessage.count({ where: { role: 'user', addressHash: hash } });
    if (used >= limits.visitor_daily) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'assistant_limit_reached', `${bot.name} has answered ${limits.visitor_daily} questions from here today. Sign in for more, or use search.`);
    return hash;
  }

  /** `assistant_budget_reached` once the assistant's monthly cap in US dollars is spent. */
  private async checkBudget(bot: SupportBot) {
    const budget = shopLimitsOf(bot).monthly_budget_usd;
    if (budget === null) return;
    const spent = await this.prisma.aiUsage.aggregate({ where: { botId: bot.id, kind: 'shop', createdAt: { gte: monthStart() } }, _sum: { costMicros: true } });
    if (Number(spent._sum.costMicros ?? 0n) >= budget * 1_000_000) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'assistant_budget_reached', `${bot.name} has reached this month’s limit. Search and the help pages still work.`);
  }

  // -- Answering ------------------------------------------------------------------------------------------------

  private async scopeFor(thread: Pick<AssistantThread, 'country' | 'surface' | 'listingId' | 'conversationId'>, bot: SupportBot, customer: CustomerWithStore | null): Promise<ToolScope> {
    const market = await this.prisma.country.findUnique({ where: { code: thread.country }, select: { currency: true } });
    return { country: thread.country, currency: market?.currency ?? 'NGN', surface: thread.surface as ShopRole, roles: bot.roles, customer, listingId: thread.listingId, conversationId: thread.conversationId };
  }

  private async system(bot: SupportBot, scope: ToolScope, language: string) {
    const market = await this.prisma.country.findUnique({ where: { code: scope.country }, select: { name: true } });
    return shopSystemPrompt(bot, {
      country: scope.country,
      countryName: market?.name ?? scope.country,
      currency: scope.currency,
      surface: scope.surface,
      language: languageName(language),
      languages: bot.languages.map(languageName),
      signedIn: Boolean(scope.customer),
    });
  }

  /**
   * One answer: the model, then the tools it asks for (at most four rounds), then its words, sanitised. `emit` hears
   * each tool as it runs and its cards as they come back.
   */
  async converse(bot: SupportBot, scope: ToolScope, language: string, turns: AiTurn[], kind: 'shop' | 'test', emit?: (event: AssistantEvent) => void) {
    const knowledge = await this.shops.knowledgeFor(bot, scope.country);
    const system = await this.system(bot, scope, language);
    const tools = this.tools.definitions(scope);
    const messages = [...turns];
    const cards: AssistantCard[] = [];
    const urls = new Set<string>();
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const usage = { input: 0, output: 0, cost: 0n };
    for (let round = 0; round < maxRounds; round += 1) {
      const reply = await this.ai.reply(
        { funding: 'bitocard', provider: bot.provider as AiProviderName, model: bot.model, resellerId: bot.resellerId, storeId: null, botId: bot.id, mode: 'live', kind },
        { system, context: knowledgeContext(knowledge), messages, tools, maxTokens: 800 },
      );
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cost += reply.costMicros;
      if (!reply.toolCalls.length) return { text: sanitiseAnswer(reply.text ?? '', urls), cards: cards.slice(0, maxCards), calls, usage };
      messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls as AiToolCall[]) {
        emit?.({ event: 'status', data: { tool: call.name } });
        calls.push({ name: call.name, arguments: call.arguments });
        const done = await this.tools.run(scope, call.name, call.arguments);
        for (const url of done.urls ?? []) urls.add(url);
        if (done.cards?.length) {
          cards.push(...done.cards);
          emit?.({ event: 'cards', data: { cards: done.cards } });
        }
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: done.result });
      }
    }
    return { text: sanitiseAnswer('', urls), cards: cards.slice(0, maxCards), calls, usage };
  }

  /** The thread's earlier turns as the model reads them (the person's words redacted again; the answers as shown). */
  private async history(threadId: string) {
    const rows = await this.prisma.assistantMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: historyTurns });
    return rows.reverse().map((row): AiTurn => (row.role === 'user' ? { role: 'user', content: redact(row.body) } : { role: 'assistant', content: row.body || '(showed results)' }));
  }

  /** The person writes; the answer follows (and is streamed to `emit`). Throws before anything is kept when refused. */
  async send(asker: Asker, threadId: string, input: { body: string; photo_ids?: string[] }, emit?: (event: AssistantEvent) => void) {
    const thread = await this.ownThread(asker, threadId);
    const bot = await this.prisma.supportBot.findUnique({ where: { id: thread.botId } });
    if (!bot || bot.status !== 'active' || !(await this.open(thread.country))) throw unavailable(bot?.name);
    const body = input.body.replace(/\r\n?/g, '\n').trim().slice(0, maxQuestion);
    if (!body) throw invalid('parameter_missing', 'Write a question.', 'body');
    const addressHash = await this.checkLimits(asker, bot);
    await this.checkBudget(bot);
    const images = input.photo_ids?.length ? await this.photos(asker, thread, bot, input.photo_ids) : [];
    const words = redact(body);
    const history = await this.history(thread.id);
    await this.prisma.assistantMessage.create({ data: { threadId: thread.id, role: 'user', body: words, addressHash } });
    await this.prisma.assistantThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } });
    const scope = await this.scopeFor(thread, bot, asker.customer);
    let outcome: Awaited<ReturnType<ShopAssistantService['converse']>>;
    try {
      outcome = await this.converse(bot, scope, thread.language, [...history, { role: 'user', content: words, ...(images.length ? { images } : {}) }], 'shop', emit);
    } catch (error) {
      this.logger.warn({ err: error, threadId }, 'A shop assistant could not answer');
      throw unavailable(bot.name);
    }
    const message = await this.prisma.assistantMessage.create({
      data: {
        threadId: thread.id,
        role: 'assistant',
        body: outcome.text,
        cards: outcome.cards as Prisma.InputJsonValue,
        toolCalls: outcome.calls as Prisma.InputJsonValue,
        inputTokens: outcome.usage.input,
        outputTokens: outcome.usage.output,
        costMicros: outcome.usage.cost,
      },
    });
    await this.prisma.assistantThread.update({ where: { id: thread.id }, data: { lastMessageAt: message.createdAt } });
    return this.presentMessage(message);
  }

  /** The seller's own listing photos (already uploaded and stripped of metadata), read for one answer only. */
  private async photos(asker: Asker, thread: AssistantThread, bot: SupportBot, ids: string[]) {
    if (!asker.customer || thread.surface !== 'sell' || !thread.listingId) throw invalid('parameter_invalid', 'Photos can be read only for your own listing.', 'photo_ids');
    return this.listingImages(asker.customer.id, thread.listingId, shopLimitsOf(bot).photos_per_draft, ids);
  }

  private async listingImages(customerId: string, listingId: string, limit: number, ids?: string[]) {
    const rows = await this.prisma.classifiedMedia.findMany({
      where: { listingId, kind: 'photo', status: 'ready', storageKey: { not: null }, listing: { customerId }, ...(ids?.length ? { id: { in: ids.filter(id => uuidPattern.test(id)) } } : {}) },
      orderBy: { position: 'asc' },
      take: limit,
    });
    const images: AiImage[] = [];
    for (const row of rows) {
      const bytes = await this.storage.read(row.storageKey!, 6 * 1024 * 1024).catch(() => null);
      if (!bytes?.length) continue;
      const head = bytes.subarray(0, 12);
      const mediaType = head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : head.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null;
      if (mediaType) images.push({ mediaType, data: Buffer.from(bytes).toString('base64') });
    }
    return images;
  }

  async rate(asker: Asker, messageId: string, rating: 1 | -1) {
    const message = await this.prisma.assistantMessage.findUnique({ where: { id: messageId }, include: { thread: true } });
    if (!message || message.role !== 'assistant') throw notFound('answer');
    await this.ownThread(asker, message.threadId);
    return this.presentMessage(await this.prisma.assistantMessage.update({ where: { id: messageId }, data: { rating } }));
  }

  async report(asker: Asker, messageId: string, reason: string) {
    const message = await this.prisma.assistantMessage.findUnique({ where: { id: messageId } });
    if (!message || message.role !== 'assistant') throw notFound('answer');
    await this.ownThread(asker, message.threadId);
    return this.presentMessage(await this.prisma.assistantMessage.update({ where: { id: messageId }, data: { reportedAt: new Date(), reportReason: redact(reason.trim()).slice(0, 500) || null } }));
  }

  /** Talk to a person: a support chat with BitoCard, opened with the conversation so far (signed in only). */
  async human(asker: Asker, threadId: string) {
    const thread = await this.ownThread(asker, threadId);
    if (!asker.customer) throw signIn();
    const bot = await this.prisma.supportBot.findUnique({ where: { id: thread.botId }, select: { name: true } });
    const messages = await this.prisma.assistantMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: 8 });
    const transcript = messages
      .reverse()
      .map(message => `${message.role === 'user' ? 'Me' : (bot?.name ?? 'Assistant')}: ${message.body || '(showed results)'}`)
      .join('\n');
    const body = `I was talking to ${bot?.name ?? 'the assistant'} on BitoCard Shop (${thread.country}) and need a person.\n\n${transcript}`.slice(0, 1900);
    const chat = await this.chats.sendAs({ kind: 'customer', customer: asker.customer }, body);
    if (chat.status === 'bot') await this.chats.askForPersonAs({ kind: 'customer', customer: asker.customer }, chat.id);
    await this.prisma.assistantThread.update({ where: { id: thread.id }, data: { chatId: chat.id } });
    return { object: 'assistant_handoff' as const, chat_id: chat.id };
  }

  // -- Sellers' suggestions -------------------------------------------------------------------------------------

  /**
   * A structured suggestion for a seller in the Shop tab. Price guidance comes from comparable listings alone (no AI);
   * the others ask the model for one structured answer, which is checked (registry keys, values, the country's
   * categories, the listing's text rules) and anything failing is dropped. Shown for the seller to accept or change.
   */
  async suggest(customer: CustomerWithStore, input: { kind: SuggestionKind; listing_id?: string; conversation_id?: string }) {
    this.checkAsker({ customer, visitorToken: null, address: null });
    const country = customer.country;
    if (!country || !(await this.open(country))) throw unavailable();
    const bot = await this.shops.resolve(country, 'en');
    if (!bot || !bot.roles.includes('sell')) throw unavailable(bot?.name);
    const listing = input.listing_id ? await this.tools.ownListing(customer.id, input.listing_id) : null;
    if (input.kind !== 'reply' && !listing) throw notFound('listing');
    if (listing && listing.country !== country) throw notFound('listing');
    const scope = await this.scopeFor({ country, surface: 'sell', listingId: listing?.id ?? null, conversationId: input.conversation_id ?? null }, bot, customer);
    if (input.kind === 'price') return { object: 'assistant_suggestion' as const, kind: 'price' as const, ...(await this.priceSuggestion(scope, listing!)) };
    await this.checkLimits({ customer, visitorToken: null, address: null }, bot);
    await this.checkBudget(bot);
    const asks: Record<Exclude<SuggestionKind, 'price'>, string> = { draft: '(Fill from photos)', improve: '(Improve this listing)', reply: '(Suggest a reply)' };
    const thread = await this.prisma.assistantThread.create({ data: { botId: bot.id, customerId: customer.id, country, language: bot.languages[0] ?? 'en', surface: 'sell', listingId: listing?.id ?? null, conversationId: input.conversation_id ?? null } });
    await this.prisma.assistantMessage.create({ data: { threadId: thread.id, role: 'user', body: asks[input.kind] } });
    let result: { suggestion: Record<string, unknown> | null; usage: { input: number; output: number; cost: bigint }; calls: unknown[] };
    try {
      result = input.kind === 'draft' ? await this.draftSuggestion(bot, scope, customer, listing!) : input.kind === 'improve' ? await this.improveSuggestion(bot, scope, listing!) : await this.replySuggestion(bot, scope, customer, input.conversation_id);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.logger.warn({ err: error, kind: input.kind }, 'A shop assistant could not suggest');
      throw unavailable(bot.name);
    }
    const message = await this.prisma.assistantMessage.create({
      data: { threadId: thread.id, role: 'assistant', body: '', cards: [{ type: 'suggestion', kind: input.kind, ...(result.suggestion ?? {}) }] as Prisma.InputJsonValue, toolCalls: result.calls as Prisma.InputJsonValue, inputTokens: result.usage.input, outputTokens: result.usage.output, costMicros: result.usage.cost },
    });
    return { object: 'assistant_suggestion' as const, kind: input.kind, message_id: message.id, suggestion: result.suggestion };
  }

  private async priceSuggestion(scope: ToolScope, listing: NonNullable<Awaited<ReturnType<ShopAssistantTools['ownListing']>>>) {
    if (!listing.category) return { suggestion: null, note: 'Choose a category first.' };
    const features = listing.features.filter(item => item.feature.dataType === 'choice' || item.feature.dataType === 'number').slice(0, 2).map(item => ({ key: item.feature.key, value: String(item.valueText ?? item.valueNumber ?? '') }));
    const outcome = await this.tools.priceRange(scope, { category: listing.category.slug, ...(listing.condition ? { condition: listing.condition } : {}), features });
    const card = outcome.cards?.find(item => item.type === 'price_range');
    if (card) return { suggestion: card, note: 'From comparable listings in the last 90 days: a range, not a valuation.' };
    // Without the features, the category and condition alone may have enough.
    const wider = await this.tools.priceRange(scope, { category: listing.category.slug, ...(listing.condition ? { condition: listing.condition } : {}) });
    const range = wider.cards?.find(item => item.type === 'price_range');
    return range ? { suggestion: range, note: 'From comparable listings in this category: a range, not a valuation.' } : { suggestion: null, note: 'Not enough comparable listings yet to suggest a price.' };
  }

  /** One structured answer: the model is asked to call the given tool once; its arguments are the suggestion. */
  private async structured(bot: SupportBot, scope: ToolScope, prompt: string, tool: { name: string; description: string; parameters: Record<string, unknown> }, images: AiImage[] = []) {
    const system = await this.system(bot, scope, bot.languages[0] ?? 'en');
    const knowledge = await this.shops.knowledgeFor(bot, scope.country);
    const reply = await this.ai.reply(
      { funding: 'bitocard', provider: bot.provider as AiProviderName, model: bot.model, resellerId: bot.resellerId, storeId: null, botId: bot.id, mode: 'live', kind: 'shop' },
      { system, context: knowledgeContext(knowledge), messages: [{ role: 'user', content: `${prompt}\n\nAnswer only by calling ${tool.name} once.`, ...(images.length ? { images } : {}) }], tools: [{ ...tool, parameters: { ...tool.parameters, additionalProperties: false } }], maxTokens: 1200 },
    );
    const call = reply.toolCalls.find(item => item.name === tool.name);
    return { args: call?.arguments ?? null, usage: { input: reply.usage.input, output: reply.usage.output, cost: reply.costMicros }, calls: reply.toolCalls.map(item => ({ name: item.name, arguments: item.arguments })) };
  }

  /** Words the listing may carry: no link and no blocked phrase in the country. */
  private async allowedText(country: string, text: string) {
    if (linkPattern.test(text)) return false;
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', action: 'block', OR: [{ country: null }, { country }] }, select: { phrase: true } });
    const plain = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    return !words.some(word => plain.includes(` ${word.phrase.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `));
  }

  private async draftSuggestion(bot: SupportBot, scope: ToolScope, customer: CustomerWithStore, listing: NonNullable<Awaited<ReturnType<ShopAssistantTools['ownListing']>>>) {
    const images = await this.listingImages(customer.id, listing.id, shopLimitsOf(bot).photos_per_draft);
    if (!images.length) throw invalid('photos_required', 'Add photos first: the suggestion is made from them.', 'listing_id');
    const [categories, registry] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ where: { enabled: true, parentId: { not: null }, countries: { some: { country: scope.country, enabled: true } } }, select: { id: true, slug: true, name: true, parent: { select: { name: true } }, features: { select: { featureId: true } } } }),
      this.prisma.classifiedFeature.findMany({ where: { enabled: true } }),
    ]);
    const prompt = [
      'Suggest this listing from its photos: a clear title (what it is, brand and model, key spec), the subcategory, the condition you can see, the features you can read from the photos (only keys from the list, only values you can see), and a short honest description in plain sentences (bullet points allowed, no links, no phone numbers, no claims you cannot see).',
      `Subcategories (slug: name): ${categories.map(item => `${item.slug}: ${item.parent?.name ?? ''} > ${item.name}`).join('; ')}`,
      `Feature keys (key: type${'[choices]'}): ${registry.map(item => `${item.key}: ${item.dataType}${item.choices.length ? `[${item.choices.join('|')}]` : ''}${item.unit ? ` (${item.unit})` : ''}`).join('; ')}`,
      `Conditions: ${conditions.join(', ')}.`,
      listing.title ? quoted('The seller’s title so far', listing.title, 200) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const done = await this.structured(bot, scope, prompt, {
      name: 'propose_listing',
      description: 'The suggested listing.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, condition: { type: 'string', enum: [...conditions] }, features: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } }, description: { type: 'string' } } },
    }, images);
    const args = done.args;
    if (!args) return { suggestion: null, usage: done.usage, calls: done.calls };
    const tryOr = <T,>(work: () => T) => {
      try {
        return work();
      } catch {
        return null;
      }
    };
    const category = categories.find(item => item.slug === String(args.category ?? '').trim().toLowerCase()) ?? null;
    const title = typeof args.title === 'string' ? tryOr(() => checkTitle(args.title as string)) : null;
    const condition = (conditions as readonly string[]).includes(String(args.condition)) ? String(args.condition) : null;
    const seen = new Set<string>();
    const features = (Array.isArray(args.features) ? (args.features as Array<Record<string, unknown>>) : [])
      .slice(0, 20)
      .map(item => {
        const feature = registry.find(row => row.key === String(item.key ?? '').trim().toLowerCase());
        if (!feature || seen.has(feature.key)) return null;
        const value = tryOr(() => checkFeatureValue(feature, item.value, 'features'));
        if (!value) return null;
        seen.add(feature.key);
        return { key: feature.key, name: feature.name, value: feature.dataType === 'number' ? value.valueNumber : feature.dataType === 'boolean' ? value.valueText === 'true' : value.valueText };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const textOk = async (value: string | null) => (value && (await this.allowedText(scope.country, value)) ? value : null);
    const description = typeof args.description === 'string' ? await textOk(tryOr(() => checkDescription(redact(args.description as string)))) : null;
    return {
      suggestion: { title: await textOk(title), category: category ? { slug: category.slug, name: category.name, id: category.id } : null, condition, features, description },
      usage: done.usage,
      calls: done.calls,
    };
  }

  private async improveSuggestion(bot: SupportBot, scope: ToolScope, listing: NonNullable<Awaited<ReturnType<ShopAssistantTools['ownListing']>>>) {
    const details = await this.tools.run(scope, 'my_listing', {});
    const missing = (listing.category?.features ?? []).filter(link => link.feature.enabled && !listing.features.some(item => item.featureId === link.featureId));
    const done = await this.structured(
      bot,
      scope,
      `How can this listing do better? Up to five short, specific tips (photos, title, features, description, price kind). Name missing features only from: ${missing.map(link => link.feature.key).join(', ') || 'none'}. Suggest a clearer title only if the current one is vague.\n\n${details.result}`,
      { name: 'propose_improvements', description: 'Tips for the seller.', parameters: { type: 'object', properties: { tips: { type: 'array', items: { type: 'string' }, maxItems: 5 }, missing_features: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['tips'] } },
    );
    const args = done.args;
    if (!args) return { suggestion: null, usage: done.usage, calls: done.calls };
    const tips = (Array.isArray(args.tips) ? args.tips : [])
      .slice(0, 5)
      .map(tip => sanitiseAnswer(String(tip).slice(0, 240), new Set()))
      .filter(Boolean);
    const keys = new Set((Array.isArray(args.missing_features) ? args.missing_features : []).map(String));
    let title: string | null = null;
    try {
      title = typeof args.title === 'string' && args.title.trim() && args.title.trim() !== listing.title ? checkTitle(args.title) : null;
    } catch {
      title = null;
    }
    return {
      suggestion: { tips, missing_features: missing.filter(link => keys.has(link.feature.key)).map(link => ({ key: link.feature.key, name: link.feature.name })), title: title && (await this.allowedText(scope.country, title)) ? title : null },
      usage: done.usage,
      calls: done.calls,
    };
  }

  private async replySuggestion(bot: SupportBot, scope: ToolScope, customer: CustomerWithStore, conversationId: string | undefined) {
    const chat = conversationId ? await this.tools.chatTranscript(customer.id, conversationId) : null;
    if (!chat) throw notFound('chat');
    const done = await this.structured(
      bot,
      scope,
      `Suggest the person's next reply in this chat about "${chat.title ?? 'a listing'}" (they are the ${chat.side}): short, polite, keeping the trade on BitoCard, recommending Safe pay or a public meet-up where money is involved, never asking for or sharing codes, phone numbers or bank details.\n\n${quoted('Messages', chat.lines.join('\n'), 3000) ?? '(no messages yet)'}`,
      { name: 'propose_reply', description: 'The suggested reply.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    );
    const raw = typeof done.args?.text === 'string' ? done.args.text : '';
    const text = cleanMessage(raw.slice(0, 600));
    const ok = text && !text.includes('[link hidden]') && !/\+?\d[\d\s-]{7,}\d/.test(text) && !/\[(number|code) hidden\]/.test(text);
    return { suggestion: ok ? { text } : null, usage: done.usage, calls: done.calls };
  }

  // -- The playground and evals -----------------------------------------------------------------------------------

  /** Try it: a conversation with the assistant as it is now, its tools reading the market's real listings. Nothing kept but usage. */
  async test(bot: SupportBot, messages: Array<{ role: 'user' | 'assistant'; content: string }>, options: { country?: string; surface?: ShopRole }) {
    const country = (options.country ?? (await this.shops.servedCountries(bot))[0] ?? 'NG').toUpperCase();
    const surface = options.surface && bot.roles.includes(options.surface) ? options.surface : ((bot.roles[0] as ShopRole | undefined) ?? 'browse');
    const scope = await this.scopeFor({ country, surface, listingId: null, conversationId: null }, bot, null);
    const turns: AiTurn[] = messages.slice(-20).map(message => (message.role === 'user' ? { role: 'user', content: redact(message.content) } : { role: 'assistant', content: message.content }));
    const outcome = await this.converse(bot, scope, bot.languages[0] ?? 'en', turns, 'test');
    return { reply: outcome.text, cards: outcome.cards, usage: { input: outcome.usage.input, cached: 0, output: outcome.usage.output } };
  }

  /** Runs the eval set against the assistant's model on a market's real listings, signed out, and keeps the scores. */
  async runEvals(actorId: string | null, botId: string, country?: string) {
    const bot = await this.prisma.supportBot.findUnique({ where: { id: botId } });
    if (!bot || bot.scope !== 'shop') throw notFound('shop assistant');
    const market = (country ?? (await this.shops.servedCountries(bot))[0] ?? 'NG').toUpperCase();
    const scope = await this.scopeFor({ country: market, surface: 'browse', listingId: null, conversationId: null }, { ...bot, roles: [...new Set([...bot.roles, 'browse', 'help'])] }, null);
    const results = [];
    for (const item of evalCases) {
      let outcome: EvalOutcome;
      try {
        const done = await this.converse(bot, scope, bot.languages[0] ?? 'en', [{ role: 'user', content: item.ask }], 'test');
        outcome = { tools: done.calls, text: done.text };
      } catch (error) {
        results.push({ id: item.id, kind: item.kind, ask: item.ask, passed: false, reason: `no answer (${(error as Error).message.slice(0, 120)})`, tools: [], answer: '' });
        continue;
      }
      const failure = scoreCase(item, outcome);
      results.push({ id: item.id, kind: item.kind, ask: item.ask, passed: !failure, reason: failure, tools: outcome.tools.map(call => call.name), answer: outcome.text.slice(0, 600) });
    }
    const row = await this.prisma.shopBotEval.create({ data: { botId, provider: bot.provider, model: bot.model, cases: results.length, passed: results.filter(item => item.passed).length, results: results as Prisma.InputJsonValue, createdById: actorId } });
    return { object: 'shop_bot_eval' as const, id: row.id, country: market, provider: row.provider, model: row.model, cases: row.cases, passed: row.passed, results, created_at: row.createdAt.toISOString() };
  }
}
