import { inStoreOrAccount } from '../stores/store-scope.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseRootId, HouseService } from '../checkout/house.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma, SupportBot, SupportTicket, SupportTicketMessage } from '../generated/prisma/client.js';
import type { Tx } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { EventsService } from '../webhooks/events.service.js';
import type { EventType } from '../webhooks/events.js';

export const ticketCategories = ['order', 'payment', 'account', 'product', 'technical', 'other'] as const;
export const ticketStatuses = ['open', 'pending', 'resolved'] as const;
export const ticketQueues = ['reseller', 'bitocard'] as const;
export const ticketPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export const ticketVisibilities = ['all', 'staff'] as const;
export const ticketSources = ['form', 'api', 'chat', 'bot'] as const;

export type TicketCategory = (typeof ticketCategories)[number];
export type TicketStatus = (typeof ticketStatuses)[number];
export type TicketQueue = (typeof ticketQueues)[number];
export type TicketPriority = (typeof ticketPriorities)[number];
export type TicketVisibility = (typeof ticketVisibilities)[number];
export type TicketSource = (typeof ticketSources)[number];
type Audience = 'customer' | 'reseller' | 'admin';
type TicketWithMessages = SupportTicket & { messages: SupportTicketMessage[] };
type TicketEvent = Extract<EventType, `support_ticket.${string}`>;
export type TicketAuthor = { kind: 'customer' | 'reseller' | 'bitocard' | 'afrippa' | 'bot' | 'system'; id: string | null; name: string | null; avatar?: string | null };
/** Whose admins answer: BitoCard's (its queues) or Afrippa's (`afrippa`, its traders' tickets alone). */
export type TicketPlatform = 'bitocard' | 'afrippa';
/** Afrippa's traders' tickets: answered by Afrippa's admins only, never seen by BitoCard's or any reseller. */
export const afrippaQueue = 'afrippa';
/** Which tickets each product's admins reach. */
const adminScope = (platform: TicketPlatform): Prisma.SupportTicketWhereInput => (platform === 'afrippa' ? { queue: afrippaQueue } : { queue: { not: afrippaQueue } });

/** At most this many unresolved tickets per customer, so a store's queue cannot be flooded. */
export const maxOpenCustomerTickets = 10;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such ticket.');
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export const ticketReference = (number: number) => `T-${String(number).padStart(6, '0')}`;
const system: TicketAuthor = { kind: 'system', id: null, name: null };

/**
 * Who reads a message. The requester reads only what is meant for everyone. Staff notes on a customer's ticket are for
 * the store and BitoCard; on a reseller's own ticket they are BitoCard's alone.
 */
function visibleTo(ticket: SupportTicket, audience: Audience) {
  return (message: SupportTicketMessage) => {
    if (message.draft && audience === 'customer') return false;
    if (message.visibility === 'all') return true;
    if (audience === 'admin') return true;
    return audience === 'reseller' && ticket.requester === 'customer';
  };
}

function presentMessage(message: SupportTicketMessage, audience: Audience) {
  return {
    id: message.id,
    author: message.author,
    // Customers see who answered by role (and a bot by its name), never staff names.
    author_name: audience === 'customer' && message.author !== 'customer' && message.author !== 'bot' ? null : message.authorName,
    author_avatar_url: message.author === 'bot' ? message.authorAvatarUrl : null,
    visibility: message.visibility,
    body: message.body,
    ...(audience === 'customer' ? {} : { draft: message.draft }),
    created_at: message.createdAt.toISOString(),
  };
}

/** A ticket as each party sees it. Customers see its state and the messages meant for them, never staff notes. */
export function presentTicket(ticket: TicketWithMessages, audience: Audience) {
  const messages = ticket.messages.filter(visibleTo(ticket, audience)).map(message => presentMessage(message, audience));
  if (audience === 'customer') {
    return {
      object: 'support_ticket' as const,
      id: ticket.id,
      reference: ticketReference(ticket.number),
      status: ticket.status as TicketStatus,
      category: ticket.category as TicketCategory,
      subject: ticket.subject,
      checkout_id: ticket.checkoutId,
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
      resolved_at: ticket.resolvedAt?.toISOString() ?? null,
      messages,
    };
  }
  return {
    object: 'support_ticket' as const,
    id: ticket.id,
    reference: ticketReference(ticket.number),
    mode: ticket.mode,
    requester: ticket.requester as 'customer' | 'reseller',
    queue: ticket.queue as TicketQueue,
    status: ticket.status as TicketStatus,
    category: ticket.category as TicketCategory,
    priority: ticket.priority as TicketPriority,
    subject: ticket.subject,
    source: ticket.source as TicketSource,
    store_id: ticket.storeId,
    customer_id: ticket.customerId,
    customer_reference: ticket.customerReference,
    order_id: ticket.orderId,
    checkout_id: ticket.checkoutId,
    // An admin assignee is BitoCard's business: resellers see only their own team's.
    assignee_id: audience === 'reseller' && ticket.queue === 'bitocard' ? null : ticket.assigneeId,
    escalated_at: ticket.escalatedAt?.toISOString() ?? null,
    resolved_at: ticket.resolvedAt?.toISOString() ?? null,
    last_message_at: ticket.lastMessageAt.toISOString(),
    created_at: ticket.createdAt.toISOString(),
    updated_at: ticket.updatedAt.toISOString(),
    ...(audience === 'admin'
      ? { reseller_id: ticket.resellerId, github_issue: ticket.githubIssueNumber ? { number: ticket.githubIssueNumber, url: ticket.githubIssueUrl, state: ticket.githubIssueState } : null }
      : {}),
    messages,
  };
}

/** A ticket in a list and in its events: no messages. */
export function presentTicketSummary(ticket: SupportTicket, audience: Exclude<Audience, 'customer'>) {
  const presented: Partial<ReturnType<typeof presentTicket>> = presentTicket({ ...ticket, messages: [] }, audience);
  delete presented.messages;
  return presented;
}

export function presentCustomerTicketSummary(ticket: SupportTicket) {
  const presented: Partial<ReturnType<typeof presentTicket>> = presentTicket({ ...ticket, messages: [] }, 'customer');
  delete presented.messages;
  return presented;
}

type Page = { limit?: number; starting_after?: string };

/**
 * Support tickets. A store customer asks their store; the store answers, resolves, or passes the ticket to BitoCard. A
 * reseller's own questions go to BitoCard. At BitoCard's own store, BitoCard is the store. `status` says whose turn it
 * is: `open` (whoever answers), `pending` (the requester); a requester's reply reopens a resolved ticket.
 */
@Injectable()
export class TicketsService {
  /** Set by the assistants: told when a requester opens a ticket or writes on one. */
  private requesterListener: ((ticket: SupportTicket) => void) | null = null;

  onRequesterMessage(listener: (ticket: SupportTicket) => void) {
    this.requesterListener = listener;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sellers: StoreSellers,
    private readonly house: HouseService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private load(where: Prisma.SupportTicketWhereInput) {
    return this.prisma.supportTicket.findFirst({ where, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  }

  // -- Store customers ---------------------------------------------------------------------------------------------

  /** A customer asks their store (bitocard.com: BitoCard). Optionally about one of their orders. */
  async openForCustomer(customer: CustomerWithStore, input: { subject: string; category: TicketCategory; message: string; checkout_id?: string }, source: TicketSource = 'form', author?: TicketAuthor) {
    const checkout = input.checkout_id ? await this.prisma.checkout.findUnique({ where: { id: input.checkout_id } }) : null;
    if (input.checkout_id && (!checkout || checkout.customerId !== customer.id)) throw invalid('parameter_invalid', 'Choose one of your orders.', 'checkout_id');
    const open = await this.prisma.supportTicket.count({ where: { customerId: customer.id, status: { not: 'resolved' } } });
    if (open >= maxOpenCustomerTickets) throw conflict('too_many_tickets', `You have ${open} tickets still open. Reply on one of them, or wait for an answer, before opening another.`);
    const house = customer.store.reseller.house;
    // An Afrippa trader asks Afrippa: its own queue, under its operator's account.
    const afrippa = customer.store.platform === 'afrippa';
    const resellerId = checkout?.resellerId ?? (house ? (customer.country ? (await this.house.resellerFor(customer.country)).id : houseRootId) : customer.store.resellerId);
    const ticket = await this.create(
      {
        resellerId,
        mode: checkout?.mode ?? this.sellers.mode(customer.store),
        requester: 'customer',
        // At BitoCard's own store, BitoCard is the store; at Afrippa's, Afrippa.
        queue: afrippa ? afrippaQueue : house ? 'bitocard' : 'reseller',
        category: input.category,
        subject: input.subject,
        storeId: customer.storeId,
        customerId: customer.id,
        orderId: checkout?.orderId ?? null,
        checkoutId: checkout?.id ?? null,
        source,
      },
      author ?? { kind: 'customer', id: customer.id, name: customer.name },
      input.message,
    );
    if (afrippa) await this.tellAfrippa(ticket, 'admin.afrippa.ticket_created', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    else if (house) await this.tellAdmins(ticket, 'admin.support.ticket_created', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    else await this.tellReseller(ticket, 'support.ticket_created', 'A customer opened a support ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    this.requesterListener?.(ticket);
    return presentTicket(ticket, 'customer');
  }

  async listForCustomer(customer: CustomerWithStore, page: Page & { status?: TicketStatus }) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.supportTicket.findMany({
      where: { customerId: customer.id, status: page.status },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(presentCustomerTicketSummary), has_more: rows.length > limit };
  }

  async getForCustomer(customer: CustomerWithStore, id: string) {
    const ticket = await this.load({ id, customerId: customer.id });
    if (!ticket) throw notFound();
    return presentTicket(ticket, 'customer');
  }

  /** The customer replies: it is the store's (or BitoCard's) turn again, and a resolved ticket reopens. */
  async replyAsCustomer(customer: CustomerWithStore, id: string, body: string) {
    const ticket = await this.load({ id, customerId: customer.id });
    if (!ticket) throw notFound();
    await this.requesterReplied(ticket, { kind: 'customer', id: customer.id, name: customer.name }, body);
    return presentTicket((await this.load({ id }))!, 'customer');
  }

  /** The customer is satisfied: the ticket is resolved. */
  async closeAsCustomer(customer: CustomerWithStore, id: string) {
    const ticket = await this.load({ id, customerId: customer.id });
    if (!ticket) throw notFound();
    if (ticket.status !== 'resolved') {
      await this.transition(id, { status: { not: 'resolved' } }, { status: 'resolved', resolvedAt: new Date() }, ['support_ticket.updated'], { author: system, body: 'The customer closed this ticket.', visibility: 'all' });
    }
    return presentTicket((await this.load({ id }))!, 'customer');
  }

  // -- Resellers ---------------------------------------------------------------------------------------------------

  /**
   * The reseller opens a ticket: their own question to BitoCard (`requester: reseller`), or one for a customer on their
   * own systems to track (`requester: customer`, with their reference), which they answer and can pass to BitoCard.
   */
  async openForReseller(
    resellerId: string,
    mode: LedgerMode,
    author: TicketAuthor,
    input: { requester: 'reseller' | 'customer'; subject: string; category: TicketCategory; message: string; order_id?: string; customer_reference?: string },
    source: TicketSource,
  ) {
    const order = input.order_id ? await this.prisma.order.findFirst({ where: { id: input.order_id, resellerId, mode } }) : null;
    if (input.order_id && !order) throw invalid('parameter_invalid', 'No such order in this account and mode.', 'order_id');
    if (input.requester === 'reseller' && input.customer_reference) throw invalid('parameter_invalid', 'A customer reference is only for your customers’ tickets.', 'customer_reference');
    const checkout = order?.customerId ? await this.prisma.checkout.findFirst({ where: { orderId: order.id } }) : null;
    const own = input.requester === 'reseller';
    const ticket = await this.create(
      {
        resellerId,
        mode,
        requester: input.requester,
        queue: own ? 'bitocard' : 'reseller',
        category: input.category,
        subject: input.subject,
        userId: own ? author.id : null,
        customerReference: own ? null : (input.customer_reference ?? order?.customerReference ?? null),
        customerId: checkout?.customerId ?? null,
        storeId: checkout?.storeId ?? null,
        checkoutId: checkout?.id ?? null,
        orderId: order?.id ?? null,
        source,
      },
      author,
      input.message,
      'all',
    );
    if (own) {
      await this.tellAdmins(ticket, 'admin.support.ticket_created', `${ticketReference(ticket.number)}: ${ticket.subject}`);
      this.requesterListener?.(ticket);
    }
    return presentTicket(ticket, 'reseller');
  }

  async listForReseller(resellerId: string, mode: LedgerMode, filter: Page & { status?: TicketStatus; queue?: TicketQueue; requester?: 'customer' | 'reseller' }, storeId?: string) {
    return this.page({ resellerId, mode, status: filter.status, queue: filter.queue, requester: filter.requester, ...inStoreOrAccount(storeId) }, filter, 'reseller');
  }

  async getForReseller(resellerId: string, mode: LedgerMode, id: string) {
    return presentTicket(await this.owned(resellerId, mode, id), 'reseller');
  }

  private async owned(resellerId: string, mode: LedgerMode, id: string) {
    const ticket = await this.load({ id, resellerId, mode });
    if (!ticket) throw notFound();
    return ticket;
  }

  /**
   * The reseller writes. On their own ticket they are the requester (BitoCard's turn next). On a customer's ticket they
   * answer (`all`, the customer's turn next while the ticket is theirs) or add a note for their team and BitoCard
   * (`staff`).
   */
  async replyAsReseller(resellerId: string, mode: LedgerMode, id: string, author: TicketAuthor, input: { body: string; visibility?: TicketVisibility }) {
    const ticket = await this.owned(resellerId, mode, id);
    const visibility = input.visibility ?? 'all';
    if (ticket.requester === 'reseller') {
      if (visibility === 'staff') throw invalid('parameter_invalid', 'Staff notes are for your customers’ tickets.', 'visibility');
      await this.requesterReplied(ticket, author, input.body);
      return presentTicket((await this.load({ id }))!, 'reseller');
    }
    if (ticket.status === 'resolved') throw conflict('ticket_resolved', 'This ticket is resolved. It reopens when the customer replies.');
    await this.staffReplied(ticket, author, input.body, visibility, ticket.queue === 'reseller');
    if (visibility === 'all') await this.tellCustomer(ticket, 'customer.support.ticket_replied', 'The store replied to your ticket');
    if (ticket.queue === 'bitocard') await this.tellAdmins(ticket, 'admin.support.ticket_replied', `The store wrote on ${ticketReference(ticket.number)}`);
    return presentTicket((await this.load({ id }))!, 'reseller');
  }

  /** The reseller passes a customer's ticket to BitoCard, with a note for BitoCard on what they found. */
  async escalate(resellerId: string, mode: LedgerMode, id: string, author: TicketAuthor, input: { note: string }) {
    const ticket = await this.owned(resellerId, mode, id);
    if (ticket.requester !== 'customer' || ticket.queue !== 'reseller') throw conflict('ticket_not_yours', 'Only a customer’s ticket you are answering can be passed to BitoCard.');
    const claimed = await this.transition(
      id,
      { queue: 'reseller', status: { not: 'resolved' } },
      { queue: 'bitocard', status: 'open', escalatedAt: new Date(), assigneeId: null },
      ['support_ticket.updated'],
      { author, body: input.note, visibility: 'staff' },
    );
    if (!claimed) throw conflict('ticket_not_yours', 'Only an unresolved ticket you are answering can be passed to BitoCard.');
    const after = (await this.load({ id }))!;
    await this.tellAdmins(after, 'admin.support.ticket_created', `Passed by the store: ${ticketReference(after.number)}: ${after.subject}`);
    return presentTicket(after, 'reseller');
  }

  /** The reseller resolves a ticket they answer, or their own ticket to BitoCard once they have their answer. */
  async resolveAsReseller(resellerId: string, mode: LedgerMode, id: string, author: TicketAuthor, input: { note?: string }) {
    const ticket = await this.owned(resellerId, mode, id);
    if (ticket.requester === 'customer' && ticket.queue !== 'reseller') throw conflict('ticket_not_yours', 'BitoCard is answering this ticket: it resolves it.');
    const message = input.note?.trim() ? { author, body: input.note, visibility: 'all' as const } : undefined;
    const claimed = await this.transition(id, { status: { not: 'resolved' } }, { status: 'resolved', resolvedAt: new Date() }, ['support_ticket.updated'], message);
    if (!claimed) throw conflict('ticket_resolved', 'This ticket is already resolved.');
    const after = (await this.load({ id }))!;
    if (after.requester === 'customer') await this.tellCustomer(after, 'customer.support.ticket_resolved', 'Your support ticket is resolved');
    return presentTicket(after, 'reseller');
  }

  /** Priority and the team member it is assigned to (customers' tickets the reseller answers). */
  async updateAsReseller(resellerId: string, mode: LedgerMode, id: string, input: { priority?: TicketPriority; assignee_id?: string | null }) {
    const ticket = await this.owned(resellerId, mode, id);
    if (ticket.requester !== 'customer' || ticket.queue !== 'reseller') throw conflict('ticket_not_yours', 'Only customers’ tickets you are answering can be assigned or prioritised.');
    if (input.assignee_id) {
      const member = await this.prisma.resellerMember.findFirst({ where: { resellerId, userId: input.assignee_id } });
      if (!member) throw invalid('parameter_invalid', 'Assign it to a member of your team.', 'assignee_id');
    }
    await this.prisma.supportTicket.update({ where: { id }, data: { priority: input.priority, assigneeId: input.assignee_id } });
    return presentTicket((await this.load({ id }))!, 'reseller');
  }

  // -- BitoCard ----------------------------------------------------------------------------------------------------

  /** A product's admins' queue: BitoCard's (its `bitocard` queue by default, or the stores'), or Afrippa's own. */
  async listForAdmin(filter: Page & { status?: TicketStatus; queue?: TicketQueue; reseller_id?: string; requester?: 'customer' | 'reseller' }, platform: TicketPlatform = 'bitocard') {
    const queue = platform === 'afrippa' ? afrippaQueue : (filter.queue ?? 'bitocard');
    return this.page({ status: filter.status, queue, resellerId: platform === 'afrippa' ? undefined : filter.reseller_id, requester: filter.requester }, filter, 'admin', [{ lastMessageAt: 'asc' }, { id: 'asc' }]);
  }

  async getForAdmin(id: string, platform: TicketPlatform = 'bitocard') {
    const ticket = await this.load({ id, ...adminScope(platform) });
    if (!ticket) throw notFound();
    return presentTicket(ticket, 'admin');
  }

  /** BitoCard answers (`all`: the requester's turn next on its own queue) or adds a note only BitoCard and, on customers' tickets, the store see. */
  async replyAsAdmin(id: string, author: TicketAuthor, input: { body: string; visibility?: TicketVisibility }, platform: TicketPlatform = 'bitocard') {
    const ticket = await this.load({ id, ...adminScope(platform) });
    if (!ticket) throw notFound();
    if (ticket.status === 'resolved') throw conflict('ticket_resolved', 'This ticket is resolved. It reopens when the requester replies.');
    const visibility = input.visibility ?? 'all';
    const afrippa = ticket.queue === afrippaQueue;
    await this.staffReplied(ticket, author, input.body, visibility, ticket.queue === 'bitocard' || afrippa, !afrippa);
    if (visibility === 'all') {
      if (ticket.requester === 'customer') await this.tellCustomer(ticket, 'customer.support.ticket_replied', 'Your ticket has a reply');
      else await this.tellReseller(ticket, 'support.ticket_replied', 'BitoCard replied to your ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    }
    if (ticket.requester === 'customer' && !afrippa) await this.tellReseller(ticket, 'support.ticket_replied', 'BitoCard wrote on a customer’s ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    return presentTicket((await this.load({ id }))!, 'admin');
  }

  /** BitoCard sends a customer's ticket back to the store to answer, with a note on why. */
  async returnToReseller(actorId: string | null, id: string, author: TicketAuthor, note: string) {
    const before = await this.load({ id, ...adminScope('bitocard') });
    if (!before) throw notFound();
    const seller = await this.prisma.reseller.findUnique({ where: { id: before.resellerId }, select: { house: true } });
    if (before.requester !== 'customer' || before.queue !== 'bitocard' || seller?.house) throw conflict('ticket_not_returnable', 'Only a customer’s ticket a store passed to BitoCard can be sent back.');
    const claimed = await this.transition(id, { queue: 'bitocard' }, { queue: 'reseller', status: 'open', assigneeId: null }, ['support_ticket.updated'], { author, body: note, visibility: 'staff' });
    if (!claimed) throw conflict('ticket_not_returnable', 'This ticket is no longer with BitoCard.');
    const after = (await this.load({ id }))!;
    await this.audit.record({ actorId, action: 'support_ticket.returned', targetType: 'support_ticket', targetId: id, before: presentTicketSummary(before, 'admin'), after: presentTicketSummary(after, 'admin') });
    await this.tellReseller(after, 'support.ticket_updated', 'BitoCard sent a ticket back to you', `${ticketReference(after.number)}: ${note}`);
    return presentTicket(after, 'admin');
  }

  async resolveAsAdmin(actorId: string | null, id: string, author: TicketAuthor, input: { note?: string }, platform: TicketPlatform = 'bitocard') {
    const before = await this.load({ id, ...adminScope(platform) });
    if (!before) throw notFound();
    const message = input.note?.trim() ? { author, body: input.note, visibility: 'all' as const } : undefined;
    const claimed = await this.transition(id, { status: { not: 'resolved' } }, { status: 'resolved', resolvedAt: new Date() }, ['support_ticket.updated'], message);
    if (!claimed) throw conflict('ticket_resolved', 'This ticket is already resolved.');
    const after = (await this.load({ id }))!;
    await this.audit.record({ actorId, action: 'support_ticket.resolved', targetType: 'support_ticket', targetId: id, before: presentTicketSummary(before, 'admin'), after: presentTicketSummary(after, 'admin'), platform });
    if (after.requester === 'customer') await this.tellCustomer(after, 'customer.support.ticket_resolved', 'Your support ticket is resolved');
    if (platform === 'bitocard') await this.tellReseller(after, 'support.ticket_updated', `BitoCard resolved ${ticketReference(after.number)}`, after.subject);
    return presentTicket(after, 'admin');
  }

  /** Priority and the admin it is assigned to (tickets on BitoCard's queue). */
  async updateAsAdmin(id: string, input: { priority?: TicketPriority; assignee_id?: string | null }, platform: TicketPlatform = 'bitocard') {
    const ticket = await this.load({ id, ...adminScope(platform) });
    if (!ticket) throw notFound();
    if (input.assignee_id) {
      // Assigned to one of that product's own admins.
      const admin = await this.prisma.user.findFirst({ where: { id: input.assignee_id, realm: platform === 'afrippa' ? 'afrippa_admin' : 'admin' } });
      if (!admin) throw invalid('parameter_invalid', 'Assign it to an admin.', 'assignee_id');
      if (ticket.queue !== 'bitocard' && ticket.queue !== afrippaQueue) throw conflict('ticket_not_yours', 'Only tickets with BitoCard are assigned to admins.');
    }
    await this.prisma.supportTicket.update({ where: { id }, data: { priority: input.priority, assigneeId: input.assignee_id } });
    return presentTicket((await this.load({ id }))!, 'admin');
  }

  /**
   * A ticket made from a live chat by the staff answering it (or an assistant): the requester, store and queue are the
   * chat's, the transcript is its first message, and those answering are told as for any new ticket.
   */
  async fromChat(
    chat: { resellerId: string; mode: LedgerMode; requester: string; queue: string; storeId: string | null; customerId: string | null; userId: string | null },
    input: { subject: string; category: TicketCategory; transcript: string; source: TicketSource },
  ) {
    const ticket = await this.create(
      {
        resellerId: chat.resellerId,
        mode: chat.mode,
        requester: chat.requester,
        queue: chat.queue,
        category: input.category,
        subject: input.subject,
        storeId: chat.storeId,
        customerId: chat.customerId,
        userId: chat.userId,
        source: input.source,
      },
      system,
      input.transcript,
    );
    if (ticket.queue === afrippaQueue) await this.tellAfrippa(ticket, 'admin.afrippa.ticket_created', `From a chat: ${ticketReference(ticket.number)}: ${ticket.subject}`);
    else if (ticket.queue === 'bitocard') await this.tellAdmins(ticket, 'admin.support.ticket_created', `From a chat: ${ticketReference(ticket.number)}: ${ticket.subject}`);
    else await this.tellReseller(ticket, 'support.ticket_created', 'A chat became a support ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    return ticket;
  }

  /** Retention: tickets resolved more than two years ago are deleted with their messages (the daily `support` job). */
  async purgeOld(now = new Date()) {
    const before = new Date(now.getTime() - 2 * 365 * 24 * 3600_000);
    return (await this.prisma.supportTicket.deleteMany({ where: { status: 'resolved', resolvedAt: { lt: before } } })).count;
  }

  // -- Shared ------------------------------------------------------------------------------------------------------

  /** The requester writes: whoever answers has the next turn, and a resolved ticket reopens. */
  private async requesterReplied(ticket: SupportTicket, author: TicketAuthor, body: string) {
    const reopen = ticket.status !== 'open';
    const types: TicketEvent[] = [];
    if (ticket.requester === 'customer') types.push('support_ticket.message_received');
    if (reopen) types.push('support_ticket.updated');
    await this.transition(ticket.id, {}, reopen ? { status: 'open', resolvedAt: null } : {}, types, { author, body, visibility: 'all' });
    if (ticket.queue === afrippaQueue) await this.tellAfrippa(ticket, 'admin.afrippa.ticket_replied', `${ticketReference(ticket.number)} has a reply`);
    else if (ticket.queue === 'bitocard') await this.tellAdmins(ticket, 'admin.support.ticket_replied', `${ticketReference(ticket.number)} has a reply`);
    else await this.tellReseller(ticket, 'support.ticket_replied', 'A customer replied to a ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    this.requesterListener?.({ ...ticket, status: 'open' });
  }

  // -- Assistants --------------------------------------------------------------------------------------------------

  /** An assistant's automatic reply: the requester's turn next, and they are told, as for a person's answer. */
  async botReply(ticketId: string, bot: SupportBot, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status !== 'open') return;
    const done = await this.transition(ticketId, { status: 'open' }, { status: 'pending' }, ['support_ticket.updated'], { author: { kind: 'bot', id: bot.id, name: bot.name, avatar: bot.avatarUrl }, body, visibility: 'all' });
    if (!done) return;
    if (ticket.requester === 'customer') await this.tellCustomer(ticket, 'customer.support.ticket_replied', 'Your ticket has a reply');
    else await this.tellReseller(ticket, 'support.ticket_replied', 'BitoCard’s assistant replied to your ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
  }

  /** An assistant's suggested reply for staff to send, edit or discard. */
  async botDraft(ticketId: string, bot: SupportBot, body: string) {
    await this.prisma.supportTicketMessage.create({ data: { ticketId, author: 'bot', authorId: bot.id, authorName: bot.name, authorAvatarUrl: bot.avatarUrl, body: body.trim(), visibility: 'staff', draft: true } });
  }

  /** A note from an assistant for those answering (for example why it handed over). */
  async botNote(ticketId: string, bot: SupportBot, body: string) {
    await this.prisma.supportTicketMessage.create({ data: { ticketId, author: 'bot', authorId: bot.id, authorName: bot.name, authorAvatarUrl: bot.avatarUrl, body: body.trim(), visibility: 'staff' } });
  }

  /** Staff send an assistant's draft, as it is (the assistant's words) or edited (theirs), to the requester. */
  async sendDraft(scope: { resellerId?: string; mode?: LedgerMode }, ticketId: string, draftId: string, author: TicketAuthor, edited?: string) {
    const ticket = await this.load({ id: ticketId, ...(scope.resellerId ? { resellerId: scope.resellerId, mode: scope.mode } : {}) });
    if (!ticket) throw notFound();
    const draft = ticket.messages.find(message => message.id === draftId && message.draft);
    if (!draft) throw notFound();
    if (ticket.status === 'resolved') throw conflict('ticket_resolved', 'This ticket is resolved.');
    const body = edited?.trim() || draft.body;
    const writer: TicketAuthor = edited?.trim() && edited.trim() !== draft.body ? author : { kind: 'bot', id: draft.authorId, name: draft.authorName, avatar: draft.authorAvatarUrl };
    await this.prisma.supportTicketMessage.delete({ where: { id: draft.id } });
    const answering = (ticket.queue === 'reseller' && author.kind === 'reseller') || (ticket.queue === 'bitocard' && author.kind === 'bitocard');
    await this.staffReplied(ticket, writer, body, 'all', answering, author.kind === 'bitocard');
    if (ticket.requester === 'customer') await this.tellCustomer(ticket, 'customer.support.ticket_replied', 'Your ticket has a reply');
    else await this.tellReseller(ticket, 'support.ticket_replied', 'BitoCard replied to your ticket', `${ticketReference(ticket.number)}: ${ticket.subject}`);
    return (await this.load({ id: ticketId }))!;
  }

  async discardDraft(scope: { resellerId?: string; mode?: LedgerMode }, ticketId: string, draftId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, ...(scope.resellerId ? { resellerId: scope.resellerId, mode: scope.mode } : {}) } });
    if (!ticket) throw notFound();
    const deleted = await this.prisma.supportTicketMessage.deleteMany({ where: { id: draftId, ticketId, draft: true } });
    if (!deleted.count) throw notFound();
    return (await this.load({ id: ticketId }))!;
  }

  /**
   * Staff write. An answer (`all`) from whoever owns the queue hands the turn to the requester (`pending`); a note
   * changes nothing. BitoCard's messages reach the reseller as `support_ticket.message_received` (on their own tickets
   * only the answers, which are all they see).
   */
  private async staffReplied(ticket: SupportTicket, author: TicketAuthor, body: string, visibility: TicketVisibility, answering: boolean, fromBitocard = false) {
    const handover = visibility === 'all' && answering && ticket.status === 'open';
    const types: TicketEvent[] = [];
    if (fromBitocard && (visibility === 'all' || ticket.requester === 'customer')) types.push('support_ticket.message_received');
    if (handover) types.push('support_ticket.updated');
    await this.transition(ticket.id, {}, handover ? { status: 'pending' } : {}, types, { author, body, visibility });
  }

  /** A new ticket with its first message and its `support_ticket.created` event, in one transaction. */
  private async create(data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'subject'> & { subject: string }, author: TicketAuthor, message: string, visibility: TicketVisibility = 'all') {
    const created = await this.prisma.$transaction(async tx => {
      const ticket = await tx.supportTicket.create({ data: { ...data, subject: data.subject.trim().slice(0, 200) } });
      await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, author: author.kind, authorId: author.id, authorName: author.name, authorAvatarUrl: author.avatar ?? null, body: message.trim(), visibility } });
      await this.recordEvent(tx, ticket.id, 'support_ticket.created');
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    });
    this.events.committed();
    return created;
  }

  /**
   * A change, claimed on the ticket's current state (`where`) so it happens once, with its message and the reseller's
   * events, in one transaction. False when the ticket was not in that state.
   */
  private async transition(id: string, where: Prisma.SupportTicketWhereInput, data: Prisma.SupportTicketUpdateManyMutationInput, types: TicketEvent[], message?: { author: TicketAuthor; body: string; visibility: TicketVisibility }) {
    const now = new Date();
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.supportTicket.updateMany({ where: { id, ...where }, data: { ...data, ...(message ? { lastMessageAt: now } : {}), updatedAt: now } });
      if (claimed.count === 0) return false;
      if (message) {
        await tx.supportTicketMessage.create({ data: { ticketId: id, author: message.author.kind, authorId: message.author.id, authorName: message.author.name, authorAvatarUrl: message.author.avatar ?? null, body: message.body.trim(), visibility: message.visibility, createdAt: now } });
      }
      for (const type of types) await this.recordEvent(tx, id, type);
      return true;
    });
    if (done && types.length) this.events.committed();
    return done;
  }

  private async recordEvent(tx: Tx, id: string, type: TicketEvent) {
    const ticket = await tx.supportTicket.findUniqueOrThrow({ where: { id } });
    // Afrippa's tickets are no reseller's business: no webhook events for its operator's account.
    if (ticket.queue === afrippaQueue) return;
    await this.events.record(tx, { resellerId: ticket.resellerId, storeId: ticket.storeId, mode: ticket.mode, type, object: presentTicketSummary(ticket, 'reseller') });
  }

  private async page(where: Prisma.SupportTicketWhereInput, page: Page, audience: Exclude<Audience, 'customer'>, orderBy: Prisma.SupportTicketOrderByWithRelationInput[] = [{ lastMessageAt: 'desc' }, { id: 'desc' }]) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.supportTicket.findMany({ where, orderBy, take: limit + 1, ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}) });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => presentTicketSummary(row, audience)), has_more: rows.length > limit };
  }

  private tellReseller(ticket: SupportTicket, type: 'support.ticket_created' | 'support.ticket_replied' | 'support.ticket_updated', title: string, body: string) {
    return this.inbox.reseller(ticket.resellerId, type, { subject: `${ticket.id}:${Date.now()}`, title, body, link: `/support/tickets/${ticket.id}`, mode: ticket.mode });
  }

  private tellAdmins(ticket: SupportTicket, type: 'admin.support.ticket_created' | 'admin.support.ticket_replied', body: string) {
    return this.inbox.admins(type, {
      subject: `${ticket.id}:${Date.now()}`,
      title: type === 'admin.support.ticket_created' ? 'A support ticket needs an answer' : 'A support ticket has a reply',
      body,
      link: `/support/tickets/${ticket.id}`,
      mode: ticket.mode,
    });
  }

  private tellCustomer(ticket: SupportTicket, type: 'customer.support.ticket_replied' | 'customer.support.ticket_resolved', title: string) {
    if (!ticket.customerId || !ticket.storeId) return Promise.resolve();
    return this.inbox.customer({ customerId: ticket.customerId, storeId: ticket.storeId }, type, {
      subject: `${ticket.id}:${Date.now()}`,
      title,
      body: `${ticketReference(ticket.number)}: ${ticket.subject}`,
      // Afrippa's site keeps help at /help; stores at the account's Help & support.
      link: ticket.queue === afrippaQueue ? `/help/${ticket.id}` : `/account/support/${ticket.id}`,
    });
  }

  private tellAfrippa(ticket: SupportTicket, type: 'admin.afrippa.ticket_created' | 'admin.afrippa.ticket_replied', body: string) {
    return this.inbox.afrippaAdmins(type, {
      subject: `${ticket.id}:${Date.now()}`,
      title: type === 'admin.afrippa.ticket_created' ? 'A trader needs help' : 'A trader replied to a ticket',
      body,
      link: `/support/tickets/${ticket.id}`,
      mode: ticket.mode,
    });
  }
}
