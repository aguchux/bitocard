import { HttpStatus, Injectable } from '@nestjs/common';
import { houseRootId, HouseService, houseStoreId } from '../checkout/house.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma, SupportBot, SupportChatMessage, SupportConversation } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { type TicketCategory, ticketReference, TicketsService } from './tickets.service.js';

export const chatStatuses = ['bot', 'waiting', 'with_staff', 'closed'] as const;
export type ChatStatus = (typeof chatStatuses)[number];
type Audience = 'customer' | 'reseller' | 'admin';
type ChatWithMessages = SupportConversation & { messages: SupportChatMessage[] };
export type ChatAuthor = { kind: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; id: string | null; name: string | null };

/** The longest chat message. */
export const maxChatMessage = 2000;
/** A requester's messages per minute in one chat, so a chat cannot be flooded. */
export const chatMessagesPerMinute = 12;
/** Staff are told a chat is waiting at most this often per chat. */
const alertEveryMs = 10 * 60 * 1000;
/** Messages returned with a chat: the latest ones. */
const messagesShown = 200;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such chat.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const system: ChatAuthor = { kind: 'system', id: null, name: null };

function presentMessage(message: SupportChatMessage, audience: Audience) {
  return {
    id: message.id,
    author: message.author,
    // Customers never see staff names; an assistant by its name.
    author_name: audience === 'customer' && message.author !== 'customer' && message.author !== 'bot' ? null : message.authorName,
    body: message.body,
    created_at: message.createdAt.toISOString(),
  };
}

/** A chat as each side sees it. The requester sees whether someone is answering; staff see everything. */
export function presentChat(chat: ChatWithMessages, audience: Audience, extra: { requester_name?: string | null; ticket_reference?: string | null } = {}) {
  const messages = chat.messages.map(message => presentMessage(message, audience));
  if (audience === 'customer') {
    return { object: 'support_chat' as const, id: chat.id, status: chat.status as ChatStatus, ticket_reference: extra.ticket_reference ?? null, created_at: chat.createdAt.toISOString(), closed_at: chat.closedAt?.toISOString() ?? null, messages };
  }
  return {
    object: 'support_chat' as const,
    id: chat.id,
    mode: chat.mode,
    requester: chat.requester as 'customer' | 'reseller',
    requester_name: extra.requester_name ?? null,
    queue: chat.queue as 'reseller' | 'bitocard',
    status: chat.status as ChatStatus,
    store_id: chat.storeId,
    customer_id: chat.customerId,
    user_id: chat.userId,
    assignee_id: audience === 'reseller' && chat.queue === 'bitocard' ? null : chat.assigneeId,
    ticket_id: chat.ticketId,
    ticket_reference: extra.ticket_reference ?? null,
    last_message_at: chat.lastMessageAt.toISOString(),
    last_asked_at: chat.lastAskedAt.toISOString(),
    closed_at: chat.closedAt?.toISOString() ?? null,
    created_at: chat.createdAt.toISOString(),
    ...(audience === 'admin' ? { reseller_id: chat.resellerId } : {}),
    messages,
  };
}

/**
 * Live chat. A store customer chats with their store (BitoCard at bitocard.com); a reseller's team chats with BitoCard.
 * One open chat per customer (and per reseller account and mode) at a time. The requester's message makes it wait for a
 * person (staff are told, at most every 10 minutes); staff answer, take it over, close it, or turn it into a ticket.
 * Clients poll for new messages (`after`): there is no socket on Vercel Functions. An assistant answering (`bot`) comes
 * with the support bots.
 */
@Injectable()
export class ChatsService {
  /** Set by the assistants: told after each requester message to a chat an assistant has. */
  private requesterListener: ((chat: SupportConversation) => void) | null = null;
  /** Set by the assistants: the active chat assistant for a new chat, if any. */
  private assistantResolver: ((chat: Pick<SupportConversation, 'storeId' | 'requester'>) => Promise<SupportBot | null>) | null = null;

  onRequesterMessage(listener: (chat: SupportConversation) => void) {
    this.requesterListener = listener;
  }

  assistantFor(resolver: (chat: Pick<SupportConversation, 'storeId' | 'requester'>) => Promise<SupportBot | null>) {
    this.assistantResolver = resolver;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sellers: StoreSellers,
    private readonly house: HouseService,
    private readonly tickets: TicketsService,
    private readonly inbox: InboxService,
  ) {}

  private load(where: Prisma.SupportConversationWhereInput) {
    return this.prisma.supportConversation.findFirst({ where, include: { messages: { orderBy: { createdAt: 'desc' }, take: messagesShown } } }).then(chat => (chat ? { ...chat, messages: chat.messages.reverse() } : null));
  }

  private async extras(chat: SupportConversation) {
    const [customer, user, ticket] = await Promise.all([
      chat.customerId ? this.prisma.customer.findUnique({ where: { id: chat.customerId }, select: { name: true } }) : null,
      chat.userId ? this.prisma.user.findUnique({ where: { id: chat.userId }, select: { name: true } }) : null,
      chat.ticketId ? this.prisma.supportTicket.findUnique({ where: { id: chat.ticketId }, select: { number: true } }) : null,
    ]);
    return { requester_name: customer?.name ?? user?.name ?? null, ticket_reference: ticket ? ticketReference(ticket.number) : null };
  }

  private async present(chat: ChatWithMessages, audience: Audience) {
    return presentChat(chat, audience, await this.extras(chat));
  }

  // -- Store customers ---------------------------------------------------------------------------------------------

  /** The customer's open chat, or null. */
  async currentForCustomer(customer: CustomerWithStore) {
    const chat = await this.load({ customerId: customer.id, status: { not: 'closed' } });
    return chat ? this.present(chat, 'customer') : null;
  }

  /** The store's chat assistant as customers see it (name, face, greeting), or null when none is answering chats. */
  async assistantProfile(customer: CustomerWithStore) {
    const bot = await this.assistantResolver?.({ storeId: customer.storeId, requester: 'customer' });
    return bot ? { name: bot.name, avatar_url: bot.avatarUrl, greeting: bot.greeting } : null;
  }

  /** The customer asks for a person: the assistant stops and staff are told. */
  async askForPerson(customer: CustomerWithStore, id: string) {
    const chat = await this.prisma.supportConversation.findFirst({ where: { id, customerId: customer.id } });
    if (!chat) throw notFound();
    if (chat.status === 'bot') await this.handOver(chat.id, 'The customer asked for a person.');
    return this.present((await this.load({ id }))!, 'customer');
  }

  /** The customer writes: their open chat, or a new one with the store (BitoCard at bitocard.com). */
  async sendAsCustomer(customer: CustomerWithStore, body: string) {
    const house = customer.storeId === houseStoreId;
    const open = await this.openOrCreate({ customerId: customer.id, status: { not: 'closed' } }, async () => ({
      resellerId: house ? (customer.country ? (await this.house.resellerFor(customer.country)).id : houseRootId) : customer.store.resellerId,
      mode: this.sellers.mode(customer.store),
      requester: 'customer',
      queue: house ? 'bitocard' : 'reseller',
      storeId: customer.storeId,
      customerId: customer.id,
    }));
    await this.requesterWrote(open, { kind: 'customer', id: customer.id, name: customer.name }, body);
    return this.present((await this.load({ id: open.id }))!, 'customer');
  }

  /** New messages since `after` (a message ID) for the customer's chat, for polling. */
  async messagesForCustomer(customer: CustomerWithStore, id: string, after?: string) {
    const chat = await this.prisma.supportConversation.findFirst({ where: { id, customerId: customer.id } });
    if (!chat) throw notFound();
    return this.since(chat, after, 'customer');
  }

  async closeAsCustomer(customer: CustomerWithStore, id: string) {
    const chat = await this.prisma.supportConversation.findFirst({ where: { id, customerId: customer.id } });
    if (!chat) throw notFound();
    await this.close(chat, { kind: 'system', id: null, name: null }, 'The customer ended the chat.');
    return this.present((await this.load({ id }))!, 'customer');
  }

  // -- Resellers chatting with BitoCard ----------------------------------------------------------------------------

  async currentForReseller(resellerId: string, mode: LedgerMode) {
    const chat = await this.load({ resellerId, mode, requester: 'reseller', status: { not: 'closed' } });
    return chat ? this.present(chat, 'reseller') : null;
  }

  async sendAsReseller(resellerId: string, mode: LedgerMode, author: ChatAuthor, body: string) {
    const open = await this.openOrCreate({ resellerId, mode, requester: 'reseller', status: { not: 'closed' } }, async () => ({ resellerId, mode, requester: 'reseller', queue: 'bitocard', userId: author.id }));
    await this.requesterWrote(open, author, body);
    return this.present((await this.load({ id: open.id }))!, 'reseller');
  }

  // -- Staff (the store for its customers, BitoCard for its queue) -------------------------------------------------

  async listForReseller(resellerId: string, mode: LedgerMode, filter: { status?: ChatStatus; limit?: number; starting_after?: string }) {
    return this.page({ resellerId, mode, requester: 'customer', queue: 'reseller', status: filter.status ?? { not: 'closed' } }, filter, 'reseller');
  }

  async listForAdmin(filter: { status?: ChatStatus; limit?: number; starting_after?: string }) {
    return this.page({ queue: 'bitocard', status: filter.status ?? { not: 'closed' } }, filter, 'admin');
  }

  /** A chat the reseller can see: their customers' (to answer) and their own with BitoCard. */
  private async owned(resellerId: string, mode: LedgerMode, id: string) {
    const chat = await this.load({ id, resellerId, mode });
    if (!chat) throw notFound();
    return chat;
  }

  private async adminOwned(id: string) {
    const chat = await this.load({ id, queue: 'bitocard' });
    if (!chat) throw notFound();
    return chat;
  }

  async getForReseller(resellerId: string, mode: LedgerMode, id: string) {
    return this.present(await this.owned(resellerId, mode, id), 'reseller');
  }

  async getForAdmin(id: string) {
    return this.present(await this.adminOwned(id), 'admin');
  }

  async messagesForReseller(resellerId: string, mode: LedgerMode, id: string, after?: string) {
    return this.since(await this.owned(resellerId, mode, id), after, 'reseller');
  }

  async messagesForAdmin(id: string, after?: string) {
    return this.since(await this.adminOwned(id), after, 'admin');
  }

  /** The store answers its customer: a person is answering now (and it is theirs unless someone else has it). */
  async replyAsReseller(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor, body: string) {
    const chat = await this.owned(resellerId, mode, id);
    if (chat.requester !== 'customer' || chat.queue !== 'reseller') throw conflict('chat_not_yours', 'BitoCard answers this chat.');
    await this.staffWrote(chat, author, body);
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async replyAsAdmin(id: string, author: ChatAuthor, body: string) {
    const chat = await this.adminOwned(id);
    await this.staffWrote(chat, author, body);
    return this.present((await this.load({ id }))!, 'admin');
  }

  /** A team member takes the chat over (from an assistant, or from a colleague). */
  async takeAsReseller(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor) {
    const chat = await this.owned(resellerId, mode, id);
    if (chat.requester !== 'customer' || chat.queue !== 'reseller') throw conflict('chat_not_yours', 'BitoCard answers this chat.');
    await this.take(chat, author);
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async takeAsAdmin(id: string, author: ChatAuthor) {
    const chat = await this.adminOwned(id);
    await this.take(chat, author);
    return this.present((await this.load({ id }))!, 'admin');
  }

  /** Closes a chat: the store closes its customers', the reseller its own with BitoCard. */
  async closeAsReseller(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor) {
    const chat = await this.owned(resellerId, mode, id);
    if (chat.requester === 'customer' && chat.queue !== 'reseller') throw conflict('chat_not_yours', 'BitoCard answers this chat.');
    await this.close(chat, system, chat.requester === 'reseller' ? `${author.name ?? 'The store'} ended the chat.` : 'The store ended the chat.');
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async closeAsAdmin(id: string) {
    const chat = await this.adminOwned(id);
    await this.close(chat, system, 'BitoCard ended the chat.');
    return this.present((await this.load({ id }))!, 'admin');
  }

  /** Turns a chat into a ticket (the transcript its first message) and closes the chat, telling the requester. */
  async ticketAsReseller(resellerId: string, mode: LedgerMode, id: string, input: { subject: string; category: TicketCategory }) {
    const chat = await this.owned(resellerId, mode, id);
    if (chat.requester !== 'customer' || chat.queue !== 'reseller') throw conflict('chat_not_yours', 'BitoCard answers this chat.');
    await this.toTicket(chat, input, 'chat');
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async ticketAsAdmin(id: string, input: { subject: string; category: TicketCategory }) {
    const chat = await this.adminOwned(id);
    await this.toTicket(chat, input, 'chat');
    return this.present((await this.load({ id }))!, 'admin');
  }

  /** Retention: chats that ended more than 12 months ago are deleted with their messages (the daily `support` job). */
  async purgeOld(now = new Date()) {
    const before = new Date(now.getTime() - 365 * 24 * 3600_000);
    return (await this.prisma.supportConversation.deleteMany({ where: { status: 'closed', closedAt: { lt: before } } })).count;
  }

  // -- Shared ------------------------------------------------------------------------------------------------------

  /** The requester's open chat, or a new one. Two tabs starting at once get the same chat (one open per requester). */
  private async openOrCreate(where: Prisma.SupportConversationWhereInput, data: () => Promise<Prisma.SupportConversationUncheckedCreateInput>) {
    const open = await this.prisma.supportConversation.findFirst({ where });
    if (open) return open;
    try {
      const values = await data();
      // A store (or BitoCard) with an active chat assistant: it answers first.
      const bot = await this.assistantResolver?.({ storeId: values.storeId ?? null, requester: values.requester });
      return await this.prisma.supportConversation.create({ data: { ...values, ...(bot ? { status: 'bot', botId: bot.id } : {}) } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.prisma.supportConversation.findFirstOrThrow({ where });
    }
  }

  /** The requester writes: it waits for a person unless one is answering, and staff are told (at most every 10 minutes). */
  private async requesterWrote(chat: SupportConversation, author: ChatAuthor, body: string) {
    const text = body.trim().slice(0, maxChatMessage);
    if (!text) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write a message.', 'body');
    const recent = await this.prisma.supportChatMessage.count({ where: { conversationId: chat.id, author: author.kind, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= chatMessagesPerMinute) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'chat_rate_limited', 'You are sending messages very fast. Wait a moment, then send again.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chat.id, author: author.kind, authorId: author.id, authorName: author.name, body: text, createdAt: now } }),
      this.prisma.supportConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now, lastAskedAt: now, ...(chat.status === 'closed' ? { status: 'waiting', closedAt: null } : {}) } }),
    ]);
    if (chat.status === 'bot') this.requesterListener?.(chat);
    else if (chat.status !== 'with_staff') await this.alertStaff(chat);
  }

  /** The assistant's answer in a chat it still has. */
  async botWrote(chatId: string, bot: SupportBot, body: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chatId, author: 'bot', authorId: bot.id, authorName: bot.name, body: body.slice(0, maxChatMessage), createdAt: now } }),
      this.prisma.supportConversation.updateMany({ where: { id: chatId, status: 'bot' }, data: { lastMessageAt: now } }),
    ]);
  }

  /**
   * The assistant steps back (it handed over, failed, or the requester asked for a person): the chat waits for a person,
   * the requester is told, and staff are alerted.
   */
  async handOver(chatId: string, reason: string, text?: string) {
    const chat = await this.prisma.supportConversation.findUnique({ where: { id: chatId } });
    if (!chat || chat.status !== 'bot') return 'not_with_assistant';
    const now = new Date();
    const claimed = await this.prisma.supportConversation.updateMany({ where: { id: chatId, status: 'bot' }, data: { status: 'waiting', lastMessageAt: now } });
    if (!claimed.count) return 'not_with_assistant';
    const bot = chat.botId ? await this.prisma.supportBot.findUnique({ where: { id: chat.botId }, select: { id: true, name: true } }) : null;
    await this.prisma.supportChatMessage.createMany({
      data: [
        ...(text ? [{ conversationId: chatId, author: 'bot', authorId: bot?.id ?? null, authorName: bot?.name ?? null, body: text.slice(0, maxChatMessage), createdAt: now }] : []),
        { conversationId: chatId, author: 'system', body: 'A person will reply here as soon as they can.', createdAt: new Date(now.getTime() + 1) },
      ],
    });
    await this.alertStaff({ ...chat, status: 'waiting' }, reason);
    return 'handed_over';
  }

  /** The assistant turns the chat into a ticket (its `create_ticket` tool). Returns the ticket's reference. */
  async ticketByAssistant(chatId: string, input: { subject: string; category: TicketCategory }) {
    const chat = await this.load({ id: chatId });
    if (!chat) throw notFound();
    const reference = await this.toTicket(chat, input, 'bot');
    return reference;
  }

  /** Staff write: a person is answering now, and the chat is theirs unless someone else has it. */
  private async staffWrote(chat: SupportConversation, author: ChatAuthor, body: string) {
    if (chat.status === 'closed') throw conflict('chat_closed', 'This chat has ended.');
    const text = body.trim().slice(0, maxChatMessage);
    if (!text) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write a message.', 'body');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chat.id, author: author.kind, authorId: author.id, authorName: author.name, body: text, createdAt: now } }),
      this.prisma.supportConversation.update({ where: { id: chat.id }, data: { lastMessageAt: now, status: 'with_staff', assigneeId: chat.assigneeId ?? author.id } }),
    ]);
    await this.tellRequester(chat);
  }

  private async take(chat: SupportConversation, author: ChatAuthor) {
    if (chat.status === 'closed') throw conflict('chat_closed', 'This chat has ended.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chat.id, author: 'system', body: `${author.name ?? 'A person'} joined the chat.`, createdAt: now } }),
      this.prisma.supportConversation.update({ where: { id: chat.id }, data: { status: 'with_staff', assigneeId: author.id, lastMessageAt: now } }),
    ]);
  }

  private async close(chat: SupportConversation, author: ChatAuthor, note: string) {
    if (chat.status === 'closed') return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chat.id, author: author.kind, authorId: author.id, authorName: author.name, body: note, createdAt: now } }),
      this.prisma.supportConversation.updateMany({ where: { id: chat.id, status: { not: 'closed' } }, data: { status: 'closed', closedAt: now, lastMessageAt: now } }),
    ]);
  }

  private async toTicket(chat: ChatWithMessages, input: { subject: string; category: TicketCategory }, source: 'chat' | 'bot') {
    if (chat.ticketId) throw conflict('chat_has_ticket', 'This chat is already a ticket.');
    const roles: Record<string, string> = { customer: 'Customer', reseller: chat.requester === 'reseller' ? 'Reseller' : 'Store', bitocard: 'BitoCard', bot: 'Assistant', system: 'Update' };
    const transcript = [
      'From a live chat:',
      ...chat.messages.map(message => `${roles[message.author] ?? message.author} (${message.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC): ${message.body}`),
    ].join('\n').slice(0, 5000);
    const ticket = await this.tickets.fromChat(chat, { subject: input.subject, category: input.category, transcript, source });
    await this.prisma.supportConversation.update({ where: { id: chat.id }, data: { ticketId: ticket.id } });
    await this.close(chat, system, `This chat is now ticket ${ticketReference(ticket.number)}: we reply there, and tell you when we do.`);
    return ticketReference(ticket.number);
  }

  private async since(chat: SupportConversation, after: string | undefined, audience: Audience) {
    const from = after ? await this.prisma.supportChatMessage.findFirst({ where: { id: after, conversationId: chat.id }, select: { createdAt: true } }) : null;
    const messages = await this.prisma.supportChatMessage.findMany({
      where: { conversationId: chat.id, ...(from ? { createdAt: { gt: from.createdAt } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: messagesShown,
    });
    return { object: 'list' as const, status: chat.status as ChatStatus, data: messages.map(message => presentMessage(message, audience)) };
  }

  private async page(where: Prisma.SupportConversationWhereInput, page: { limit?: number; starting_after?: string }, audience: Exclude<Audience, 'customer'>) {
    const limit = page.limit ?? 50;
    const rows = await this.prisma.supportConversation.findMany({ where, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}) });
    const data = await Promise.all(rows.slice(0, limit).map(async row => presentChat({ ...row, messages: [] }, audience, await this.extras(row))));
    const summaries = data.map(chat => {
      const summary: Partial<typeof chat> = { ...chat };
      delete summary.messages;
      return summary;
    });
    return { object: 'list' as const, data: summaries, has_more: rows.length > limit };
  }

  /** Staff are told a chat is waiting, at most every 10 minutes per chat (claimed, so parallel messages tell once). */
  private async alertStaff(chat: SupportConversation, reason?: string) {
    const now = new Date();
    const claimed = await this.prisma.supportConversation.updateMany({ where: { id: chat.id, OR: [{ alertedAt: null }, { alertedAt: { lt: new Date(now.getTime() - alertEveryMs) } }] }, data: { alertedAt: now } });
    if (!claimed.count) return;
    const content = { subject: `${chat.id}:${now.getTime()}`, title: chat.requester === 'reseller' ? 'A reseller is waiting in chat' : 'A customer is waiting in chat', body: reason ? `The assistant handed over: ${reason}` : 'Open the chat to answer.', mode: chat.mode };
    if (chat.queue === 'bitocard') await this.inbox.admins('admin.support.chat_waiting', { ...content, link: `/support/chats/${chat.id}` });
    else await this.inbox.reseller(chat.resellerId, 'support.chat_waiting', { ...content, link: `/support/chats/${chat.id}` });
  }

  /** The requester is told staff replied (pushed, at most every 10 minutes per chat), in case they left the chat. */
  private async tellRequester(chat: SupportConversation) {
    const bucket = Math.floor(Date.now() / alertEveryMs);
    if (chat.customerId && chat.storeId) {
      await this.inbox.customer({ customerId: chat.customerId, storeId: chat.storeId }, 'customer.support.chat_replied', { subject: `${chat.id}:${bucket}`, title: 'The store replied in chat', body: 'Open the chat to read it.', link: '/account/support?chat=1' });
    } else if (chat.requester === 'reseller') {
      await this.inbox.reseller(chat.resellerId, 'support.chat_replied', { subject: `${chat.id}:${bucket}`, title: 'BitoCard replied in chat', body: 'Open the chat to read it.', link: '/support/bitocard', mode: chat.mode });
    }
  }
}
