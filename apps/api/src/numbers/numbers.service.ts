import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { PricingService } from '../catalogue/pricing.service.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, type NumberMessage, Prisma, type VirtualNumber } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { numberReminderEmail, type NumberStage } from '../notifications/templates.js';
import { OrderAccessService } from '../orders/order-access.service.js';
import { addMonth } from '../orders/orders.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { EventsService } from '../webhooks/events.service.js';

const day = 24 * 60 * 60 * 1000;
/** Renewed automatically this long before expiry; a short wallet is tried again after `retryRenewalMs`. */
const autoRenewBeforeMs = 3 * day;
const retryRenewalMs = 12 * 60 * 60 * 1000;
/** One renewal at a time: longer than the supplier's two calls (15 seconds each) so a slow one is never run twice. */
const renewalLeaseMs = 3 * 60 * 1000;
/** Renewals left unclear by the supplier are asked again (the same request) this often. */
const pendingRenewalRetryMs = 15 * 60 * 1000;
/** The customer can renew only this close to expiry (or once expired), so they cannot buy months ahead on the reseller's wallet. */
const customerRenewBeforeMs = 7 * day;
const remindBeforeMs = 7 * day;
const warnAfterMs = 7 * day;
const deleteAfterMs = 15 * day;
/** SMS are kept this long, then deleted. */
const messageRetentionMs = 90 * day;
/** One SMS part: 160 GSM characters, or 70 when the text needs Unicode. Longer texts are refused (one part per message). */
const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/;
export const smsLimit = (text: string) => (gsm.test(text) ? 160 : 70);

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such number.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

type NumberWithOrder = VirtualNumber & { order: { status: string; customerId: string | null; recipient: Prisma.JsonValue; resellerId: string; id: string; product: { features: string[]; name: string } } };

/** E.164 with its plus: `447700900123` and `+447700900123` are the same number. */
export const e164 = (value: string) => `+${value.replace(/[^\d]/g, '')}`;

export function presentNumber(number: VirtualNumber & { order?: { product: { features: string[] } } }, sendsSms = false) {
  return {
    object: 'virtual_number' as const,
    id: number.id,
    order_id: number.orderId,
    mode: number.mode,
    number: number.number,
    status: number.status as 'active' | 'expired' | 'deleted',
    expires_at: number.expiresAt.toISOString(),
    delete_at: new Date(number.expiresAt.getTime() + deleteAfterMs).toISOString(),
    auto_renew: number.autoRenew,
    customer_sending: number.customerSending,
    sends_sms: sendsSms,
    renewal_error: number.renewalError,
    created_at: number.createdAt.toISOString(),
    updated_at: number.updatedAt.toISOString(),
  };
}

/**
 * Virtual numbers after their order: renewals from the reseller's wallet, the reminders before a number lapses, its
 * pause and deletion, and its SMS. A number stays with the supplier that sold it.
 *
 * Renewals are paid by the reseller (their customer pays them however they agree): a month at BitoCard's wholesale
 * price (the supplier's monthly cost at today's rate, plus BitoCard's margin), held from the wallet, added with the
 * supplier, then taken. Auto-renew (on by default) renews 3 days before expiry. Unrenewed, the customer and reseller
 * are reminded 7 days before; on the day the number is paused (the supplier stops it) but renewable; 7 days later a
 * delete warning; on day 15 it is released for good.
 */
@Injectable()
export class NumbersService {
  private readonly logger = new Logger('Numbers');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly adapters: SupplierAdapters,
    private readonly pricing: PricingService,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly inbox: InboxService,
    private readonly email: EmailService,
    private readonly access: OrderAccessService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  private includeOrder = { order: { select: { id: true, status: true, resellerId: true, customerId: true, recipient: true, product: { select: { features: true, name: true } } } } } as const;

  private simulated(number: VirtualNumber) {
    return number.mode === 'test' || number.supplierNumberId.startsWith('sandbox_');
  }

  /** Whether SMS can be sent from it: a number that sends SMS, at a supplier with outgoing SMS set up (always in the sandbox). */
  sendsSms(number: VirtualNumber & { order: { product: { features: string[] } } }) {
    if (!number.order.product.features.includes('sms_out')) return false;
    return this.simulated(number) || Boolean(this.adapters.get(number.supplierCode).numbers?.smsConfigured?.());
  }

  present(number: NumberWithOrder) {
    return presentNumber(number, this.sendsSms(number));
  }

  // -- Reseller API --------------------------------------------------------------------------------------------------

  private async find(resellerId: string, mode: LedgerMode, id: string) {
    const number = await this.prisma.virtualNumber.findFirst({ where: { id, resellerId, mode }, include: this.includeOrder });
    if (!number) throw notFound();
    return number as NumberWithOrder;
  }

  async list(resellerId: string, mode: LedgerMode, filter: { status?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.virtualNumber.findMany({
      where: { resellerId, mode, ...(filter.status ? { status: filter.status } : {}) },
      include: this.includeOrder,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.present(row as NumberWithOrder)), has_more: rows.length > limit };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    return this.present(await this.find(resellerId, mode, id));
  }

  async update(resellerId: string, mode: LedgerMode, id: string, input: { auto_renew?: boolean; customer_sending?: boolean }) {
    const number = await this.find(resellerId, mode, id);
    if (number.status === 'deleted') throw conflict('number_deleted', 'This number has been deleted.');
    const updated = await this.prisma.virtualNumber.update({
      where: { id: number.id },
      data: { ...(input.auto_renew !== undefined ? { autoRenew: input.auto_renew } : {}), ...(input.customer_sending !== undefined ? { customerSending: input.customer_sending } : {}) },
      include: this.includeOrder,
    });
    return this.present(updated as NumberWithOrder);
  }

  // -- Renewals ------------------------------------------------------------------------------------------------------

  /** What a month costs the reseller now. */
  private async monthlyPrice(number: VirtualNumber) {
    const [ctx, product] = await Promise.all([this.pricing.context(number.resellerId, number.mode), this.prisma.product.findUniqueOrThrow({ where: { id: number.productId } })]);
    return this.pricing.wholesaleFor(ctx, product, number.monthlyCostMinor, number.costCurrency, number.supplierCode);
  }

  /** The reseller renews a number for a month from their wallet (also an expired one, until it is deleted). */
  async renewByReseller(resellerId: string, mode: LedgerMode, id: string) {
    const number = await this.find(resellerId, mode, id);
    return this.present(await this.renew(number));
  }

  /**
   * One month more: the number is claimed (one renewal at a time, so the supplier is never asked twice), the price held
   * from the wallet, the month added with the supplier, then the price taken; an expired number is restored and its
   * month starts now. A clear refusal releases the hold. Unclear is not failed: after a timeout the supplier may have
   * renewed, so the hold and the exact request are kept (`renewalPending`, `renewalCycles`) and asked again, unchanged,
   * until the supplier answers; asking again for the same renewals-left count never adds a second month.
   */
  private async renew(number: NumberWithOrder): Promise<NumberWithOrder> {
    if (number.status === 'deleted') throw conflict('number_deleted', 'This number has been deleted and cannot be renewed.');
    const started = new Date();
    const claimed = await this.prisma.virtualNumber.updateMany({
      where: { id: number.id, status: { not: 'deleted' }, OR: [{ renewalAttemptAt: null }, { renewalAttemptAt: { lt: new Date(started.getTime() - renewalLeaseMs) } }] },
      data: { renewalAttemptAt: started },
    });
    if (claimed.count === 0) throw conflict('renewal_in_progress', 'This number is being renewed. Try again in a few minutes.');
    // Re-read: a renewal left unclear by an earlier run is finished, never started again.
    const current = await this.prisma.virtualNumber.findUniqueOrThrow({ where: { id: number.id } });
    const period = current.renewalPending ?? `${number.expiresAt.toISOString()}:${started.getTime()}`;
    const price = await this.monthlyPrice(number);
    const hold = await this.wallets.hold({
      resellerId: number.resellerId,
      mode: number.mode,
      amount: price.wholesale,
      reference: `number_renewal:${number.id}:${period}`,
      description: `Number renewal: ${number.number}`,
    });
    if (!current.renewalPending) await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalPending: period, renewalCycles: null } });
    try {
      if (!this.simulated(number)) {
        const supplier = this.adapters.get(number.supplierCode).numbers;
        if (!supplier) throw new ProviderError(number.supplierCode, 'numbers cannot be renewed with this supplier', true);
        let cycles = current.renewalPending ? current.renewalCycles : null;
        if (cycles === null) {
          // Saved before asking, so a retry asks for exactly this and never adds another month.
          cycles = await supplier.nextRenewal(number.supplierNumberId);
          await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalCycles: cycles } });
        }
        await supplier.renewNumber(number.supplierNumberId, cycles);
      }
    } catch (error) {
      if (!(error instanceof ProviderError && error.definite)) {
        await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalError: 'renewal_pending' } });
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', numberId: number.id }, 'Number renewal unclear; the amount stays held and it is asked again');
        throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'renewal_pending', 'The renewal is not confirmed yet. We are checking with the network; nothing more will be taken for it.');
      }
      await this.wallets.releaseHold(hold.id, `Number renewal not made: ${number.number}`);
      await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalPending: null, renewalCycles: null } });
      this.logger.warn({ err: error.message, numberId: number.id }, 'Number renewal refused by the supplier');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'renewal_failed', 'The number could not be renewed right now. Nothing was taken from your wallet. Try again later.');
    }
    await this.wallets.captureHold(hold.id, `Number renewed: ${number.number}`);
    const reference = `number_renewal_cost:${number.id}:${period}`;
    if (!(await this.prisma.journalEntry.findUnique({ where: { reference } }))) {
      await this.ledger.post({
        mode: number.mode,
        type: 'order_cost',
        reference,
        description: `Supplier cost: number renewal ${number.number}`,
        metadata: { number_id: number.id, supplier: number.supplierCode },
        lines: [
          { account: { kind: 'cost_of_sales', currency: number.costCurrency, provider: number.supplierCode }, debit: number.monthlyCostMinor },
          { account: { kind: 'supplier_float', currency: number.costCurrency, provider: number.supplierCode }, credit: number.monthlyCostMinor },
        ],
      });
    }
    const now = new Date();
    const renewed = await this.prisma.$transaction(async tx => {
      const updated = await tx.virtualNumber.update({
        where: { id: number.id },
        data: {
          status: 'active',
          // A paused number's new month starts now; an active one's at the end of the month it has.
          expiresAt: addMonth(number.status === 'expired' || number.expiresAt < now ? now : number.expiresAt),
          renewedAt: now,
          renewalError: null,
          renewalAttemptAt: now,
          renewalPending: null,
          renewalCycles: null,
          remindedAt: null,
          expiredAt: null,
          warnedAt: null,
        },
        include: this.includeOrder,
      });
      await this.events.record(tx, { resellerId: number.resellerId, mode: number.mode, type: 'number.renewed', object: this.present(updated as NumberWithOrder) });
      return updated as NumberWithOrder;
    });
    this.events.committed();
    return renewed;
  }

  // -- The schedule ------------------------------------------------------------------------------------------------

  /**
   * The `numbers` job (hourly): automatic renewals, reminders 7 days before expiry, pausing at expiry, the delete
   * warning 7 days after, deletion on day 15, and deleting messages older than 90 days. Each step is claimed on its
   * own column, so it happens once however often the job runs.
   */
  async job(now = new Date()) {
    const outcome = { renewed: 0, reminded: 0, expired: 0, warned: 0, deleted: 0, messages_deleted: 0 };
    const due = (where: Prisma.VirtualNumberWhereInput) => this.prisma.virtualNumber.findMany({ where, include: this.includeOrder, take: 100 }) as Promise<NumberWithOrder[]>;

    for (const number of await due({
      status: 'active',
      autoRenew: true,
      expiresAt: { lte: new Date(now.getTime() + autoRenewBeforeMs) },
      OR: [{ renewalAttemptAt: null }, { renewalAttemptAt: { lt: new Date(now.getTime() - retryRenewalMs) } }],
    })) {
      try {
        await this.renew(number);
        outcome.renewed += 1;
      } catch (error) {
        const reason = error instanceof ApiError ? error.code : 'renewal_failed';
        await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalError: reason, renewalAttemptAt: now } });
        if (number.renewalError !== reason) {
          await this.inbox.reseller(number.resellerId, 'number.renewal_failed', {
            subject: `${number.id}:${number.expiresAt.toISOString()}`,
            title: `${number.number} was not renewed`,
            body: reason === 'insufficient_funds' ? 'Your wallet could not cover its renewal. Top up to keep the number; we try again twice a day.' : 'Its renewal failed. We try again twice a day.',
            link: '/numbers',
            mode: number.mode,
          });
        }
      }
    }

    // Renewals the supplier left unclear: asked again, unchanged, whether or not auto-renew is on.
    for (const number of await due({
      status: { not: 'deleted' },
      renewalPending: { not: null },
      renewalAttemptAt: { lt: new Date(now.getTime() - pendingRenewalRetryMs) },
    })) {
      try {
        await this.renew(number);
        outcome.renewed += 1;
      } catch (error) {
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', numberId: number.id }, 'Unclear number renewal not settled yet');
      }
    }

    for (const number of await due({ status: 'active', remindedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + remindBeforeMs) } })) {
      if (!(await this.claim(number.id, 'remindedAt', { status: 'active', remindedAt: null }))) continue;
      await this.tell(number, 'expiring');
      outcome.reminded += 1;
    }

    for (const number of await due({ status: 'active', expiresAt: { lte: now } })) {
      const paused = await this.prisma.$transaction(async tx => {
        const claimed = await tx.virtualNumber.updateMany({ where: { id: number.id, status: 'active', expiresAt: { lte: now } }, data: { status: 'expired', expiredAt: now } });
        if (claimed.count === 0) return false;
        const updated = (await tx.virtualNumber.findUniqueOrThrow({ where: { id: number.id }, include: this.includeOrder })) as NumberWithOrder;
        await this.events.record(tx, { resellerId: number.resellerId, mode: number.mode, type: 'number.expired', object: this.present(updated) });
        return true;
      });
      if (!paused) continue;
      this.events.committed();
      await this.tell(number, 'expired');
      outcome.expired += 1;
    }

    for (const number of await due({ status: 'expired', warnedAt: null, expiresAt: { lte: new Date(now.getTime() - warnAfterMs) } })) {
      if (!(await this.claim(number.id, 'warnedAt', { status: 'expired', warnedAt: null }))) continue;
      await this.tell(number, 'warning');
      outcome.warned += 1;
    }

    // Never while a renewal is unclear: the supplier may have renewed it, and the reseller's money is held for it.
    for (const number of await due({ status: 'expired', renewalPending: null, expiresAt: { lte: new Date(now.getTime() - deleteAfterMs) } })) {
      try {
        if (!this.simulated(number)) await this.adapters.get(number.supplierCode).numbers?.releaseNumber(number.supplierNumberId);
      } catch (error) {
        // Not released yet: tried again next hour. It stays paused meanwhile.
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', numberId: number.id }, 'Number not released yet');
        continue;
      }
      const deleted = await this.prisma.$transaction(async tx => {
        const claimed = await tx.virtualNumber.updateMany({ where: { id: number.id, status: 'expired', renewalPending: null }, data: { status: 'deleted', deletedAt: now, autoRenew: false } });
        if (claimed.count === 0) return false;
        await tx.numberMessage.deleteMany({ where: { numberId: number.id } });
        const updated = (await tx.virtualNumber.findUniqueOrThrow({ where: { id: number.id }, include: this.includeOrder })) as NumberWithOrder;
        await this.events.record(tx, { resellerId: number.resellerId, mode: number.mode, type: 'number.deleted', object: this.present(updated) });
        return true;
      });
      if (!deleted) continue;
      this.events.committed();
      await this.tell(number, 'deleted');
      outcome.deleted += 1;
    }

    outcome.messages_deleted = (await this.prisma.numberMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - messageRetentionMs) } } })).count;
    return outcome;
  }

  private async claim(id: string, field: 'remindedAt' | 'warnedAt', where: Prisma.VirtualNumberWhereInput) {
    const claimed = await this.prisma.virtualNumber.updateMany({ where: { id, ...where }, data: { [field]: new Date() } });
    return claimed.count === 1;
  }

  /** Tells the customer (by email, under the store's name) and the reseller (in SHQ). Never throws. */
  private async tell(number: NumberWithOrder, stage: NumberStage) {
    const deleteAt = new Date(number.expiresAt.getTime() + deleteAfterMs);
    const day = (date: Date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
    const reseller: Record<NumberStage, { type: 'number.expiring' | 'number.expired' | 'number.deleted'; title: string; body: string } | null> = {
      expiring: { type: 'number.expiring', title: `${number.number} expires on ${day(number.expiresAt)}`, body: number.autoRenew ? 'It renews from your wallet 3 days before. Keep enough in your wallet.' : 'Auto-renew is off: renew it to keep it.' },
      expired: { type: 'number.expired', title: `${number.number} has expired`, body: `It is paused. Renew it by ${day(deleteAt)} or it is deleted.` },
      warning: null,
      deleted: { type: 'number.deleted', title: `${number.number} was deleted`, body: 'It was not renewed within 15 days of expiring.' },
    };
    try {
      const note = reseller[stage];
      if (note) await this.inbox.reseller(number.resellerId, note.type, { subject: `${number.id}:${stage}:${number.expiresAt.toISOString()}`, title: note.title, body: note.body, link: '/numbers', mode: number.mode });
      const to = await this.customerEmail(number);
      if (!to) return;
      const [store, link] = await Promise.all([this.storeName(number.resellerId), this.access.link({ id: number.orderId, resellerId: number.resellerId }).then(result => result.url)]);
      await this.email.send(numberReminderEmail(to, { store, number: number.number, stage, expiresAt: number.expiresAt, deleteAt, link }));
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', numberId: number.id, stage }, 'Could not send a number reminder');
    }
  }

  private async customerEmail(number: NumberWithOrder) {
    if (number.order.customerId) return (await this.prisma.customer.findUnique({ where: { id: number.order.customerId }, select: { email: true } }))?.email ?? null;
    const email = (number.order.recipient as Record<string, unknown> | null)?.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  }

  private async storeName(resellerId: string) {
    const [store, reseller] = await Promise.all([
      this.prisma.store.findFirst({ where: { resellerId, status: 'published' }, select: { name: true } }),
      this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { name: true } }),
    ]);
    return store?.name ?? reseller.name;
  }

  // -- SMS -----------------------------------------------------------------------------------------------------------

  presentMessage(message: NumberMessage, number: Pick<VirtualNumber, 'number'>, currency: string | null, withText = true) {
    const other = e164(message.counterparty);
    return {
      object: 'number_message' as const,
      id: message.id,
      number_id: message.numberId,
      direction: message.direction as 'in' | 'out',
      from: message.direction === 'in' ? other : number.number,
      to: message.direction === 'in' ? number.number : other,
      text: withText ? this.encryption().decrypt(message.textEncrypted) : null,
      status: message.status as 'received' | 'queued' | 'sent' | 'delivered' | 'failed',
      charged: message.chargedMinor === null ? null : minor(message.chargedMinor),
      currency: message.chargedMinor === null ? null : currency,
      failure_reason: message.failureReason,
      created_at: message.createdAt.toISOString(),
    };
  }

  /** The number's messages, newest first. */
  async messages(numberId: string, page: { limit?: number; starting_after?: string } = {}) {
    const number = await this.prisma.virtualNumber.findUniqueOrThrow({ where: { id: numberId } });
    const limit = page.limit ?? 25;
    const rows = await this.prisma.numberMessage.findMany({
      where: { numberId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    const { currency } = await this.wallets.currencyOf(number.resellerId);
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.presentMessage(row, number, currency)), has_more: rows.length > limit };
  }

  async resellerMessages(resellerId: string, mode: LedgerMode, id: string, page: { limit?: number; starting_after?: string }) {
    const number = await this.find(resellerId, mode, id);
    return this.messages(number.id, page);
  }

  async resellerSend(resellerId: string, mode: LedgerMode, id: string, input: { to: string; text: string }) {
    const number = await this.find(resellerId, mode, id);
    return this.send(number, input, 'reseller');
  }

  /**
   * Sends an SMS from the number. The most it can cost (one part at `DIDWW_SMS_MAX_PRICE_CENTS`, at BitoCard's
   * price) is held from the reseller's wallet; the supplier reports the real price later (`smsStatus`), which is taken
   * and the rest returned. A refused message returns the hold. The sandbox sends nothing and charges a simulated price.
   */
  async send(number: NumberWithOrder, input: { to: string; text: string }, sentBy: 'reseller' | 'customer') {
    if (number.status !== 'active') throw conflict('number_not_active', 'This number is not active: renew it to send messages.');
    if (!this.sendsSms(number)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'sms_not_supported', 'This number cannot send SMS.', 'to');
    }
    const text = input.text.trim();
    if (!text || text.length > smsLimit(text)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'text_too_long', `A message can be up to ${smsLimit(text)} characters.`, 'text');
    }
    const to = e164(input.to);
    if (!/^\+\d{8,15}$/.test(to)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'invalid_number', 'Enter the number in international format, for example +447700900123.', 'to');
    const max = await this.smsPrice(number, BigInt(this.integrations.config.DIDWW_SMS_MAX_PRICE_CENTS));
    const message = await this.prisma.numberMessage.create({
      data: { numberId: number.id, direction: 'out', counterparty: to.slice(1), textEncrypted: this.encryption().encrypt(text), status: 'queued', sentBy },
    });
    const hold = await this.wallets.hold({ resellerId: number.resellerId, mode: number.mode, amount: max.wholesale, reference: `sms:${message.id}`, description: `SMS from ${number.number}` }).catch(async error => {
      await this.prisma.numberMessage.update({ where: { id: message.id }, data: { status: 'failed', failureReason: 'Your wallet could not cover the message.' } });
      throw error;
    });
    await this.prisma.numberMessage.update({ where: { id: message.id }, data: { holdId: hold.id } });
    if (this.simulated(number)) {
      await this.prisma.numberMessage.update({ where: { id: message.id }, data: { supplierMessageId: `sandbox_${message.id}` } });
      await this.priced(message.id, 'sent', 1n, 1);
    } else {
      try {
        const sent = await this.adapters.get(number.supplierCode).numbers!.sendSms!({ from: number.number, to, text });
        await this.prisma.numberMessage.update({ where: { id: message.id }, data: { supplierMessageId: sent.supplierMessageId } });
      } catch (error) {
        // Refused, or unclear: either way it is not charged (an unclear send that went out is BitoCard's cost).
        await this.wallets.releaseHold(hold.id, `SMS not sent from ${number.number}`);
        await this.prisma.numberMessage.update({ where: { id: message.id }, data: { status: 'failed', failureReason: 'The message could not be sent.' } });
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', numberId: number.id }, 'SMS not sent');
      }
    }
    const { currency } = await this.wallets.currencyOf(number.resellerId);
    return this.presentMessage(await this.prisma.numberMessage.findUniqueOrThrow({ where: { id: message.id } }), number, currency);
  }

  private async smsPrice(number: VirtualNumber, costMinor: bigint) {
    const [ctx, product] = await Promise.all([this.pricing.context(number.resellerId, number.mode), this.prisma.product.findUniqueOrThrow({ where: { id: number.productId } })]);
    return this.pricing.wholesaleFor(ctx, product, costMinor, 'USD', number.supplierCode);
  }

  /**
   * A sent message's outcome and price (the supplier's cost, in US cents): BitoCard's price for it is taken from the
   * hold and the rest returned; a failed message returns the whole hold. Applied once.
   */
  private async priced(messageId: string, status: 'sent' | 'failed', costCents: bigint, parts: number, failureReason?: string) {
    const message = await this.prisma.numberMessage.findUnique({ where: { id: messageId }, include: { number: true } });
    if (!message || message.status !== 'queued' || !message.holdId) return;
    if (status === 'failed') {
      await this.wallets.releaseHold(message.holdId, `SMS not delivered from ${message.number.number}`);
      await this.prisma.numberMessage.updateMany({ where: { id: messageId, status: 'queued' }, data: { status: 'failed', failureReason: failureReason ?? 'The message could not be delivered.' } });
      return;
    }
    const price = await this.smsPrice(message.number, costCents);
    const hold = await this.wallets.settleHold(message.holdId, price.wholesale, `SMS from ${message.number.number}`);
    const charged = price.wholesale > hold.amountMinor ? hold.amountMinor : price.wholesale;
    if (price.wholesale > hold.amountMinor) this.logger.warn({ messageId }, 'SMS cost more than its hold: the difference is BitoCard’s cost');
    await this.prisma.numberMessage.updateMany({ where: { id: messageId, status: 'queued' }, data: { status: 'sent', costMinor: costCents, chargedMinor: charged, parts } });
    const reference = `sms_cost:${messageId}`;
    if (costCents > 0n && !(await this.prisma.journalEntry.findUnique({ where: { reference } }))) {
      await this.ledger.post({
        mode: message.number.mode,
        type: 'order_cost',
        reference,
        description: `Supplier cost: SMS from ${message.number.number}`,
        metadata: { message_id: messageId, supplier: message.number.supplierCode },
        lines: [
          { account: { kind: 'cost_of_sales', currency: 'USD', provider: message.number.supplierCode }, debit: costCents },
          { account: { kind: 'supplier_float', currency: 'USD', provider: message.number.supplierCode }, credit: costCents },
        ],
      });
    }
  }

  // -- Supplier notifications ----------------------------------------------------------------------------------------

  /** DIDWW's SMS trunks carry the shared token we set (`?token=`); they sign nothing. */
  tokenValid(token: string | undefined) {
    const expected = this.integrations.config.DIDWW_SMS_WEBHOOK_TOKEN;
    if (!expected || !token) return false;
    const [a, b] = [Buffer.from(expected), Buffer.from(token)];
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * An incoming SMS from the supplier (`{ id, from, to, text_base64, time }`, the body set on DIDWW's HTTP IN trunk):
   * stored once per message ID, encrypted; `number.sms_received` sent. SMS to unknown, paused or deleted numbers are
   * dropped (and logged without their text).
   */
  async receive(supplierCode: string, input: { id?: string; from?: string; to?: string; text_base64?: string; text?: string }) {
    if (!input.id || !input.from || !input.to) return { handled: false, reason: 'incomplete' };
    const number = await this.prisma.virtualNumber.findFirst({ where: { supplierCode, number: e164(input.to), status: 'active' }, include: this.includeOrder });
    if (!number) {
      this.logger.warn({ to: input.to }, 'SMS for a number that is not active here');
      return { handled: false, reason: 'unknown_number' };
    }
    const text = input.text_base64 !== undefined ? Buffer.from(input.text_base64, 'base64').toString('utf8') : (input.text ?? '');
    try {
      await this.prisma.$transaction(async tx => {
        const message = await tx.numberMessage.create({
          data: { numberId: number.id, direction: 'in', counterparty: input.from!.replace(/[^\d]/g, ''), textEncrypted: this.encryption().encrypt(text), status: 'received', supplierMessageId: input.id },
        });
        await this.events.record(tx, { resellerId: number.resellerId, mode: number.mode, type: 'number.sms_received', object: this.presentMessage(message, number, null, false) });
      });
    } catch (error) {
      // Delivered again: stored once.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { handled: true, duplicate: true };
      throw error;
    }
    this.events.committed();
    return { handled: true };
  }

  /**
   * The outcome of a sent SMS (DIDWW's HTTP OUT trunk callback): `outbound_message_callbacks` with the status and
   * price (US dollars), or a later `dlr_event` delivery report.
   */
  async smsStatus(body: { data?: { type?: string; id?: string | number; attributes?: { status?: string; price?: number | string; fragments_sent?: number; code_id?: number | null } } }) {
    const data = body.data;
    if (!data?.id) return { handled: false };
    const message = await this.prisma.numberMessage.findFirst({ where: { direction: 'out', supplierMessageId: String(data.id) } });
    if (!message) return { handled: false, reason: 'unknown_message' };
    const status = String(data.attributes?.status ?? '').toLowerCase();
    if (data.type === 'dlr_event') {
      if (status === 'delivered') await this.prisma.numberMessage.updateMany({ where: { id: message.id, status: 'sent' }, data: { status: 'delivered' } });
      if (status === 'failed' || status === 'expired') await this.prisma.numberMessage.updateMany({ where: { id: message.id, status: { in: ['sent', 'queued'] } }, data: { status: 'failed', failureReason: 'Not delivered to the recipient.' } });
      return { handled: true };
    }
    if (status === 'success') {
      const cents = BigInt(Math.ceil(Math.round(Number(data.attributes?.price ?? 0) * 1_000_000) / 10_000));
      await this.priced(message.id, 'sent', cents, Number(data.attributes?.fragments_sent ?? 1));
    } else {
      await this.priced(message.id, 'failed', 0n, 0, data.attributes?.code_id === 100 ? 'The message could not be sent.' : 'The message could not be delivered.');
    }
    return { handled: true };
  }

  // -- The order page ----------------------------------------------------------------------------------------------

  /** The number on its order's page, for the proven customer: status, dates, renewal, its recent messages, and whether they may send. */
  async forOrder(orderId: string) {
    const number = (await this.prisma.virtualNumber.findUnique({ where: { orderId }, include: this.includeOrder })) as NumberWithOrder | null;
    if (!number) return null;
    const recent = number.status === 'deleted' ? { data: [] } : await this.messages(number.id, { limit: 50 });
    return {
      number: number.number,
      status: number.status as 'active' | 'expired' | 'deleted',
      expires_at: number.expiresAt.toISOString(),
      delete_at: new Date(number.expiresAt.getTime() + deleteAfterMs).toISOString(),
      auto_renew: number.autoRenew,
      can_renew: number.status !== 'deleted',
      can_send: number.customerSending && number.status === 'active' && this.sendsSms(number),
      messages: recent.data.map(message => ({ direction: message.direction, from: message.from, to: message.to, text: message.text, status: message.status, created_at: message.created_at })),
    };
  }

  private async byOrder(orderId: string) {
    const number = (await this.prisma.virtualNumber.findUnique({ where: { orderId }, include: this.includeOrder })) as NumberWithOrder | null;
    if (!number) throw notFound();
    return number;
  }

  /** A number the customer acts on from the order page: only while its order stands (never once refunded). */
  private async customerNumber(orderId: string) {
    const number = await this.byOrder(orderId);
    if (number.order.status !== 'completed') throw conflict('order_not_active', 'This order is no longer active. Contact the store.');
    return number;
  }

  /**
   * The customer renews from the order page; the month is taken from the reseller's wallet (the reseller charges their
   * customer as they agree). A wallet that cannot cover it renews nothing: the customer is asked to contact the store,
   * and the reseller is told.
   */
  async renewForOrder(orderId: string) {
    const number = await this.customerNumber(orderId);
    // Only near expiry (or once expired): every renewal is paid from the reseller's wallet, so a customer can never
    // buy months ahead without limit at the reseller's expense.
    if (number.status === 'active' && number.expiresAt.getTime() - Date.now() > customerRenewBeforeMs) {
      throw conflict('renewal_not_due', 'This number can be renewed from 7 days before it expires.');
    }
    try {
      await this.renew(number);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'insufficient_funds') throw error;
      await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { renewalError: 'insufficient_funds' } });
      await this.inbox.reseller(number.resellerId, 'number.renewal_failed', {
        subject: `${number.id}:customer:${new Date().toISOString().slice(0, 13)}`,
        title: `Your customer could not renew ${number.number}`,
        body: 'They tried to renew it, but your wallet could not cover it. Top up so they can renew.',
        link: '/numbers',
        mode: number.mode,
      });
      const store = await this.storeName(number.resellerId);
      throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'store_cannot_renew', `${store} cannot renew this number right now. Contact them.`);
    }
    return this.forOrder(orderId);
  }

  /** The customer switches automatic renewal on or off from the order page (each renewal is taken from the reseller's wallet). */
  async setAutoRenewForOrder(orderId: string, enabled: boolean) {
    const number = await this.customerNumber(orderId);
    if (number.status === 'deleted') throw conflict('number_deleted', 'This number has been deleted.');
    await this.prisma.virtualNumber.update({ where: { id: number.id }, data: { autoRenew: enabled } });
    return this.forOrder(orderId);
  }

  /** The customer sends from the order page, when the reseller allows it (charged to the reseller). */
  async sendForOrder(orderId: string, input: { to: string; text: string }) {
    const number = await this.customerNumber(orderId);
    if (!number.customerSending) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'sending_not_allowed', 'Sending messages from this number is not switched on. Contact the store.');
    const sent = await this.send(number, input, 'customer');
    return { direction: sent.direction, from: sent.from, to: sent.to, text: sent.text, status: sent.status, created_at: sent.created_at };
  }

  /** What renewing the number for a month would take from the wallet now (at today's rate). */
  async renewalPrice(resellerId: string, mode: LedgerMode, id: string) {
    const number = await this.find(resellerId, mode, id);
    const price = await this.monthlyPrice(number);
    return { object: 'number_renewal_price' as const, amount: minor(price.wholesale), currency: price.currency };
  }
}
