import { createHash, createHmac, randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import QRCode from 'qrcode';
import { normalisePhone } from '../auth/auth.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { formatMoney, posReceiptEmail } from '../notifications/templates.js';
import { maskEmail } from '../orders/order-access.service.js';
import { waLink } from '../whatsapp/cloud-api.js';
import { countryOfNumber, WhatsappContactsService } from '../whatsapp/contacts.service.js';
import { windowOpen, WhatsappOutbox } from '../whatsapp/outbox.service.js';
import { type ReceiptAsker, WhatsappReceiptsHub } from '../whatsapp/receipts.js';
import { ownerBy, type PosBy } from './actor.js';
import { marketZone } from './collection-rules.js';
import { invoicePdf, type ReceiptData, receiptPdf } from './receipt-pdf.js';
import type { SalesScope } from './sales.service.js';

export type ReceiptKind = 'receipt' | 'invoice';
export type ReceiptWidth = 58 | 80;

/** How long each kind of code works: shown at the till, printed on a receipt, sent to a number. */
export const codeLifetimes = { screen: 10 * 60_000, print: 30 * 24 * 3_600_000, whatsapp: 7 * 24 * 3_600_000 } as const;
/** A code gets its PDF at most this many times. */
export const maxCodeUses = 20;
/** A sale's receipt is sent (WhatsApp and email) at most this many times a day. */
export const maxSendsPerDay = 10;

const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const randomCode = () => Array.from({ length: 8 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
const whatsappClosed = () => conflict('whatsapp_unavailable', 'Receipts on WhatsApp are not open in your country yet. Print it or email it instead.');
const tooMany = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'receipt_send_limit', `This sale's receipt has been sent ${maxSendsPerDay} times today. Try again tomorrow, or print it.`);

/** "+234 803 ••• 4417": the country and network code, then the last four digits. */
export const maskPhone = (phone: string) => {
  const groups = parsePhoneNumberFromString(phone)?.formatInternational().split(' ') ?? [];
  return groups.length >= 3 ? `${groups[0]} ${groups[1]} ••• ${phone.slice(-4)}` : `${phone.slice(0, Math.max(4, phone.length - 7))} ••• ${phone.slice(-4)}`;
};
/** "Blessing M.": a cashier's first name and initial, as receipts print it. */
export const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : (parts[0] ?? '');
};

const saleInclude = {
  lines: { orderBy: { position: 'asc' } },
  payments: { orderBy: { position: 'asc' } },
  shop: true,
  till: { select: { printerWidth: true, autoPrint: true } },
  customer: { select: { id: true, name: true, phone: true, email: true } },
} satisfies Prisma.PosSaleInclude;
type SaleRow = Prisma.PosSaleGetPayload<{ include: typeof saleInclude }>;
type Account = { id: string; customerId: string; country: string; currency: string; mode: string };

const whatsappStatus = (status: string | null | undefined) => (status === 'queued' ? 'sending' : (status ?? 'sending'));
const whatsappProblem: Record<string, string> = {
  opted_out: 'They asked Udozo not to message them on WhatsApp.',
  unreachable: 'WhatsApp says this number cannot get messages.',
  template_recently_sent: 'They were sent a receipt in the last hour: they can tap Get receipt on it, or scan the QR code.',
  window_closed: 'WhatsApp would not let it through. Ask them to scan the QR code instead.',
  not_configured: "Udozo's WhatsApp is not set up.",
};

/**
 * Receipts (docs/UDOZO_POS_PLAN.md, milestone 6). Every sale is drawn when asked for, never stored: an 80 mm or 58 mm
 * till receipt (a gift receipt hides prices) and an A4 invoice, numbered once per shop (INV-2026-0148). The customer
 * gets the PDF on WhatsApp by sending its code to Udozo's number (the receipt's QR code fills the words in), or from a
 * number the cashier typed (the PDF at once inside WhatsApp's 24-hour window, else the `udozo_pos_receipt` template whose
 * Get receipt button brings it), or by email with the PDF attached. Codes are kept only as hashes; numbers and emails
 * only masked on the record of what was sent.
 */
@Injectable()
export class PosReceiptsService implements OnModuleInit {
  private readonly logger = new Logger('PosReceipts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly outbox: WhatsappOutbox,
    private readonly contacts: WhatsappContactsService,
    private readonly hub: WhatsappReceiptsHub,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    this.hub.use({ request: (asker, number, code) => this.fromCode(asker, code, { number }), choose: (asker, kind, code) => this.fromCode(asker, code, { kind }) });
  }

  private get site() {
    return String(this.integrations.config.STOREFRONT_URL ?? this.config.STOREFRONT_URL).replace(/\/+$/, '');
  }

  private async sale(customer: CustomerWithStore, id: string, scope: SalesScope = {}) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true, customerId: true, country: true, currency: true, mode: true } });
    if (!account) throw noAccount();
    const sale = await this.prisma.posSale.findFirst({ where: { id, accountId: account.id, ...(scope.tills ? { tillId: { in: scope.tills } } : {}), ...(scope.soldByStaff ? { soldByStaffId: scope.soldByStaff } : {}) }, include: saleInclude });
    if (!sale) throw notFound('sale');
    return { account, sale };
  }

  /** Whether the customer can get it on WhatsApp: Udozo's number set up and WhatsApp open in the shop's country. */
  private async whatsappOpen(country: string) {
    return Boolean(waLink(this.integrations.config)) && (await this.contacts.openIn(country));
  }

  /** The words a receipt's code fills in on WhatsApp, and the wa.me link that fills them in. */
  private codeText(number: string, code: string) {
    const text = `RECEIPT ${number}-${code}`;
    return { text, whatsapp_url: waLink(this.integrations.config, text) };
  }

  /**
   * A printed receipt's code: the same for a sale and kind every time it is printed (made from `ENCRYPTION_KEY`, so it
   * needs no storing), working 30 days from the last print.
   */
  private async printCode(account: Account, sale: SaleRow, kind: ReceiptKind) {
    const mac = createHmac('sha256', String(this.config.ENCRYPTION_KEY)).update(`pos-receipt-print:${sale.id}:${kind}`).digest();
    const code = Array.from(mac.subarray(0, 8), byte => codeAlphabet[byte % codeAlphabet.length]).join('');
    const expiresAt = new Date(Date.now() + codeLifetimes.print);
    await this.prisma.posReceiptCode.upsert({
      where: { tokenHash: sha256(code) },
      create: { accountId: account.id, saleId: sale.id, kind, purpose: 'print', tokenHash: sha256(code), expiresAt },
      update: { expiresAt },
    });
    return code;
  }

  /** Its invoice number, given once (the shop's next, claimed in the same transaction as the sale's row is locked). */
  private async invoiceNumber(sale: SaleRow, country: string) {
    if (sale.invoiceNumber) return sale.invoiceNumber;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM "pos_sales" WHERE "id" = ${sale.id}::uuid FOR UPDATE`;
      const row = await tx.posSale.findUniqueOrThrow({ where: { id: sale.id }, select: { invoiceNumber: true } });
      if (row.invoiceNumber) return row.invoiceNumber;
      const [claimed] = await tx.$queryRaw<Array<{ n: number }>>`UPDATE "pos_shops" SET "invoice_next" = "invoice_next" + 1, "updated_at" = NOW() WHERE "id" = ${sale.shopId}::uuid RETURNING "invoice_next" - 1 AS "n"`;
      const year = new Intl.DateTimeFormat('en-GB', { timeZone: marketZone(country), year: 'numeric' }).format(new Date());
      const number = `INV-${year}-${String(claimed!.n).padStart(4, '0')}`;
      await tx.posSale.update({ where: { id: sale.id }, data: { invoiceNumber: number, invoiceIssuedAt: new Date() } });
      return number;
    });
  }

  /** The owner's seller page on udozo.com, as receipts print it (without the scheme). */
  private async online(account: Account) {
    const owner = await this.prisma.customer.findUnique({ where: { id: account.customerId }, select: { username: true, sellerHandle: true } });
    const key = owner?.username ?? owner?.sellerHandle;
    return key ? `${this.site.replace(/^https?:\/\//, '')}/${account.country.toLowerCase()}/seller/${key}` : null;
  }

  private async data(account: Account, sale: SaleRow, kind: ReceiptKind, qr: Buffer | null): Promise<ReceiptData> {
    const zone = marketZone(account.country);
    const when = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at).replace(',', '');
    const day = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(at);
    const shop = sale.shop;
    return {
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        email: shop.email,
        tin: shop.tin,
        footer: shop.receiptFooter,
        bank: shop.bankName && shop.bankAccountName && shop.bankAccountNumber ? { name: shop.bankName, accountName: shop.bankAccountName, accountNumber: shop.bankAccountNumber } : null,
        online: await this.online(account),
      },
      number: sale.number,
      invoiceNumber: kind === 'invoice' ? await this.invoiceNumber(sale, account.country) : sale.invoiceNumber,
      when: when(sale.createdAt),
      day: day(sale.createdAt),
      till: sale.tillName,
      cashier: shortName(sale.soldByName),
      currency: sale.currency,
      refunded: sale.status === 'refunded' && sale.refundedAt ? { when: day(sale.refundedAt), reason: sale.refundReason } : null,
      items: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: Number(sale.subtotalMinor),
      discount: Number(sale.discountMinor),
      vatBps: sale.vatBps,
      vat: Number(sale.vatMinor),
      total: Number(sale.totalMinor),
      change: Number(sale.changeMinor),
      lines: sale.lines.map(line => ({ title: line.title, sku: line.sku, quantity: line.quantity, unitPrice: Number(line.unitPriceMinor), discount: Number(line.discountMinor), total: Number(line.totalMinor) })),
      payments: sale.payments.map(payment => ({ method: payment.method, amount: Number(payment.amountMinor), tendered: payment.tenderedMinor === null ? null : Number(payment.tenderedMinor), change: Number(payment.changeMinor), reference: payment.reference })),
      customer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone ? maskPhone(sale.customer.phone) : null, email: null } : null,
      qr,
    };
  }

  private async render(account: Account, sale: SaleRow, kind: ReceiptKind, options: { width?: ReceiptWidth; gift?: boolean; qrText?: string | null }) {
    const qr = options.qrText ? await QRCode.toBuffer(options.qrText, { errorCorrectionLevel: 'M', margin: 1, width: 300 }) : null;
    const data = await this.data(account, sale, kind, qr);
    const bytes = kind === 'invoice' ? await invoicePdf(data) : await receiptPdf(data, { width: options.width ?? 80, gift: options.gift });
    const name = kind === 'invoice' ? `Invoice-${data.invoiceNumber ?? sale.number}.pdf` : `Receipt-${sale.number}${options.gift ? '-gift' : ''}.pdf`;
    return { bytes, name, contentType: 'application/pdf' as const };
  }

  /**
   * The receipt or invoice as a PDF, for the till to print or download: its paper width (the till's, else 80 mm), a gift
   * receipt without prices, and the WhatsApp QR code where the shop prints it and WhatsApp is open.
   */
  async pdf(customer: CustomerWithStore, id: string, options: { kind?: ReceiptKind; width?: ReceiptWidth; gift?: boolean }, scope: SalesScope = {}) {
    const { account, sale } = await this.sale(customer, id, scope);
    const kind = options.kind ?? 'receipt';
    const qrText = sale.shop.receiptQr && (await this.whatsappOpen(account.country)) ? this.codeText(sale.number, await this.printCode(account, sale, kind)).whatsapp_url : null;
    const width = options.width ?? (sale.till?.printerWidth === 58 ? 58 : 80);
    return this.render(account, sale, kind, { width, gift: options.gift, qrText });
  }

  /**
   * What the till's receipt screen needs: how it can go (WhatsApp, email, print with the till's paper and the printed
   * QR code's words), the customer's number and email to offer, and what was sent.
   */
  async overview(customer: CustomerWithStore, id: string, scope: SalesScope = {}) {
    const { account, sale } = await this.sale(customer, id, scope);
    const whatsapp = await this.whatsappOpen(account.country);
    const printed = sale.shop.receiptQr && whatsapp ? this.codeText(sale.number, await this.printCode(account, sale, 'receipt')) : null;
    return {
      object: 'pos_receipts' as const,
      sale_id: sale.id,
      number: sale.number,
      invoice_number: sale.invoiceNumber,
      whatsapp: { available: whatsapp, reason: whatsapp ? null : 'Receipts on WhatsApp are not open in your country yet.' },
      email: { available: true },
      print: {
        width: sale.till?.printerWidth === 58 ? 58 : 80,
        auto_print: sale.till?.autoPrint ?? false,
        /** The printed receipt's QR code: the words it sends on WhatsApp and the link that fills them in. */
        qr: printed,
      },
      shop: { name: sale.shop.name, address: sale.shop.address, phone: sale.shop.phone, tin: sale.shop.tin, email: sale.shop.email, footer: sale.shop.receiptFooter, online: await this.online(account) },
      customer: sale.customer ? { id: sale.customer.id, name: sale.customer.name, phone: sale.customer.phone, email: sale.customer.email } : null,
      sends: await this.sends(sale.id),
    };
  }

  /** What was sent for a sale, newest first, a WhatsApp send's state read from its message. */
  private async sends(saleId: string) {
    const rows = await this.prisma.posReceiptSend.findMany({ where: { saleId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const messageIds = rows.map(row => row.whatsappMessageId).filter((value): value is string => Boolean(value));
    const messages = messageIds.length ? await this.prisma.whatsappMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, status: true, error: true, kind: true } }) : [];
    const byId = new Map(messages.map(message => [message.id, message]));
    return rows.map(row => this.presentSend(row, row.whatsappMessageId ? (byId.get(row.whatsappMessageId) ?? null) : null));
  }

  private presentSend(row: { id: string; kind: string; via: string; toHint: string; status: string; error: string | null; byName: string | null; createdAt: Date }, message: { status: string; error: string | null; kind: string } | null) {
    const status = message ? whatsappStatus(message.status) : row.status;
    const error = message?.status === 'failed' ? (whatsappProblem[message.error ?? ''] ?? 'WhatsApp could not deliver it.') : row.error;
    return {
      object: 'pos_receipt_send' as const,
      id: row.id,
      kind: row.kind,
      via: row.via,
      to: row.toHint,
      /** `sending`, `sent`, `delivered`, `read` or `failed` (WhatsApp); `sent` or `failed` (email). */
      status,
      /** A template went in its place (outside WhatsApp's 24-hour window): they tap Get receipt to have the PDF. */
      template: message?.kind === 'template',
      error,
      by: row.byName,
      created_at: row.createdAt.toISOString(),
    };
  }

  private async withinLimit(saleId: string) {
    const sent = await this.prisma.posReceiptSend.count({ where: { saleId, via: { in: ['whatsapp', 'email'] }, createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) } } });
    if (sent >= maxSendsPerDay) throw tooMany();
  }

  /** A code to show at the till as a QR: the customer scans it, sends the words, and gets the PDF (10 minutes). */
  async screenCode(customer: CustomerWithStore, id: string, kind: ReceiptKind, scope: SalesScope = {}) {
    const { account, sale } = await this.sale(customer, id, scope);
    if (!(await this.whatsappOpen(account.country))) throw whatsappClosed();
    const code = randomCode();
    const row = await this.prisma.posReceiptCode.create({ data: { accountId: account.id, saleId: sale.id, kind, purpose: 'screen', tokenHash: sha256(code), expiresAt: new Date(Date.now() + codeLifetimes.screen) } });
    return { ...this.presentCode(row), ...this.codeText(sale.number, code) };
  }

  /** Whether the customer has had it yet (the till asks every few seconds while the QR code is shown). */
  async code(customer: CustomerWithStore, id: string, codeId: string, scope: SalesScope = {}) {
    const { sale } = await this.sale(customer, id, scope);
    const row = await this.prisma.posReceiptCode.findFirst({ where: { id: codeId, saleId: sale.id } });
    if (!row) throw notFound('receipt code');
    return this.presentCode(row);
  }

  private presentCode(row: { id: string; kind: string; purpose: string; expiresAt: Date; usedAt: Date | null; deliveredTo: string | null }) {
    return { object: 'pos_receipt_code' as const, id: row.id, kind: row.kind, purpose: row.purpose, expires_at: row.expiresAt.toISOString(), used_at: row.usedAt?.toISOString() ?? null, delivered_to: row.deliveredTo };
  }

  /**
   * The PDF to a number the cashier typed (the shop's country's mobile). Inside WhatsApp's 24-hour window it goes at
   * once; outside it the `udozo_pos_receipt` template goes, its Get receipt button bringing the PDF (a code working 7
   * days). `save_to_customer` keeps the number on the sale's customer when they have none.
   */
  async sendWhatsapp(customer: CustomerWithStore, id: string, input: { phone: string; kind?: ReceiptKind; save_to_customer?: boolean }, options: { by?: PosBy; scope?: SalesScope; canSave?: boolean } = {}) {
    const { account, sale } = await this.sale(customer, id, options.scope);
    if (!(await this.whatsappOpen(account.country))) throw whatsappClosed();
    const phone = normalisePhone(input.phone, account.country);
    await this.withinLimit(sale.id);
    const waId = phone.replace(/\D/g, '');
    const contact = await this.prisma.whatsappContact.upsert({ where: { waId }, create: { waId, country: countryOfNumber(waId) }, update: {} });
    if (contact.optedOutAt) throw conflict('whatsapp_opted_out', 'This number asked Udozo not to message it on WhatsApp. Print the receipt, or email it.', 'phone');
    const kind = input.kind ?? 'receipt';
    const code = randomCode();
    await this.prisma.posReceiptCode.create({ data: { accountId: account.id, saleId: sale.id, kind, purpose: 'whatsapp', tokenHash: sha256(code), expiresAt: new Date(Date.now() + codeLifetimes.whatsapp), deliveredTo: maskPhone(phone) } });
    const fallback = { name: 'udozo_pos_receipt' as const, params: [sale.shop.name, sale.number, formatMoney(sale.totalMinor, sale.currency)], payload: `rcpt:${code}` };
    let message: Parameters<WhatsappOutbox['queue']>[1];
    if (windowOpen(contact)) {
      const file = await this.render(account, sale, kind, {});
      const mediaId = await this.upload(file);
      message = { type: 'document', id: mediaId, filename: file.name, caption: this.caption(sale, kind) };
    } else message = { type: 'text', body: this.caption(sale, kind) };
    const messageId = await this.outbox.queue(contact.id, message, { fallback });
    const by = options.by ?? ownerBy(customer);
    const send = await this.prisma.posReceiptSend.create({ data: { accountId: account.id, saleId: sale.id, kind, via: 'whatsapp', toHint: maskPhone(phone), status: 'queued', whatsappMessageId: messageId, byName: by.name.slice(0, 120), byStaffId: by.staffId } });
    if (input.save_to_customer && options.canSave !== false && sale.customer && !sale.customer.phone) await this.prisma.posCustomer.update({ where: { id: sale.customer.id }, data: { phone } });
    return this.presentSend(send, await this.prisma.whatsappMessage.findUnique({ where: { id: messageId }, select: { status: true, error: true, kind: true } }));
  }

  /** The receipt, the invoice or both to an email address, attached as PDFs, in the shop's name through Udozo's email. */
  async sendEmail(customer: CustomerWithStore, id: string, input: { email: string; attach?: 'receipt' | 'invoice' | 'both'; save_to_customer?: boolean }, options: { by?: PosBy; scope?: SalesScope; canSave?: boolean } = {}) {
    const { account, sale } = await this.sale(customer, id, options.scope);
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw invalid('parameter_invalid', 'Enter a valid email address.', 'email');
    await this.withinLimit(sale.id);
    const attach = input.attach ?? 'receipt';
    const kinds: ReceiptKind[] = attach === 'both' ? ['receipt', 'invoice'] : [attach];
    const files = [];
    for (const kind of kinds) files.push(await this.render(account, sale, kind, {}));
    const by = options.by ?? ownerBy(customer);
    const data = await this.data(account, sale, 'receipt', null);
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      await this.email.send(posReceiptEmail({ to: email, shop: sale.shop.name, number: sale.number, total: formatMoney(sale.totalMinor, sale.currency), when: data.when, invoice: attach === 'invoice', attachments: files.map(file => ({ filename: file.name, content: file.bytes, contentType: file.contentType })) }));
    } catch (err) {
      this.logger.warn({ err, sale: sale.id }, 'Could not email a POS receipt');
      status = 'failed';
      error = 'The email could not be sent. Try again in a minute.';
    }
    const send = await this.prisma.posReceiptSend.create({ data: { accountId: account.id, saleId: sale.id, kind: attach, via: 'email', toHint: maskEmail(email), status, error, byName: by.name.slice(0, 120), byStaffId: by.staffId } });
    if (status === 'sent' && input.save_to_customer && options.canSave !== false && sale.customer && !sale.customer.email) await this.prisma.posCustomer.update({ where: { id: sale.customer.id }, data: { email } });
    return this.presentSend(send, null);
  }

  private caption(sale: SaleRow, kind: ReceiptKind) {
    return `${kind === 'invoice' ? 'Your invoice' : 'Thanks for shopping at'} ${kind === 'invoice' ? `from ${sale.shop.name}` : `${sale.shop.name}! Here is your receipt`}: ${sale.number}, ${formatMoney(sale.totalMinor, sale.currency)}.`;
  }

  private upload(file: { bytes: Buffer; name: string; contentType: string }) {
    return this.outbox.cloud().upload(file.bytes, file.contentType, file.name);
  }

  /**
   * A receipt asked for on WhatsApp: the words a QR code filled in (`number` must be its sale's), or a template's button
   * (`kind`: Send the A4 invoice). Sends the PDF; words to say instead when it cannot.
   */
  private async fromCode(asker: ReceiptAsker, code: string, ask: { number?: string; kind?: ReceiptKind }) {
    const row = await this.prisma.posReceiptCode.findUnique({ where: { tokenHash: sha256(code.toUpperCase()) }, include: { sale: { include: saleInclude }, account: { select: { id: true, customerId: true, country: true, currency: true, mode: true } } } });
    if (!row || (ask.number && row.sale.number !== ask.number)) return 'We could not find that receipt. Check the code on it, or ask the shop to send it again.';
    if (row.expiresAt <= new Date()) return `That receipt code has expired. Ask ${row.sale.shop.name} to send it again.`;
    if (!(await this.contacts.openIn(row.account.country))) return 'Receipts on WhatsApp are not open in this country yet. Ask the shop for a printed copy.';
    if (row.usedCount >= maxCodeUses) return `That receipt has been sent many times already. Ask ${row.sale.shop.name} for it again.`;
    const kind = ask.kind ?? (row.kind as ReceiptKind);
    let mediaId: string;
    let name: string;
    try {
      const file = await this.render(row.account, row.sale, kind, {});
      name = file.name;
      mediaId = await this.upload(file);
    } catch (error) {
      this.logger.warn({ err: error, sale: row.saleId }, 'Could not upload a POS receipt to WhatsApp');
      return 'We could not send your receipt just now. Try again in a minute.';
    }
    const messageId = await this.outbox.queue(asker.contactId, { type: 'document', id: mediaId, filename: name, caption: this.caption(row.sale, kind) });
    if (kind === 'receipt') await this.outbox.queue(asker.contactId, { type: 'buttons', body: 'Want the A4 invoice too?', buttons: [{ id: `rinv:${code.toUpperCase()}`, title: 'Send the A4 invoice' }] });
    const to = maskPhone(`+${asker.waId}`);
    await this.prisma.posReceiptCode.update({ where: { id: row.id }, data: { usedCount: { increment: 1 }, usedAt: row.usedAt ?? new Date(), deliveredTo: to } });
    await this.prisma.posReceiptSend.create({ data: { accountId: row.accountId, saleId: row.saleId, kind, via: 'qr', toHint: to, status: 'queued', whatsappMessageId: messageId, byName: 'Customer' } });
    return null;
  }
}
