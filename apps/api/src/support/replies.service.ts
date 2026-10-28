import { Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { PrismaService } from '../database/prisma.service.js';
import type { SupportBot, SupportConversation, SupportTicket } from '../generated/prisma/client.js';
import { formatMoney } from '../notifications/templates.js';
import { AfrippaAssistantRegistry, isAfrippaBot } from './afrippa-assistant.js';
import { AiService } from './ai/ai.service.js';
import type { AiProviderName, AiTool, AiToolCall, AiTurn } from './ai/providers.js';
import { ChatsService } from './chats.service.js';
import { profileContext, requesterProfile } from './people.js';
import { knowledgeContext, systemPrompt } from './prompt.js';
import { redact } from './redact.js';
import { ticketCategories, ticketReference, TicketsService, type TicketCategory } from './tickets.service.js';

/** How long one run holds a chat or ticket while it answers. */
const claimMs = 90_000;
/** Tool rounds per answer, so a model cannot loop. */
const maxRounds = 4;
const handoverText = 'I have asked a person to help with this. They will reply here as soon as they can.';

type Scope = { bot: SupportBot; storeName: string; customerId: string | null; resellerId: string; storeId: string | null; requester: 'customer' | 'reseller'; profile: string | null };

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): AiTool => ({ name, description, parameters: { type: 'object', properties, required, additionalProperties: false } });

/**
 * The assistants answering. A chat with an active chat assistant starts with it (`bot`); each requester message is
 * answered after the reply is sent (`waitUntil`, with the `support-replies` job as backstop), one run at a time
 * (claimed), until a person takes over, the requester asks for one, or the assistant hands over. Tickets with an
 * active tickets assistant get a reply (automatic) or a draft for staff, while no person has written on them yet.
 * Requesters' words are redacted before they are sent and answers after they come back; tools are run by BitoCard,
 * scoped to the conversation's store and customer, and never return codes or suppliers.
 */
@Injectable()
export class RepliesService {
  private readonly logger = new Logger('SupportReplies');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly chats: ChatsService,
    private readonly tickets: TicketsService,
    private readonly afrippa: AfrippaAssistantRegistry,
  ) {
    chats.onRequesterMessage(chat => this.later(this.answerChat(chat.id)));
    chats.assistantFor(chat => this.chatAssistant(chat));
    tickets.onRequesterMessage(ticket => this.later(this.answerTicket(ticket.id)));
  }

  private later(work: Promise<unknown>) {
    waitUntil(work.catch(error => this.logger.warn({ err: error }, 'An assistant could not answer')));
  }

  /** The active assistant for a store's chats (BitoCard's for resellers' chats), or null. */
  async chatAssistant(chat: Pick<SupportConversation, 'storeId' | 'requester'>) {
    const where = chat.requester === 'reseller' ? { scope: 'platform' } : chat.storeId ? { storeId: chat.storeId } : null;
    if (!where) return null;
    const bot = await this.prisma.supportBot.findFirst({ where: { ...where, status: 'active', roles: { has: 'chat' } } });
    return bot;
  }

  private async ticketAssistant(ticket: SupportTicket) {
    if (ticket.requester === 'reseller') return this.prisma.supportBot.findFirst({ where: { scope: 'platform', status: 'active', roles: { has: 'tickets' } } });
    if (!ticket.storeId) return null;
    // A store's assistant answers its own queue; a ticket passed to BitoCard is BitoCard's (any house store's is its own store's).
    if (ticket.queue === 'bitocard') {
      const store = await this.prisma.store.findUnique({ where: { id: ticket.storeId }, select: { reseller: { select: { house: true } } } });
      if (!store?.reseller.house) return null;
    }
    return this.prisma.supportBot.findFirst({ where: { storeId: ticket.storeId, status: 'active', roles: { has: 'tickets' } } });
  }

  /** Who answers and for whom: the store, and the requester's own details (name, email, mobile, country, currency) to address them personally. */
  private async scope(bot: SupportBot, input: { storeId: string | null; customerId: string | null; resellerId: string; requester: string; userId: string | null; visitorId?: string | null }): Promise<Scope> {
    const [store, profile] = await Promise.all([input.storeId ? this.prisma.store.findUnique({ where: { id: input.storeId }, select: { name: true } }) : null, requesterProfile(this.prisma, input)]);
    return { bot, storeName: store?.name ?? 'the store', customerId: input.customerId, resellerId: input.resellerId, storeId: input.storeId, requester: input.requester === 'reseller' ? 'reseller' : 'customer', profile: profileContext(profile) };
  }

  // -- Chats -------------------------------------------------------------------------------------------------------

  /** Answers a chat's latest requester message, if the assistant still has it and nobody answered since. */
  async answerChat(chatId: string) {
    const now = new Date();
    const claimed = await this.prisma.supportConversation.updateMany({
      where: { id: chatId, status: 'bot', OR: [{ botClaimedAt: null }, { botClaimedAt: { lt: new Date(now.getTime() - claimMs) } }] },
      data: { botClaimedAt: now },
    });
    if (!claimed.count) return 'busy';
    try {
      const chat = await this.prisma.supportConversation.findUniqueOrThrow({ where: { id: chatId }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 30 } } });
      const messages = chat.messages.reverse();
      const last = messages.at(-1);
      if (!last || last.author !== chat.requester) return 'nothing';
      const bot = chat.botId ? await this.prisma.supportBot.findUnique({ where: { id: chat.botId } }) : await this.chatAssistant(chat);
      if (!bot || bot.status !== 'active' || !bot.roles.includes('chat')) return this.chats.handOver(chat.id, 'The assistant is not available.');
      const scope = await this.scope(bot, chat);
      const turns: AiTurn[] = messages
        .filter(message => message.author !== 'system')
        .map(message => (message.author === chat.requester ? { role: 'user' as const, content: redact(message.body || '(sent a file)') } : { role: 'assistant' as const, content: message.body }));
      const outcome = await this.converse(scope, turns, { chatId: chat.id, kind: 'chat' });
      if (outcome.handover) return this.chats.handOver(chat.id, outcome.handover, outcome.text ?? undefined);
      if (outcome.text) await this.chats.botWrote(chat.id, bot, outcome.text);
      return 'answered';
    } catch (error) {
      this.logger.warn({ err: error, chatId }, 'The assistant could not answer a chat; a person will');
      await this.chats.handOver(chatId, 'The assistant could not answer.').catch(() => undefined);
      return 'failed';
    } finally {
      await this.prisma.supportConversation.updateMany({ where: { id: chatId }, data: { botClaimedAt: null } });
    }
  }

  // -- Tickets -----------------------------------------------------------------------------------------------------

  /** Replies to (or drafts a reply for) a ticket whose requester wrote last, while no person has written on it. */
  async answerTicket(ticketId: string) {
    const now = new Date();
    const claimed = await this.prisma.supportTicket.updateMany({
      where: { id: ticketId, status: 'open', OR: [{ botClaimedAt: null }, { botClaimedAt: { lt: new Date(now.getTime() - claimMs) } }] },
      data: { botClaimedAt: now },
    });
    if (!claimed.count) return 'busy';
    try {
      const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      const bot = await this.ticketAssistant(ticket);
      if (!bot) return 'no_assistant';
      const visible = ticket.messages.filter(message => !message.draft && message.visibility === 'all');
      // A person on the store's, BitoCard's or Afrippa's team has written: the assistant stops.
      if (visible.some(message => message.author === 'reseller' || message.author === 'bitocard' || message.author === 'afrippa') && ticket.requester === 'customer') return 'person_answering';
      if (ticket.requester === 'reseller' && visible.some(message => message.author === 'bitocard')) return 'person_answering';
      const last = visible.at(-1);
      if (!last || last.author !== ticket.requester) return 'nothing';
      if (ticket.messages.some(message => message.draft && message.createdAt > last.createdAt)) return 'drafted';
      const scope = await this.scope(bot, ticket);
      const turns: AiTurn[] = visible.filter(message => message.author !== 'system').map(message => (message.author === ticket.requester ? { role: 'user' as const, content: redact(message.body) } : { role: 'assistant' as const, content: message.body }));
      turns.unshift({ role: 'user', content: `(Support ticket ${ticketReference(ticket.number)}: ${redact(ticket.subject)})` });
      const outcome = await this.converse(scope, turns, { ticketId: ticket.id, kind: 'ticket' });
      if (outcome.handover) {
        await this.tickets.botNote(ticket.id, bot, `Assistant handed over: ${outcome.handover}`);
        return 'handed_over';
      }
      if (!outcome.text) return 'nothing';
      if (bot.ticketReplyMode === 'auto') await this.tickets.botReply(ticket.id, bot, outcome.text);
      else await this.tickets.botDraft(ticket.id, bot, outcome.text);
      return bot.ticketReplyMode === 'auto' ? 'answered' : 'drafted';
    } catch (error) {
      this.logger.warn({ err: error, ticketId }, 'The assistant could not answer a ticket');
      return 'failed';
    } finally {
      await this.prisma.supportTicket.updateMany({ where: { id: ticketId }, data: { botClaimedAt: null } });
    }
  }

  // -- The conversation with the model -----------------------------------------------------------------------------

  private tools(scope: Scope, place: { chatId?: string }): AiTool[] {
    const handoff = tool('handoff', 'Hand the conversation to a person: when unsure, when money must move, for identity or legal questions, complaints, or whenever the user asks for a person.', { reason: { type: 'string', description: 'Why, in a few words, for the staff.' } }, ['reason']);
    if (isAfrippaBot(scope.bot)) {
      // Afrippa's tools (the market's ads, the trader's own orders, fees, the safety checks); a visitor cannot follow a ticket.
      const ticket = place.chatId && scope.customerId ? [tool('create_ticket', 'Open a support ticket from this chat for something that needs following up over time.', { subject: { type: 'string' }, category: { type: 'string', enum: [...ticketCategories] } }, ['subject', 'category'])] : [];
      return [handoff, ...this.afrippa.get().tools({ customerId: scope.customerId, chatId: place.chatId }), ...ticket];
    }
    const list: AiTool[] = [
      tool('handoff', 'Hand the conversation to a person: when unsure, when money must move, for identity or legal questions, complaints, or whenever the user asks for a person.', { reason: { type: 'string', description: 'Why, in a few words, for the staff.' } }, ['reason']),
    ];
    if (scope.requester === 'customer' && scope.storeId) {
      list.push(tool('search_products', 'Search what this store sells (names, categories, face values). Prices are quoted at checkout.', { query: { type: 'string' } }, ['query']));
      if (scope.customerId) list.push(tool('my_orders', 'The customer’s latest orders at this store: what, when and their status. Never codes: those are on the order page after Reveal.'));
    }
    if (scope.requester === 'reseller') list.push(tool('my_account', 'The reseller’s account: verification, plan, stores and wallet status (never balances).'));
    // A visitor (no account) cannot follow a ticket.
    if (place.chatId && (scope.requester === 'reseller' || scope.customerId)) list.push(tool('create_ticket', 'Open a support ticket from this chat for something that needs following up over time.', { subject: { type: 'string' }, category: { type: 'string', enum: [...ticketCategories] } }, ['subject', 'category']));
    return list;
  }

  private async runTool(scope: Scope, call: AiToolCall, place: { chatId?: string }): Promise<{ result: string; handover?: string; ticket?: string }> {
    const args = call.arguments;
    if (call.name === 'handoff') return { result: 'Handed over.', handover: String(args.reason ?? 'The assistant asked for a person.').slice(0, 300) };
    if (isAfrippaBot(scope.bot) && call.name !== 'create_ticket') {
      const result = await this.afrippa.get().run({ customerId: scope.customerId, chatId: place.chatId }, call);
      return { result: result ?? 'That tool is not available here.' };
    }
    if (call.name === 'search_products' && scope.storeId) {
      const query = String(args.query ?? '').trim().slice(0, 80);
      const store = await this.prisma.store.findUnique({ where: { id: scope.storeId }, select: { resellerId: true, reseller: { select: { house: true } } } });
      const house = store?.reseller.house ?? false;
      const products = await this.prisma.product.findMany({
        where: { active: true, name: { contains: query, mode: 'insensitive' }, ...(house ? { listed: true } : { listings: { some: { resellerId: store?.resellerId ?? '' } } }) },
        take: 8,
        select: { name: true, category: true, faceCurrency: true, fixedValues: true, minValueMinor: true, maxValueMinor: true },
      });
      return {
        result: JSON.stringify(
          products.map(product => ({
            name: product.name,
            category: product.category,
            face_values: product.fixedValues.length ? product.fixedValues.slice(0, 8).map(value => formatMoney(value, product.faceCurrency)) : product.minValueMinor !== null && product.maxValueMinor !== null ? `${formatMoney(product.minValueMinor, product.faceCurrency)} to ${formatMoney(product.maxValueMinor, product.faceCurrency)}` : null,
          })),
        ),
      };
    }
    if (call.name === 'my_orders' && scope.customerId) {
      const checkouts = await this.prisma.checkout.findMany({ where: { customerId: scope.customerId }, orderBy: { createdAt: 'desc' }, take: 5 });
      const quotes = await this.prisma.quote.findMany({ where: { id: { in: checkouts.map(checkout => checkout.quoteId) } }, select: { id: true, productId: true } });
      const products = await this.prisma.product.findMany({ where: { id: { in: quotes.map(quote => quote.productId) } }, select: { id: true, name: true } });
      const name = (quoteId: string) => products.find(product => product.id === quotes.find(quote => quote.id === quoteId)?.productId)?.name ?? 'A product';
      return { result: JSON.stringify(checkouts.map(checkout => ({ product: name(checkout.quoteId), status: checkout.status, ordered: `${checkout.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, order_page: `/account/orders/${checkout.id}` }))) };
    }
    if (call.name === 'my_account' && scope.requester === 'reseller') {
      const reseller = await this.prisma.reseller.findUnique({ where: { id: scope.resellerId }, include: { plan: true, _count: { select: { stores: true } } } });
      return { result: JSON.stringify(reseller ? { status: reseller.status, identity_checked: Boolean(reseller.verifiedAt), plan: reseller.plan.name, stores: reseller._count.stores, country: reseller.country } : {}) };
    }
    if (call.name === 'create_ticket' && place.chatId) {
      const category = (ticketCategories as readonly string[]).includes(String(args.category)) ? (String(args.category) as TicketCategory) : 'other';
      const reference = await this.chats.ticketByAssistant(place.chatId, { subject: String(args.subject ?? 'From a chat').slice(0, 200) || 'From a chat', category });
      return { result: `Ticket ${reference} opened. The chat ends now; replies come on the ticket.`, ticket: reference };
    }
    return { result: 'That tool is not available here.' };
  }

  /** One answer: the model, then any tools it asks for (at most four rounds), then its words, redacted. */
  private async converse(scope: Scope, turns: AiTurn[], place: { chatId?: string; ticketId?: string; kind: 'chat' | 'ticket' }) {
    const knowledge = scope.bot.knowledgeId ? await this.prisma.supportBotKnowledge.findUnique({ where: { id: scope.bot.knowledgeId }, select: { content: true } }) : null;
    const audience = scope.requester === 'reseller' ? ({ kind: 'reseller' } as const) : ({ kind: 'customer', store: scope.storeName } as const);
    const system = isAfrippaBot(scope.bot) ? this.afrippa.get().prompt(scope.bot, { customerId: scope.customerId, chatId: place.chatId }) : systemPrompt(scope.bot, audience, { tools: true });
    const tools = this.tools(scope, place);
    const messages = [...turns];
    for (let round = 0; round < maxRounds; round += 1) {
      const reply = await this.ai.reply(
        { funding: scope.bot.funding as 'bitocard' | 'own', provider: scope.bot.provider as AiProviderName, model: scope.bot.model, resellerId: scope.bot.resellerId, storeId: scope.storeId, botId: scope.bot.id, mode: 'live', kind: place.kind },
        { system, context: knowledgeContext(knowledge?.content), ...(scope.profile ? { about: scope.profile } : {}), messages, tools, maxTokens: 700 },
      );
      if (!reply.toolCalls.length) return { text: reply.text ? redact(reply.text) : null, handover: null as string | null };
      messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const done = await this.runTool(scope, call, place);
        if (done.handover) return { text: reply.text ? redact(reply.text) : null, handover: done.handover };
        if (done.ticket) return { text: null, handover: null };
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: done.result });
      }
    }
    return { text: null, handover: 'The assistant could not finish its answer.' };
  }

  /** The backstop (`support-replies` job): chats and tickets an answer after the reply never reached. */
  async job() {
    const before = new Date(Date.now() - 20_000);
    const chats = await this.prisma.supportConversation.findMany({ where: { status: 'bot', lastAskedAt: { lt: before }, botClaimedAt: null }, select: { id: true }, take: 50 });
    let chatAnswers = 0;
    for (const chat of chats) if ((await this.answerChat(chat.id)) === 'answered') chatAnswers += 1;
    const tickets = await this.prisma.supportTicket.findMany({ where: { status: 'open', botClaimedAt: null, lastMessageAt: { lt: before, gt: new Date(Date.now() - 24 * 3600_000) } }, select: { id: true }, take: 50 });
    let ticketAnswers = 0;
    for (const ticket of tickets) if (['answered', 'drafted'].includes(await this.answerTicket(ticket.id))) ticketAnswers += 1;
    return { chats: chats.length, chat_answers: chatAnswers, tickets: tickets.length, ticket_answers: ticketAnswers };
  }
}

export { handoverText };
