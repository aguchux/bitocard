import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Chargeback, Dispute, DisputeMessage, LedgerMode, Payment, Prisma } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { OrdersService } from '../orders/orders.service.js';
import type { Tx } from '../ledger/ledger.service.js';
import { EventsService } from '../webhooks/events.service.js';
import type { EventType } from '../webhooks/events.js';
import { ChargebacksService } from '../payments/chargebacks.service.js';

export const disputeKinds = ['customer', 'reseller', 'chargeback'] as const;
export const disputeTopics = ['order', 'payment', 'funding', 'trade', 'other'] as const;
export const disputeStatuses = ['open', 'escalated', 'contested', 'resolved'] as const;
/** What a reseller can recommend when escalating, and what BitoCard can execute. */
export const disputeActions = ['refund_customer', 'credit_reseller', 'reject', 'contest_chargeback', 'accept_chargeback'] as const;
export const messageVisibilities = ['all', 'staff'] as const;

export type DisputeKind = (typeof disputeKinds)[number];
export type DisputeTopic = (typeof disputeTopics)[number];
export type DisputeStatus = (typeof disputeStatuses)[number];
export type DisputeAction = (typeof disputeActions)[number];
export type MessageVisibility = (typeof messageVisibilities)[number];
type Audience = 'customer' | 'reseller' | 'admin';
type DisputeWithMessages = Dispute & { messages: DisputeMessage[] };
type DisputeEvent = Extract<EventType, `dispute.${string}`>;
type NewMessage = { author: Author; body: string; visibility: MessageVisibility };

/** Actions that move money: only BitoCard's finance admins execute them. */
const moneyActions = new Set<DisputeAction>(['refund_customer', 'credit_reseller', 'contest_chargeback', 'accept_chargeback']);

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such dispute.');
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export const disputeReference = (number: number) => `D-${String(number).padStart(6, '0')}`;

/** Who can read a message: the customer reads only what is meant for everyone. */
const visibleTo = (audience: Audience) => (message: DisputeMessage) => audience !== 'customer' || message.visibility === 'all';

function presentMessage(message: DisputeMessage, audience: Audience) {
  return {
    id: message.id,
    author: message.author,
    // The customer sees who answered by role, never staff names.
    author_name: audience === 'customer' && message.author !== 'customer' ? null : message.authorName,
    visibility: message.visibility,
    body: message.body,
    created_at: message.createdAt.toISOString(),
  };
}

/**
 * A dispute as each party sees it. The customer sees its state, what it is about and the messages meant for them; the
 * reseller and BitoCard also see the recommendation, the report and staff notes.
 */
export function presentDispute(dispute: DisputeWithMessages, audience: Audience) {
  const messages = dispute.messages.filter(visibleTo(audience)).map(message => presentMessage(message, audience));
  if (audience === 'customer') {
    return {
      object: 'dispute' as const,
      id: dispute.id,
      reference: disputeReference(dispute.number),
      subject: dispute.subject,
      topic: dispute.topic,
      // A contested chargeback is still with BitoCard as far as the customer is concerned.
      status: dispute.status === 'contested' ? 'escalated' : dispute.status,
      checkout_id: dispute.checkoutId,
      outcome: dispute.outcome,
      created_at: dispute.createdAt.toISOString(),
      resolved_at: dispute.resolvedAt?.toISOString() ?? null,
      messages,
    };
  }
  return {
    object: 'dispute' as const,
    id: dispute.id,
    reference: disputeReference(dispute.number),
    mode: dispute.mode,
    kind: dispute.kind as DisputeKind,
    topic: dispute.topic as DisputeTopic,
    status: dispute.status as DisputeStatus,
    subject: dispute.subject,
    customer_reference: dispute.customerReference,
    customer_id: dispute.customerId,
    order_id: dispute.orderId,
    payment_id: dispute.paymentId,
    checkout_id: dispute.checkoutId,
    chargeback_id: dispute.chargebackId,
    currency: dispute.currency,
    recommendation: dispute.recommendation as DisputeAction | null,
    recommended_amount: dispute.recommendedAmountMinor === null ? null : minor(dispute.recommendedAmountMinor),
    report: dispute.report,
    escalated_at: dispute.escalatedAt?.toISOString() ?? null,
    outcome: dispute.outcome,
    outcome_amount: dispute.outcomeAmountMinor === null ? null : minor(dispute.outcomeAmountMinor),
    outcome_note: dispute.outcomeNote,
    resolved_at: dispute.resolvedAt?.toISOString() ?? null,
    created_at: dispute.createdAt.toISOString(),
    updated_at: dispute.updatedAt.toISOString(),
    ...(audience === 'admin' ? { reseller_id: dispute.resellerId } : {}),
    messages,
  };
}

/** A dispute in a list and in its events: no messages. */
export function presentSummary(dispute: Dispute, audience: Audience) {
  const presented: Partial<ReturnType<typeof presentDispute>> = presentDispute({ ...dispute, messages: [] }, audience);
  delete presented.messages;
  return presented;
}

type Author = { kind: 'customer' | 'reseller' | 'bitocard' | 'system'; id: string | null; name: string | null };
const system: Author = { kind: 'system', id: null, name: null };

/**
 * Disputes. A store customer opens one about their order (or the reseller logs one for a customer on their own
 * systems); the reseller investigates, answers, and either resolves it themselves or escalates it to BitoCard with a
 * report and a recommendation. Chargebacks open one for the reseller too. A reseller's own dispute with BitoCard, and a
 * dispute at BitoCard's own store, goes straight to BitoCard. BitoCard executes: refund the customer, credit the
 * reseller, contest or accept a chargeback, or reject. Every step is a message on the dispute; staff notes
 * (`visibility: staff`) are never shown to the customer.
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger('Disputes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly orders: OrdersService,
    private readonly chargebacks: ChargebacksService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {
    // Chargebacks open and close their disputes (registered here: chargebacks cannot depend on disputes).
    chargebacks.onDispute({ opened: (chargeback, payment) => this.openForChargeback(chargeback, payment), decided: (chargeback, outcome) => this.chargebackDecided(chargeback, outcome) });
  }

  private load(where: Prisma.DisputeWhereInput) {
    return this.prisma.dispute.findFirst({ where, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  }

  private async houseAccount(resellerId: string) {
    return (await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { house: true } }))?.house ?? false;
  }

  // -- Store customers ---------------------------------------------------------------------------------------------

  /** A customer opens a dispute about one of their orders at this store. */
  async openForCustomer(customer: CustomerWithStore, input: { checkout_id: string; subject: string; message: string; topic?: DisputeTopic }) {
    const checkout = await this.prisma.checkout.findUnique({ where: { id: input.checkout_id } });
    if (!checkout || checkout.customerId !== customer.id) throw invalid('parameter_invalid', 'Choose one of your orders.', 'checkout_id');
    const house = await this.houseAccount(checkout.resellerId);
    const dispute = await this.create(
      {
        resellerId: checkout.resellerId,
        mode: checkout.mode,
        kind: 'customer',
        topic: input.topic ?? (checkout.orderId ? 'order' : 'payment'),
        subject: input.subject,
        storeId: customer.storeId,
        customerId: customer.id,
        orderId: checkout.orderId,
        paymentId: checkout.paymentId,
        checkoutId: checkout.id,
        currency: checkout.currency,
        // At BitoCard's own store, BitoCard is the store: it goes straight to BitoCard.
        ...(house ? { status: 'escalated', escalatedAt: new Date() } : {}),
      },
      { kind: 'customer', id: customer.id, name: customer.name },
      input.message,
    );
    if (house) await this.tellAdmins(dispute, 'admin.dispute.escalated');
    else await this.tellReseller(dispute, 'dispute.opened', 'A customer opened a dispute', `${disputeReference(dispute.number)}: ${dispute.subject}`);
    return presentDispute(dispute, 'customer');
  }

  async listForCustomer(customer: CustomerWithStore, page: { limit?: number; starting_after?: string }) {
    return this.page({ customerId: customer.id }, page, 'customer');
  }

  async getForCustomer(customer: CustomerWithStore, id: string) {
    const dispute = await this.load({ id, customerId: customer.id });
    if (!dispute) throw notFound();
    return presentDispute(dispute, 'customer');
  }

  async replyAsCustomer(customer: CustomerWithStore, id: string, body: string) {
    const dispute = await this.load({ id, customerId: customer.id });
    if (!dispute) throw notFound();
    if (dispute.status === 'resolved') throw conflict('dispute_resolved', 'This dispute is closed. Open a new one if you still need help.');
    await this.addMessage(dispute.id, { kind: 'customer', id: customer.id, name: customer.name }, body, 'all', true);
    if (dispute.status === 'open') await this.tellReseller(dispute, 'dispute.updated', 'The customer replied', `${disputeReference(dispute.number)}: ${dispute.subject}`);
    else await this.tellAdmins(dispute, 'admin.dispute.updated');
    return presentDispute((await this.load({ id }))!, 'customer');
  }

  // -- Resellers ---------------------------------------------------------------------------------------------------

  /**
   * The reseller logs a dispute: a customer's (from their own systems, or for a store customer who contacted them) to
   * investigate, or their own with BitoCard (`kind: reseller`), which goes to BitoCard at once.
   */
  async openForReseller(
    resellerId: string,
    mode: LedgerMode,
    author: Author,
    input: { kind: 'customer' | 'reseller'; topic: DisputeTopic; subject: string; message: string; order_id?: string; top_up_id?: string; customer_reference?: string },
  ) {
    const order = input.order_id ? await this.prisma.order.findFirst({ where: { id: input.order_id, resellerId, mode } }) : null;
    if (input.order_id && !order) throw invalid('parameter_invalid', 'No such order in this account and mode.', 'order_id');
    const payment = input.top_up_id ? await this.prisma.payment.findFirst({ where: { id: input.top_up_id, resellerId, mode, purpose: 'wallet_top_up' } }) : null;
    if (input.top_up_id && !payment) throw invalid('parameter_invalid', 'No such top-up in this account and mode.', 'top_up_id');
    const checkout = order?.customerId ? await this.prisma.checkout.findFirst({ where: { orderId: order.id } }) : null;
    const { currency } = await this.wallets.currencyOf(resellerId);
    const own = input.kind === 'reseller';
    const dispute = await this.create(
      {
        resellerId,
        mode,
        kind: input.kind,
        topic: input.topic,
        subject: input.subject,
        customerReference: input.customer_reference ?? order?.customerReference ?? null,
        customerId: checkout?.customerId ?? null,
        storeId: checkout?.storeId ?? null,
        checkoutId: checkout?.id ?? null,
        orderId: order?.id ?? null,
        paymentId: payment?.id ?? checkout?.paymentId ?? null,
        currency: payment?.currency ?? order?.currency ?? currency,
        ...(own ? { status: 'escalated', escalatedAt: new Date() } : {}),
      },
      author,
      input.message,
      own ? 'all' : 'staff',
    );
    if (own) await this.tellAdmins(dispute, 'admin.dispute.escalated');
    return presentDispute(dispute, 'reseller');
  }

  async listForReseller(resellerId: string, mode: LedgerMode, filter: { status?: DisputeStatus; kind?: DisputeKind; limit?: number; starting_after?: string }) {
    return this.page({ resellerId, mode, status: filter.status, kind: filter.kind }, filter, 'reseller');
  }

  async getForReseller(resellerId: string, mode: LedgerMode, id: string) {
    return presentDispute(await this.owned(resellerId, mode, id), 'reseller');
  }

  private async owned(resellerId: string, mode: LedgerMode, id: string) {
    const dispute = await this.load({ id, resellerId, mode });
    if (!dispute) throw notFound();
    return dispute;
  }

  /** The reseller answers the customer (`all`) or adds a note for BitoCard and their team (`staff`). */
  async replyAsReseller(resellerId: string, mode: LedgerMode, id: string, author: Author, input: { body: string; visibility?: MessageVisibility }) {
    const dispute = await this.owned(resellerId, mode, id);
    if (dispute.status === 'resolved') throw conflict('dispute_resolved', 'This dispute is resolved.');
    const visibility = input.visibility ?? 'all';
    await this.addMessage(dispute.id, author, input.body, visibility);
    if (visibility === 'all' && dispute.customerId) await this.tellCustomer(dispute, 'The store replied to your dispute');
    if (dispute.status !== 'open') await this.tellAdmins(dispute, 'admin.dispute.updated');
    return presentDispute((await this.load({ id }))!, 'reseller');
  }

  /** The reseller has investigated and hands it to BitoCard with a report and what they recommend BitoCard does. */
  async escalate(resellerId: string, mode: LedgerMode, id: string, author: Author, input: { recommendation: DisputeAction; amount?: number; report: string }) {
    const dispute = await this.owned(resellerId, mode, id);
    if (dispute.status !== 'open') throw conflict('dispute_not_open', 'Only a dispute still with you can be escalated.');
    this.checkAction(dispute, input.recommendation, input.amount, 'recommendation');
    const claimed = await this.transition(
      id,
      { status: 'open' },
      {
        status: 'escalated',
        escalatedAt: new Date(),
        recommendation: input.recommendation,
        recommendedAmountMinor: input.amount === undefined ? null : BigInt(input.amount),
        report: input.report.trim(),
      },
      'dispute.escalated',
      { author: system, body: `Escalated to BitoCard by ${author.name ?? 'the store'}. Recommendation: ${actionLabel(input.recommendation)}.`, visibility: 'staff' },
    );
    if (!claimed) throw conflict('dispute_not_open', 'Only a dispute still with you can be escalated.');
    if (dispute.customerId) await this.addMessage(id, system, 'The store has passed your dispute to BitoCard to decide.', 'all');
    const after = (await this.load({ id }))!;
    await this.tellAdmins(after, 'admin.dispute.escalated');
    if (after.customerId) await this.tellCustomer(after, 'Your dispute is with BitoCard');
    return presentDispute(after, 'reseller');
  }

  /** The reseller resolved a customer's dispute themselves (nothing for BitoCard to execute). */
  async resolveAsReseller(resellerId: string, mode: LedgerMode, id: string, author: Author, input: { note: string }) {
    const dispute = await this.owned(resellerId, mode, id);
    if (dispute.kind !== 'customer') throw conflict('escalation_required', 'Chargebacks and disputes with BitoCard are decided by BitoCard: escalate them.');
    const claimed = await this.transition(
      id,
      { status: 'open' },
      { status: 'resolved', outcome: 'resolved_by_reseller', outcomeNote: input.note.trim(), resolvedAt: new Date() },
      'dispute.resolved',
      { author, body: input.note, visibility: 'all' },
    );
    if (!claimed) throw conflict('dispute_not_open', 'Only a dispute still with you can be resolved by you.');
    const after = (await this.load({ id }))!;
    if (after.customerId) await this.tellCustomer(after, 'Your dispute is resolved');
    return presentDispute(after, 'reseller');
  }

  // -- BitoCard ----------------------------------------------------------------------------------------------------

  async listForAdmin(filter: { status?: DisputeStatus; reseller_id?: string; kind?: DisputeKind; limit?: number; starting_after?: string }) {
    return this.page({ status: filter.status, resellerId: filter.reseller_id, kind: filter.kind }, filter, 'admin', [{ escalatedAt: 'asc' }, { createdAt: 'desc' }]);
  }

  async getForAdmin(id: string) {
    const dispute = await this.load({ id });
    if (!dispute) throw notFound();
    return presentDispute(dispute, 'admin');
  }

  async replyAsAdmin(id: string, author: Author, input: { body: string; visibility?: MessageVisibility }) {
    const dispute = await this.load({ id });
    if (!dispute) throw notFound();
    const visibility = input.visibility ?? 'all';
    await this.addMessage(id, author, input.body, visibility, true);
    await this.tellReseller(dispute, 'dispute.updated', 'BitoCard replied', `${disputeReference(dispute.number)}: ${dispute.subject}`);
    if (visibility === 'all' && dispute.customerId) await this.tellCustomer(dispute, 'BitoCard replied to your dispute');
    return presentDispute((await this.load({ id }))!, 'admin');
  }

  /** BitoCard sends an escalated dispute back to the reseller to investigate further. */
  async returnToReseller(actorId: string | null, id: string, author: Author, note: string) {
    const before = await this.load({ id });
    if (!before) throw notFound();
    if (before.kind === 'reseller' || (await this.houseAccount(before.resellerId))) throw conflict('not_returnable', 'This dispute is BitoCard’s to decide.');
    const claimed = await this.transition(id, { status: 'escalated' }, { status: 'open', escalatedAt: null }, 'dispute.returned', { author, body: note, visibility: 'staff' });
    if (!claimed) throw conflict('dispute_not_escalated', 'Only an escalated dispute can be sent back.');
    const after = (await this.load({ id }))!;
    await this.audit.record({ actorId, action: 'dispute.returned', targetType: 'dispute', targetId: id, before: presentDispute(before, 'admin'), after: { status: after.status, note } });
    await this.tellReseller(after, 'dispute.updated', 'BitoCard sent a dispute back to you', `${disputeReference(after.number)}: ${note}`);
    return presentDispute(after, 'admin');
  }

  /**
   * BitoCard decides an escalated dispute and executes the action, whatever was recommended: refund the customer
   * (through the order's refund, reversing the sale), credit the reseller's wallet, contest or accept a chargeback, or
   * reject. Money actions need a finance admin.
   */
  async execute(actor: { id: string | null; name: string | null; finance: boolean }, id: string, input: { action: DisputeAction; amount?: number; note: string }) {
    const before = await this.load({ id });
    if (!before) throw notFound();
    if (before.status !== 'escalated') throw conflict('dispute_not_escalated', before.status === 'open' ? 'The reseller is still investigating this dispute.' : 'This dispute has already been decided.');
    if (moneyActions.has(input.action) && !actor.finance) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Only finance can execute an action that moves money.');
    this.checkAction(before, input.action, input.amount, 'action');
    // Claimed first, so two admins can never execute it twice.
    const claimed = await this.prisma.dispute.updateMany({ where: { id, status: 'escalated' }, data: { status: input.action === 'contest_chargeback' ? 'contested' : 'resolved' } });
    if (claimed.count === 0) throw conflict('dispute_not_escalated', 'This dispute has already been decided.');
    const note = input.note.trim();
    let outcome: string | null = null;
    let amount: bigint | null = null;
    try {
      if (input.action === 'refund_customer') {
        await this.orders.refund(actor.id, before.orderId!, { reason: `${disputeReference(before.number)}: ${note}`, supplier_refunded: false });
        outcome = 'refunded_customer';
      } else if (input.action === 'credit_reseller') {
        amount = BigInt(input.amount!);
        // Posted once per dispute, so executing it again after a failure can never credit twice.
        await this.wallets.adjust(actor.id, { resellerId: before.resellerId, mode: before.mode, balance: 'funding', amount: input.amount!, reason: `${disputeReference(before.number)}: ${note}`, reference: `dispute:${before.id}:credit` });
        outcome = 'credited_reseller';
      } else if (input.action === 'accept_chargeback') {
        const chargeback = await this.prisma.chargeback.findUniqueOrThrow({ where: { id: before.chargebackId! } });
        if (chargeback.provider === 'stripe') {
          // Not contested: Stripe closes it as lost and its notice moves the money.
          outcome = 'chargeback_accepted';
        } else {
          await this.chargebacks.resolve(before.chargebackId!, 'lost', actor.id, note);
          outcome = 'chargeback_lost';
        }
      } else if (input.action === 'reject') {
        outcome = 'rejected';
      }
    } catch (error) {
      // Nothing was executed: back to BitoCard's queue, with the reason it failed.
      await this.prisma.dispute.updateMany({ where: { id }, data: { status: 'escalated' } });
      throw error;
    }
    const contested = input.action === 'contest_chargeback';
    await this.transition(
      id,
      {},
      contested ? { outcomeNote: note } : { outcome, outcomeAmountMinor: amount, outcomeNote: note, resolvedAt: new Date() },
      contested ? 'dispute.contested' : 'dispute.resolved',
      { author: { kind: 'bitocard', id: actor.id, name: actor.name }, body: note, visibility: 'all' },
    );
    const after = (await this.load({ id }))!;
    await this.audit.record({ actorId: actor.id, action: `dispute.${input.action}`, targetType: 'dispute', targetId: id, before: presentDispute(before, 'admin'), after: presentDispute(after, 'admin') });
    const title = input.action === 'contest_chargeback' ? 'BitoCard is contesting a chargeback' : `BitoCard decided ${disputeReference(after.number)}`;
    await this.tellReseller(after, 'dispute.updated', title, `${actionLabel(input.action)}: ${note}`);
    if (after.customerId) await this.tellCustomer(after, after.status === 'resolved' ? 'Your dispute is resolved' : 'Your dispute has an update');
    return presentDispute(after, 'admin');
  }

  /** Whether an action fits the dispute (an order to refund, an amount to credit, a chargeback to decide). */
  private checkAction(dispute: Dispute, action: DisputeAction, amount: number | undefined, param: string) {
    const chargeback = action === 'contest_chargeback' || action === 'accept_chargeback';
    if (chargeback && !dispute.chargebackId) throw invalid('action_not_applicable', 'This dispute is not a chargeback.', param);
    if (action === 'refund_customer' && !dispute.orderId) throw invalid('action_not_applicable', 'There is no order on this dispute to refund.', param);
    // The chargeback already returns the money to the cardholder: refunding as well would pay them twice.
    if (action === 'refund_customer' && dispute.chargebackId) throw invalid('action_not_applicable', 'The chargeback returns this money to the cardholder; decide the chargeback instead of refunding.', param);
    if (action === 'credit_reseller' && (amount === undefined || amount <= 0)) throw invalid('parameter_invalid', 'Say how much to credit, in minor units of the dispute currency.', 'amount');
    if (action !== 'credit_reseller' && amount !== undefined) throw invalid('parameter_invalid', 'An amount is only for crediting the reseller.', 'amount');
  }

  // -- Chargebacks -------------------------------------------------------------------------------------------------

  /** A new chargeback opens a dispute for the reseller to investigate (BitoCard's own store: straight to BitoCard). */
  async openForChargeback(chargeback: Chargeback, payment: Payment) {
    if (await this.prisma.dispute.findUnique({ where: { chargebackId: chargeback.id } })) return;
    const house = await this.houseAccount(chargeback.resellerId);
    const checkout = payment.purpose === 'checkout' ? await this.prisma.checkout.findFirst({ where: { paymentId: payment.id } }) : null;
    try {
      const dispute = await this.create(
        {
          resellerId: chargeback.resellerId,
          mode: chargeback.mode,
          kind: 'chargeback',
          topic: payment.purpose === 'checkout' ? 'payment' : 'funding',
          subject: `Chargeback of ${formatMoney(chargeback.amountMinor, chargeback.currency)}`,
          paymentId: payment.id,
          checkoutId: checkout?.id ?? null,
          orderId: checkout?.orderId ?? null,
          storeId: checkout?.storeId ?? null,
          chargebackId: chargeback.id,
          currency: chargeback.currency,
          ...(house ? { status: 'escalated', escalatedAt: new Date() } : {}),
        },
        { kind: 'system', id: null, name: null },
        house
          ? 'The cardholder disputed this payment with their bank.'
          : 'The cardholder disputed this payment with their bank. Gather what you know (the order, the delivery, your contact with the customer) and escalate it to BitoCard with your recommendation: contest it or accept it.',
        'staff',
      );
      if (house) await this.tellAdmins(dispute, 'admin.dispute.escalated');
    } catch (error) {
      // The chargeback itself is recorded and held; a dispute that could not be opened is logged, never fatal.
      this.logger.error({ err: error, chargebackId: chargeback.id }, 'Could not open a dispute for a chargeback');
    }
  }

  /** The card network decided a chargeback: its dispute is resolved to match, wherever it stood. */
  async chargebackDecided(chargeback: Chargeback, outcome: 'won' | 'lost') {
    const dispute = await this.prisma.dispute.findUnique({ where: { chargebackId: chargeback.id } });
    if (!dispute || dispute.status === 'resolved') return;
    const claimed = await this.transition(
      dispute.id,
      { status: { not: 'resolved' } },
      { status: 'resolved', outcome: outcome === 'won' ? 'chargeback_won' : 'chargeback_lost', resolvedAt: new Date() },
      'dispute.resolved',
      { author: system, body: outcome === 'won' ? 'The card network decided for the merchant: the chargeback is won.' : 'The card network decided for the cardholder: the chargeback is lost.', visibility: 'staff' },
    );
    if (!claimed) return;
    await this.tellReseller(dispute, 'dispute.updated', `Chargeback ${outcome}`, `${disputeReference(dispute.number)}: ${dispute.subject}`);
  }

  // -- Shared ------------------------------------------------------------------------------------------------------

  /** A new dispute with its first message, and its `dispute.opened` event, in one transaction. */
  private async create(data: Omit<Prisma.DisputeUncheckedCreateInput, 'subject'> & { subject: string }, author: Author, message: string, visibility: MessageVisibility = 'all') {
    const created = await this.prisma.$transaction(async tx => {
      const dispute = await tx.dispute.create({ data: { ...data, subject: data.subject.trim().slice(0, 200) } });
      await tx.disputeMessage.create({ data: { disputeId: dispute.id, author: author.kind, authorId: author.id, authorName: author.name, body: message.trim(), visibility } });
      await this.recordEvent(tx, dispute.id, 'dispute.opened');
      return tx.dispute.findUniqueOrThrow({ where: { id: dispute.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    });
    this.events.committed();
    return created;
  }

  /**
   * A change of state, claimed on its current state (`where`) so it happens once, with the message that goes with it
   * and the reseller's event, all in one transaction. False when the dispute was not in that state.
   */
  private async transition(id: string, where: Prisma.DisputeWhereInput, data: Prisma.DisputeUpdateManyMutationInput, type: DisputeEvent | null, message?: NewMessage) {
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.dispute.updateMany({ where: { id, ...where }, data: { ...data, updatedAt: new Date() } });
      if (claimed.count === 0) return false;
      if (message) {
        await tx.disputeMessage.create({ data: { disputeId: id, author: message.author.kind, authorId: message.author.id, authorName: message.author.name, body: message.body.trim(), visibility: message.visibility } });
      }
      if (type) await this.recordEvent(tx, id, type);
      return true;
    });
    if (done && type) this.events.committed();
    return done;
  }

  /** A message on its own; `notify` records `dispute.message_received` (messages from the customer or BitoCard). */
  private async addMessage(disputeId: string, author: Author, body: string, visibility: MessageVisibility, notify = false) {
    await this.transition(disputeId, {}, {}, notify ? 'dispute.message_received' : null, { author, body, visibility });
  }

  /** The reseller's event: the dispute as they see it in a list (never the messages). */
  private async recordEvent(tx: Tx, id: string, type: DisputeEvent) {
    const dispute = await tx.dispute.findUniqueOrThrow({ where: { id } });
    await this.events.record(tx, { resellerId: dispute.resellerId, mode: dispute.mode, type, object: presentSummary(dispute, 'reseller') });
  }

  private async page(where: Prisma.DisputeWhereInput, page: { limit?: number; starting_after?: string }, audience: Audience, orderBy: Prisma.DisputeOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.dispute.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => presentSummary(row, audience)), has_more: rows.length > limit };
  }

  private tellReseller(dispute: Dispute, type: 'dispute.opened' | 'dispute.updated', title: string, body: string) {
    return this.inbox.reseller(dispute.resellerId, type, { subject: `${dispute.id}:${Date.now()}`, title, body, link: `/disputes/${dispute.id}`, mode: dispute.mode });
  }

  private tellAdmins(dispute: Dispute, type: 'admin.dispute.escalated' | 'admin.dispute.updated') {
    return this.inbox.admins(type, {
      subject: `${dispute.id}:${Date.now()}`,
      title: type === 'admin.dispute.escalated' ? `${disputeReference(dispute.number)} needs a decision` : `${disputeReference(dispute.number)} has a new message`,
      body: dispute.subject,
      link: `/orders/disputes/${dispute.id}`,
      mode: dispute.mode,
    });
  }

  private tellCustomer(dispute: Dispute, title: string) {
    if (!dispute.customerId || !dispute.storeId) return Promise.resolve();
    return this.inbox.customer({ customerId: dispute.customerId, storeId: dispute.storeId }, 'customer.dispute.updated', {
      subject: `${dispute.id}:${Date.now()}`,
      title,
      body: `${disputeReference(dispute.number)}: ${dispute.subject}`,
      link: `/account/disputes/${dispute.id}`,
    });
  }
}

export function actionLabel(action: DisputeAction) {
  return {
    refund_customer: 'refund the customer',
    credit_reseller: 'credit the reseller’s wallet',
    reject: 'reject the dispute',
    contest_chargeback: 'contest the chargeback',
    accept_chargeback: 'accept the chargeback',
  }[action];
}
