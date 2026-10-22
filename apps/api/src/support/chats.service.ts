import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { houseRootId, HouseService } from '../checkout/house.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma, Store, SupportBot, SupportChatAttachment, SupportChatMessage, SupportConversation, SupportVisitor } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { type CheckedFile, checkDocument } from '../kyc/files.js';
import { KycStorage } from '../kyc/storage.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { chatReplyEmail } from '../notifications/templates.js';
import { type RequesterProfile, requesterProfile } from './people.js';
import { type TicketCategory, ticketReference, TicketsService } from './tickets.service.js';

export const chatStatuses = ['bot', 'waiting', 'with_staff', 'closed'] as const;
export type ChatStatus = (typeof chatStatuses)[number];
type Audience = 'customer' | 'reseller' | 'admin';
type MessageWithFiles = SupportChatMessage & { attachments?: SupportChatAttachment[] };
type ChatWithMessages = SupportConversation & { messages: MessageWithFiles[] };
export type ChatAuthor = { kind: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; id: string | null; name: string | null };
/** A file as it arrives (multipart). */
export type ChatUpload = { buffer: Buffer; mimetype: string; size: number; originalname?: string };
type CheckedUpload = { file: ChatUpload; checked: CheckedFile };
/** Who asks on a store: a signed-in customer, or a visitor who gave their name and email. */
export type StoreRequester = { kind: 'customer'; customer: CustomerWithStore } | { kind: 'visitor'; visitor: SupportVisitor; store: Store & { reseller: { house: boolean } } };

/** The longest chat message. */
export const maxChatMessage = 2000;
/** A requester's messages per minute in one chat, so a chat cannot be flooded. */
export const chatMessagesPerMinute = 12;
/** Files one chat can hold. */
export const maxChatFiles = 20;
/** The header a store's server sends a visitor's chat token in (it keeps it in its own cookie). */
export const visitorHeader = 'bitocard-chat-visitor';
/** Staff are told a chat is waiting at most this often per chat (and a visitor emailed that staff replied). */
const alertEveryMs = 10 * 60 * 1000;
/** Messages returned with a chat: the latest ones. */
const messagesShown = 200;
const visitorTokenPattern = /^bcv_[A-Za-z0-9_-]{43}$/;
const withFiles = { attachments: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.SupportChatMessageInclude;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such chat.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const system: ChatAuthor = { kind: 'system', id: null, name: null };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A file's name as shown: its last path part, printable, at most 120 characters. */
export function chatFileName(raw: string | undefined) {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const clean = base.replace(/[\u0000-\u001f\u007f"<>]/g, '').trim().slice(-120);
  return clean || 'file';
}

function presentAttachment(file: SupportChatAttachment) {
  return { id: file.id, name: file.name, content_type: file.contentType, size: file.size, width: file.width, height: file.height };
}

function presentMessage(message: MessageWithFiles) {
  return {
    id: message.id,
    author: message.author,
    // Everyone sees who answered: the person's name, or the assistant's (with its picture).
    author_name: message.authorName,
    author_avatar_url: message.author === 'bot' ? message.authorAvatarUrl : null,
    body: message.body,
    attachments: (message.attachments ?? []).map(presentAttachment),
    created_at: message.createdAt.toISOString(),
  };
}

type Extras = { requester_name?: string | null; ticket_reference?: string | null; visitor?: { name: string; email: string } | null; profile?: RequesterProfile | null };

/** A chat as each side sees it. The requester sees whether someone is answering; staff see everything. */
export function presentChat(chat: ChatWithMessages, audience: Audience, extra: Extras = {}) {
  const messages = chat.messages.map(presentMessage);
  if (audience === 'customer') {
    return { object: 'support_chat' as const, id: chat.id, status: chat.status as ChatStatus, ticket_reference: extra.ticket_reference ?? null, created_at: chat.createdAt.toISOString(), closed_at: chat.closedAt?.toISOString() ?? null, messages };
  }
  return {
    object: 'support_chat' as const,
    id: chat.id,
    mode: chat.mode,
    requester: chat.requester as 'customer' | 'reseller',
    requester_name: extra.requester_name ?? null,
    /** A signed-out visitor's name and email (as they gave them, not confirmed); null for customers and resellers. */
    visitor: extra.visitor ?? null,
    /** Who they are, from their account (a visitor: as they typed it): name, email, confirmed mobile, country and currency. */
    requester_profile: extra.profile ?? null,
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
 * Live chat. A store customer, or a signed-out visitor who gave their name and email, chats with the store (BitoCard at
 * bitocard.com); a reseller's team chats with BitoCard. One open chat per customer, visitor, and reseller account and
 * mode at a time. The requester's message makes it wait for a person (staff are told, at most every 10 minutes); staff
 * answer, take it over, close it, or turn it into a ticket. Either side can send a photo or a PDF: checked from its
 * bytes, stripped of metadata, sealed in the private bucket and only read back through the API. Clients poll for new
 * messages (`after`): there is no socket on Vercel Functions.
 */
@Injectable()
export class ChatsService {
  private readonly logger = new Logger('Chats');
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
    private readonly storage: KycStorage,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  private load(where: Prisma.SupportConversationWhereInput) {
    return this.prisma.supportConversation
      .findFirst({ where, include: { messages: { orderBy: { createdAt: 'desc' }, take: messagesShown, include: withFiles } } })
      .then(chat => (chat ? { ...chat, messages: chat.messages.reverse() } : null));
  }

  private async extras(chat: SupportConversation): Promise<Extras> {
    const [customer, user, ticket, visitor, profile] = await Promise.all([
      chat.customerId ? this.prisma.customer.findUnique({ where: { id: chat.customerId }, select: { name: true } }) : null,
      chat.userId ? this.prisma.user.findUnique({ where: { id: chat.userId }, select: { name: true } }) : null,
      chat.ticketId ? this.prisma.supportTicket.findUnique({ where: { id: chat.ticketId }, select: { number: true } }) : null,
      chat.visitorId ? this.prisma.supportVisitor.findUnique({ where: { id: chat.visitorId }, select: { name: true, email: true } }) : null,
      requesterProfile(this.prisma, chat),
    ]);
    return { requester_name: customer?.name ?? user?.name ?? visitor?.name ?? null, ticket_reference: ticket ? ticketReference(ticket.number) : null, visitor, profile };
  }

  private async present(chat: ChatWithMessages, audience: Audience) {
    return presentChat(chat, audience, await this.extras(chat));
  }

  // -- Store requesters (customers and visitors) -------------------------------------------------------------------

  private static whereFor(requester: StoreRequester) {
    return requester.kind === 'customer' ? { customerId: requester.customer.id } : { visitorId: requester.visitor.id };
  }

  private static storeOf(requester: StoreRequester) {
    return requester.kind === 'customer' ? requester.customer.store : requester.store;
  }

  private static authorOf(requester: StoreRequester): ChatAuthor {
    return requester.kind === 'customer' ? { kind: 'customer', id: requester.customer.id, name: requester.customer.name } : { kind: 'customer', id: null, name: requester.visitor.name };
  }

  private async ownChat(requester: StoreRequester, id: string) {
    const chat = await this.prisma.supportConversation.findFirst({ where: { id, ...ChatsService.whereFor(requester) } });
    if (!chat) throw notFound();
    return chat;
  }

  /** The requester's open chat, or null. */
  async currentFor(requester: StoreRequester) {
    const chat = await this.load({ ...ChatsService.whereFor(requester), status: { not: 'closed' } });
    return chat ? this.present(chat, 'customer') : null;
  }

  /** The store's chat assistant as customers see it (name, face, greeting), or null when none is answering chats. */
  async assistantProfile(store: Pick<Store, 'id'>) {
    const bot = await this.assistantResolver?.({ storeId: store.id, requester: 'customer' });
    return bot ? { name: bot.name, avatar_url: bot.avatarUrl, greeting: bot.greeting } : null;
  }

  /** The requester asks for a person: the assistant stops and staff are told. */
  async askForPersonAs(requester: StoreRequester, id: string) {
    const chat = await this.ownChat(requester, id);
    if (chat.status === 'bot') await this.handOver(chat.id, `The ${requester.kind} asked for a person.`);
    return this.present((await this.load({ id }))!, 'customer');
  }

  /** The requester's open chat, or a new one with the store (BitoCard at bitocard.com). */
  private async storeChat(requester: StoreRequester) {
    const store = ChatsService.storeOf(requester);
    const house = store.reseller.house;
    const country = requester.kind === 'customer' ? requester.customer.country : null;
    return this.openOrCreate({ ...ChatsService.whereFor(requester), status: { not: 'closed' } }, async () => ({
      resellerId: house ? (country ? (await this.house.resellerFor(country)).id : houseRootId) : store.resellerId,
      mode: this.sellers.mode(store),
      requester: 'customer',
      queue: house ? 'bitocard' : 'reseller',
      storeId: store.id,
      ...ChatsService.whereFor(requester),
    }));
  }

  /** The requester writes: to their open chat, or starting one. */
  async sendAs(requester: StoreRequester, body: string) {
    const open = await this.storeChat(requester);
    await this.requesterWrote(open, ChatsService.authorOf(requester), body);
    return this.present((await this.load({ id: open.id }))!, 'customer');
  }

  /** The requester sends a file (with an optional caption): to their open chat, or starting one. */
  async attachAs(requester: StoreRequester, file: ChatUpload | undefined, caption: string | undefined) {
    const checked = this.checkFile(file);
    const open = await this.storeChat(requester);
    await this.requesterWrote(open, ChatsService.authorOf(requester), caption ?? '', { file: file!, checked });
    return this.present((await this.load({ id: open.id }))!, 'customer');
  }

  /** New messages since `after` (a message ID), for polling. */
  async messagesFor(requester: StoreRequester, id: string, after?: string) {
    return this.since(await this.ownChat(requester, id), after);
  }

  async closeAs(requester: StoreRequester, id: string) {
    const chat = await this.ownChat(requester, id);
    await this.close(chat, system, requester.kind === 'customer' ? 'The customer ended the chat.' : 'The visitor ended the chat.');
    return this.present((await this.load({ id }))!, 'customer');
  }

  async fileFor(requester: StoreRequester, id: string, file: string) {
    return this.readFile((await this.ownChat(requester, id)).id, file);
  }

  // Signed-in customers (the requester helpers above, by customer).
  currentForCustomer = (customer: CustomerWithStore) => this.currentFor({ kind: 'customer', customer });
  sendAsCustomer = (customer: CustomerWithStore, body: string) => this.sendAs({ kind: 'customer', customer }, body);
  messagesForCustomer = (customer: CustomerWithStore, id: string, after?: string) => this.messagesFor({ kind: 'customer', customer }, id, after);
  closeAsCustomer = (customer: CustomerWithStore, id: string) => this.closeAs({ kind: 'customer', customer }, id);
  askForPerson = (customer: CustomerWithStore, id: string) => this.askForPersonAs({ kind: 'customer', customer }, id);

  // -- Visitors ----------------------------------------------------------------------------------------------------

  /** The visitor a store's server names by token, at that store; null when the token is unknown or another store's. */
  async visitor(token: string | undefined, storeKey: string | null): Promise<StoreRequester | null> {
    if (!token || !visitorTokenPattern.test(token)) return null;
    const store = await this.sellers.resolve(storeKey);
    const visitor = await this.prisma.supportVisitor.findUnique({ where: { tokenHash: sha256(token) } });
    if (!visitor || visitor.storeId !== store.id) return null;
    return { kind: 'visitor', visitor, store };
  }

  /**
   * A signed-out visitor starts chatting: their name, email and first message. A browser that already chatted here
   * (its token) keeps its identity, with the name and email updated; otherwise a new token is made and returned once
   * (the store's server keeps it in its own cookie). Their email is not confirmed: staff are shown it as given.
   */
  async startAsVisitor(storeKey: string | null, input: { token?: string; name: string; email: string; body: string }) {
    const name = input.name.trim().slice(0, 80);
    const email = input.email.trim().toLowerCase();
    if (!name) throw invalid('parameter_missing', 'Tell us your name.', 'name');
    if (!input.body.trim()) throw invalid('parameter_missing', 'Write a message.', 'body');
    const known = await this.visitor(input.token, storeKey);
    let token: string | null = null;
    let visitor: SupportVisitor;
    let store: Store & { reseller: { house: boolean } };
    if (known?.kind === 'visitor') {
      visitor = await this.prisma.supportVisitor.update({ where: { id: known.visitor.id }, data: { name, email, lastSeenAt: new Date() } });
      store = known.store;
    } else {
      store = await this.sellers.resolve(storeKey);
      token = `bcv_${randomBytes(32).toString('base64url')}`;
      visitor = await this.prisma.supportVisitor.create({ data: { storeId: store.id, name, email, tokenHash: sha256(token) } });
    }
    const chat = await this.sendAs({ kind: 'visitor', visitor, store }, input.body);
    return { object: 'support_visitor_chat' as const, token, visitor: { name: visitor.name, email: visitor.email }, chat };
  }

  // -- Resellers chatting with BitoCard ----------------------------------------------------------------------------

  async currentForReseller(resellerId: string, mode: LedgerMode) {
    const chat = await this.load({ resellerId, mode, requester: 'reseller', status: { not: 'closed' } });
    return chat ? this.present(chat, 'reseller') : null;
  }

  private resellerChat(resellerId: string, mode: LedgerMode, author: ChatAuthor) {
    return this.openOrCreate({ resellerId, mode, requester: 'reseller', status: { not: 'closed' } }, async () => ({ resellerId, mode, requester: 'reseller', queue: 'bitocard', userId: author.id }));
  }

  async sendAsReseller(resellerId: string, mode: LedgerMode, author: ChatAuthor, body: string) {
    const open = await this.resellerChat(resellerId, mode, author);
    await this.requesterWrote(open, author, body);
    return this.present((await this.load({ id: open.id }))!, 'reseller');
  }

  async attachAsReseller(resellerId: string, mode: LedgerMode, author: ChatAuthor, file: ChatUpload | undefined, caption: string | undefined) {
    const checked = this.checkFile(file);
    const open = await this.resellerChat(resellerId, mode, author);
    await this.requesterWrote(open, author, caption ?? '', { file: file!, checked });
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
    return this.since(await this.owned(resellerId, mode, id), after);
  }

  async messagesForAdmin(id: string, after?: string) {
    return this.since(await this.adminOwned(id), after);
  }

  async fileForReseller(resellerId: string, mode: LedgerMode, id: string, file: string) {
    return this.readFile((await this.owned(resellerId, mode, id)).id, file);
  }

  async fileForAdmin(id: string, file: string) {
    return this.readFile((await this.adminOwned(id)).id, file);
  }

  private storeAnswers(chat: SupportConversation) {
    if (chat.requester !== 'customer' || chat.queue !== 'reseller') throw conflict('chat_not_yours', 'BitoCard answers this chat.');
  }

  /** The store answers its customer: a person is answering now (and it is theirs unless someone else has it). */
  async replyAsReseller(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor, body: string) {
    const chat = await this.owned(resellerId, mode, id);
    this.storeAnswers(chat);
    await this.staffWrote(chat, author, body);
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async attachAsStore(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor, file: ChatUpload | undefined, caption: string | undefined) {
    const checked = this.checkFile(file);
    const chat = await this.owned(resellerId, mode, id);
    this.storeAnswers(chat);
    await this.staffWrote(chat, author, caption ?? '', { file: file!, checked });
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async replyAsAdmin(id: string, author: ChatAuthor, body: string) {
    const chat = await this.adminOwned(id);
    await this.staffWrote(chat, author, body);
    return this.present((await this.load({ id }))!, 'admin');
  }

  async attachAsAdmin(id: string, author: ChatAuthor, file: ChatUpload | undefined, caption: string | undefined) {
    const checked = this.checkFile(file);
    const chat = await this.adminOwned(id);
    await this.staffWrote(chat, author, caption ?? '', { file: file!, checked });
    return this.present((await this.load({ id }))!, 'admin');
  }

  /** A team member takes the chat over (from an assistant, or from a colleague). */
  async takeAsReseller(resellerId: string, mode: LedgerMode, id: string, author: ChatAuthor) {
    const chat = await this.owned(resellerId, mode, id);
    this.storeAnswers(chat);
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
    this.storeAnswers(chat);
    await this.toTicket(chat, input, 'chat');
    return this.present((await this.load({ id }))!, 'reseller');
  }

  async ticketAsAdmin(id: string, input: { subject: string; category: TicketCategory }) {
    const chat = await this.adminOwned(id);
    await this.toTicket(chat, input, 'chat');
    return this.present((await this.load({ id }))!, 'admin');
  }

  /**
   * Retention (the daily `support` job): chats that ended more than 12 months ago are deleted with their messages and
   * files (a chat whose files cannot be removed yet waits for the next run), and visitors with no chat left who have not
   * been back for 12 months.
   */
  async purgeOld(now = new Date()) {
    const before = new Date(now.getTime() - 365 * 24 * 3600_000);
    const old = await this.prisma.supportConversation.findMany({ where: { status: 'closed', closedAt: { lt: before } }, select: { id: true, attachments: { select: { objectKey: true } } }, take: 500 });
    const removable: string[] = [];
    for (const chat of old) {
      try {
        for (const file of chat.attachments) await this.storage.remove(file.objectKey);
        removable.push(chat.id);
      } catch (error) {
        this.logger.warn({ chat: chat.id, error: (error as Error).message }, 'Chat files could not be removed; kept for the next run');
      }
    }
    const count = removable.length ? (await this.prisma.supportConversation.deleteMany({ where: { id: { in: removable } } })).count : 0;
    await this.prisma.supportVisitor.deleteMany({ where: { lastSeenAt: { lt: before }, conversations: { none: {} } } });
    return count;
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

  /** A file people may send: a photo (JPEG or PNG, its metadata removed) or a PDF without scripts, at most 4 MB. */
  private checkFile(file: ChatUpload | undefined) {
    if (!file) throw invalid('parameter_missing', 'Choose a file to send.', 'file');
    if (!this.storage.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Files cannot be sent in chat yet. Write a message instead.');
    const checked = checkDocument(file.buffer, file.mimetype, true);
    if ('problem' in checked) throw invalid('file_invalid', checked.problem.replace('Upload a JPEG, PNG or PDF file.', 'Send a photo (JPEG or PNG) or a PDF.'), 'file');
    return checked;
  }

  /** Stores a checked file under the chat and records it with its message (in the caller's transaction). */
  private async storeFile(chat: SupportConversation, upload: CheckedUpload) {
    if ((await this.prisma.supportChatAttachment.count({ where: { conversationId: chat.id } })) >= maxChatFiles) throw conflict('too_many_files', `A chat can hold ${maxChatFiles} files. Start a new chat to send more.`);
    const id = randomUUID();
    const objectKey = this.storage.chatKey(chat.id, id);
    await this.storage.put(objectKey, upload.checked.bytes);
    return (messageId: string): Prisma.SupportChatAttachmentUncheckedCreateInput => ({
      id,
      conversationId: chat.id,
      messageId,
      objectKey,
      name: chatFileName(upload.file.originalname),
      contentType: upload.checked.contentType,
      size: upload.checked.bytes.length,
      width: upload.checked.width,
      height: upload.checked.height,
    });
  }

  private async readFile(chatId: string, fileId: string) {
    const file = await this.prisma.supportChatAttachment.findFirst({ where: { id: fileId, conversationId: chatId } });
    if (!file) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such file.');
    const bytes = await this.storage.get(file.objectKey);
    if (!bytes) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'file_gone', 'This file is no longer kept.');
    return { contentType: file.contentType, bytes, name: file.name };
  }

  /** Writes a message (and its file) in one transaction with the chat's update. */
  private async writeMessage(chat: SupportConversation, author: ChatAuthor, text: string, attach: ((messageId: string) => Prisma.SupportChatAttachmentUncheckedCreateInput) | null, update: Prisma.SupportConversationUncheckedUpdateInput, now: Date) {
    const messageId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { id: messageId, conversationId: chat.id, author: author.kind, authorId: author.id, authorName: author.name, body: text, createdAt: now } }),
      ...(attach ? [this.prisma.supportChatAttachment.create({ data: attach(messageId) })] : []),
      this.prisma.supportConversation.update({ where: { id: chat.id }, data: update }),
    ]);
  }

  /** The requester writes: it waits for a person unless one is answering, and staff are told (at most every 10 minutes). */
  private async requesterWrote(chat: SupportConversation, author: ChatAuthor, body: string, upload?: CheckedUpload) {
    const text = body.trim().slice(0, maxChatMessage);
    if (!text && !upload) throw invalid('parameter_missing', 'Write a message.', 'body');
    const recent = await this.prisma.supportChatMessage.count({ where: { conversationId: chat.id, author: author.kind, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= chatMessagesPerMinute) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'chat_rate_limited', 'You are sending messages very fast. Wait a moment, then send again.');
    const attach = upload ? await this.storeFile(chat, upload) : null;
    const now = new Date();
    await this.writeMessage(chat, author, text, attach, { lastMessageAt: now, lastAskedAt: now, ...(chat.status === 'closed' ? { status: 'waiting', closedAt: null } : {}) }, now);
    if (chat.visitorId) await this.prisma.supportVisitor.update({ where: { id: chat.visitorId }, data: { lastSeenAt: now } });
    if (chat.status === 'bot') this.requesterListener?.(chat);
    else if (chat.status !== 'with_staff') await this.alertStaff(chat);
  }

  /** The assistant's answer in a chat it still has. */
  async botWrote(chatId: string, bot: SupportBot, body: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({ data: { conversationId: chatId, author: 'bot', authorId: bot.id, authorName: bot.name, authorAvatarUrl: bot.avatarUrl, body: body.slice(0, maxChatMessage), createdAt: now } }),
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
    const bot = chat.botId ? await this.prisma.supportBot.findUnique({ where: { id: chat.botId }, select: { id: true, name: true, avatarUrl: true } }) : null;
    await this.prisma.supportChatMessage.createMany({
      data: [
        ...(text ? [{ conversationId: chatId, author: 'bot', authorId: bot?.id ?? null, authorName: bot?.name ?? null, authorAvatarUrl: bot?.avatarUrl ?? null, body: text.slice(0, maxChatMessage), createdAt: now }] : []),
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
  private async staffWrote(chat: SupportConversation, author: ChatAuthor, body: string, upload?: CheckedUpload) {
    if (chat.status === 'closed') throw conflict('chat_closed', 'This chat has ended.');
    const text = body.trim().slice(0, maxChatMessage);
    if (!text && !upload) throw invalid('parameter_missing', 'Write a message.', 'body');
    const attach = upload ? await this.storeFile(chat, upload) : null;
    const now = new Date();
    await this.writeMessage(chat, author, text, attach, { lastMessageAt: now, status: 'with_staff', assigneeId: chat.assigneeId ?? author.id }, now);
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
    if (chat.visitorId) throw conflict('visitor_chat', 'A visitor has no account to follow a ticket: answer them here, or by email.');
    const roles: Record<string, string> = { customer: 'Customer', reseller: chat.requester === 'reseller' ? 'Reseller' : 'Store', bitocard: 'BitoCard', bot: 'Assistant', system: 'Update' };
    const transcript = [
      'From a live chat:',
      ...chat.messages.map(message => {
        const files = (message.attachments ?? []).map(file => ` [file: ${file.name}]`).join('');
        return `${roles[message.author] ?? message.author} (${message.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC): ${message.body}${files}`;
      }),
    ].join('\n').slice(0, 5000);
    const ticket = await this.tickets.fromChat(chat, { subject: input.subject, category: input.category, transcript, source });
    await this.prisma.supportConversation.update({ where: { id: chat.id }, data: { ticketId: ticket.id } });
    await this.close(chat, system, `This chat is now ticket ${ticketReference(ticket.number)}: we reply there, and tell you when we do.`);
    return ticketReference(ticket.number);
  }

  private async since(chat: SupportConversation, after: string | undefined) {
    const from = after ? await this.prisma.supportChatMessage.findFirst({ where: { id: after, conversationId: chat.id }, select: { createdAt: true } }) : null;
    const messages = await this.prisma.supportChatMessage.findMany({
      where: { conversationId: chat.id, ...(from ? { createdAt: { gt: from.createdAt } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: messagesShown,
      include: withFiles,
    });
    return { object: 'list' as const, status: chat.status as ChatStatus, data: messages.map(presentMessage) };
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
    const who = chat.requester === 'reseller' ? 'A reseller' : chat.visitorId ? 'A visitor' : 'A customer';
    const content = { subject: `${chat.id}:${now.getTime()}`, title: `${who} is waiting in chat`, body: reason ? `The assistant handed over: ${reason}` : 'Open the chat to answer.', mode: chat.mode };
    if (chat.queue === 'bitocard') await this.inbox.admins('admin.support.chat_waiting', { ...content, link: `/support/chats/${chat.id}` });
    else await this.inbox.reseller(chat.resellerId, 'support.chat_waiting', { ...content, link: `/support/chats/${chat.id}` });
  }

  /** The store's own address, where its chat opens (`?chat=1`). */
  private async storeLink(storeId: string) {
    const base = new URL(this.integrations.config.STOREFRONT_URL);
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { subdomain: true, name: true, resellerId: true } });
    const host = store && store.subdomain !== 'bitocard' ? `${store.subdomain}.${base.host}` : base.host;
    return { url: `${base.protocol}//${host}/?chat=1`, name: store && store.subdomain !== 'bitocard' ? store.name : 'BitoCard', resellerId: store?.resellerId ?? null };
  }

  /** The requester is told staff replied (pushed, or a visitor emailed; at most every 10 minutes per chat), in case they left. */
  private async tellRequester(chat: SupportConversation) {
    const bucket = Math.floor(Date.now() / alertEveryMs);
    if (chat.customerId && chat.storeId) {
      await this.inbox.customer({ customerId: chat.customerId, storeId: chat.storeId }, 'customer.support.chat_replied', { subject: `${chat.id}:${bucket}`, title: 'The store replied in chat', body: 'Open the chat to read it.', link: '/account/support?chat=1' });
    } else if (chat.visitorId && chat.storeId) {
      const now = new Date();
      const claimed = await this.prisma.supportConversation.updateMany({ where: { id: chat.id, OR: [{ requesterAlertedAt: null }, { requesterAlertedAt: { lt: new Date(now.getTime() - alertEveryMs) } }] }, data: { requesterAlertedAt: now } });
      if (!claimed.count) return;
      const visitor = await this.prisma.supportVisitor.findUnique({ where: { id: chat.visitorId } });
      if (!visitor) return;
      const store = await this.storeLink(chat.storeId);
      try {
        await this.email.send(chatReplyEmail(visitor.email, { store: store.name, name: visitor.name, link: store.url }), store.resellerId && store.name !== 'BitoCard' ? { resellerId: store.resellerId, name: store.name } : undefined);
      } catch (error) {
        this.logger.warn({ chat: chat.id, error: (error as Error).message }, 'Visitor chat reply email failed');
      }
    } else if (chat.requester === 'reseller') {
      await this.inbox.reseller(chat.resellerId, 'support.chat_replied', { subject: `${chat.id}:${bucket}`, title: 'BitoCard replied in chat', body: 'Open the chat to read it.', link: '/support/bitocard', mode: chat.mode });
    }
  }
}
