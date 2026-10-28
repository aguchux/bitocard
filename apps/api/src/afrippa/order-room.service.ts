import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { P2pOrder, P2pOrderMessage } from '../generated/prisma/client.js';
import { checkDocument } from '../kyc/files.js';
import { KycStorage } from '../kyc/storage.js';
import type { Tx } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';

type Party = 'buyer' | 'seller';
type Author = Party | 'afrippa' | 'system';

/** Orders whose room still takes messages: the coins in escrow. */
const writable = ['pending_payment', 'paid', 'appealed'];
export const maxMessageLength = 2000;
/** Files an order's room keeps, at most, and messages a party may send a minute. */
export const maxOrderFiles = 20;
const messagesPerMinute = 20;
/** The other party is told of new messages at most this often. */
const tellEveryMs = 5 * 60_000;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.', 'id');
const closed = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'order_room_closed', 'This order is closed: its room keeps what was said, but takes no more messages.');

/**
 * An Afrippa order's room (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 5): one chat per order between its buyer and
 * seller, for payment questions, receipts and evidence. Afrippa's team reads every room and writes in an open one
 * (shown as "Afrippa", never a person), and the system adds a line at every step of the order. Files (JPEG, PNG or
 * PDF, 4 MB, checked from their bytes, photos stripped of metadata) are sealed in Afrippa's own private bucket under
 * the order and read back only through the API, by the order's parties and Afrippa's admins. While the order is open
 * the parties write; once closed the room is kept, read-only. The other party is told of new messages (at most every
 * five minutes per order).
 */
@Injectable()
export class OrderRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KycStorage,
    private readonly inbox: InboxService,
  ) {}

  private files() {
    return this.storage.forPlatform('afrippa');
  }

  /** The customer's side of the order, else it does not exist for them. */
  private async party(customer: CustomerWithStore, orderId: string): Promise<{ order: P2pOrder; role: Party }> {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    if (order.buyerId === customer.id) return { order, role: 'buyer' };
    if (order.sellerId === customer.id) return { order, role: 'seller' };
    throw notFound();
  }

  async list(customer: CustomerWithStore, orderId: string, after?: string) {
    const { order, role } = await this.party(customer, orderId);
    return this.page(order, after, role);
  }

  async adminList(orderId: string, after?: string) {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    return this.page(order, after, null);
  }

  private async page(order: P2pOrder, after: string | undefined, viewer: Party | null) {
    const since = after ? await this.prisma.p2pOrderMessage.findFirst({ where: { id: after, orderId: order.id }, select: { createdAt: true } }) : null;
    const messages = await this.prisma.p2pOrderMessage.findMany({
      where: { orderId: order.id, ...(since ? { createdAt: { gt: since.createdAt } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return { object: 'list' as const, order_id: order.id, open: writable.includes(order.status), data: messages.map(message => present(message, viewer)) };
  }

  async send(customer: CustomerWithStore, orderId: string, body: string) {
    const { order, role } = await this.party(customer, orderId);
    const text = this.text(body, true)!;
    await this.allowed(order, role, customer.id);
    const message = await this.prisma.p2pOrderMessage.create({ data: { orderId, author: role, authorId: customer.id, body: text } });
    await this.tellOther(order, role);
    return present(message, role);
  }

  /** A receipt or other evidence: the file in base64 (inside Afrippa's signed request), with an optional caption. */
  async attach(customer: CustomerWithStore, orderId: string, input: { file_name: string; content_type: string; data: string; body?: string }) {
    const { order, role } = await this.party(customer, orderId);
    await this.allowed(order, role, customer.id);
    const message = await this.store(order, { author: role, authorId: customer.id }, input);
    await this.tellOther(order, role);
    return present(message, role);
  }

  async adminSend(adminId: string | null, orderId: string, body: string) {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    if (!writable.includes(order.status)) throw closed();
    const message = await this.prisma.p2pOrderMessage.create({ data: { orderId, author: 'afrippa', authorId: adminId, body: this.text(body, true)! } });
    for (const party of [order.buyerId, order.sellerId]) await this.tell(order, party, "Afrippa's team wrote in your order");
    return present(message, null);
  }

  async file(customer: CustomerWithStore, orderId: string, messageId: string) {
    await this.party(customer, orderId);
    return this.read(orderId, messageId);
  }

  async adminFile(orderId: string, messageId: string) {
    return this.read(orderId, messageId);
  }

  /** A line from the system at a step of the order, in the step's own transaction when it has one. */
  system(client: Tx | PrismaService, orderId: string, body: string) {
    return client.p2pOrderMessage.create({ data: { orderId, author: 'system', body } });
  }

  private async read(orderId: string, messageId: string) {
    const message = await this.prisma.p2pOrderMessage.findFirst({ where: { id: messageId, orderId, fileName: { not: null } } });
    if (!message) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such file.', 'file');
    const bytes = await this.files().get(this.files().orderRoomKey(orderId, message.id));
    if (!bytes) throw new ApiError(HttpStatus.GONE, 'invalid_request_error', 'file_deleted', 'This file has been deleted.');
    return { bytes, contentType: message.fileType!, name: message.fileName! };
  }

  private async store(order: P2pOrder, from: { author: Author; authorId: string | null }, input: { file_name: string; content_type: string; data: string; body?: string }) {
    const files = await this.prisma.p2pOrderMessage.count({ where: { orderId: order.id, fileName: { not: null } } });
    if (files >= maxOrderFiles) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_files', `An order keeps up to ${maxOrderFiles} files.`);
    const bytes = Buffer.from(input.data, 'base64');
    const checked = checkDocument(bytes, input.content_type, true);
    if ('problem' in checked) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'file_invalid', checked.problem, 'data');
    const id = randomUUID();
    await this.files().put(this.files().orderRoomKey(order.id, id), checked.bytes);
    // The file's own name, without the folders it came from or control characters.
    const name =
      [...(input.file_name.split(/[\\/]/).pop() ?? '')]
        .filter(character => character >= ' ' && character !== '"')
        .join('')
        .trim()
        .slice(0, 120) || 'file';
    return this.prisma.p2pOrderMessage.create({
      data: {
        id,
        orderId: order.id,
        author: from.author,
        authorId: from.authorId,
        body: this.text(input.body, false),
        fileName: name,
        fileType: checked.contentType,
        fileSize: checked.bytes.length,
        fileWidth: checked.width,
        fileHeight: checked.height,
      },
    });
  }

  private text(body: string | undefined, required: boolean) {
    const text = (body ?? '').trim();
    if (!text) {
      if (required) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write a message.', 'body');
      return null;
    }
    if (text.length > maxMessageLength) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `A message is at most ${maxMessageLength} characters.`, 'body');
    return text;
  }

  /** A party writes while the order is open, at most `messagesPerMinute` a minute. */
  private async allowed(order: P2pOrder, role: Party, customerId: string) {
    if (!writable.includes(order.status)) throw closed();
    const recent = await this.prisma.p2pOrderMessage.count({ where: { orderId: order.id, author: role, authorId: customerId, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= messagesPerMinute) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'chat_rate_limited', 'You are sending messages too quickly. Wait a moment.');
  }

  private tellOther(order: P2pOrder, from: Party) {
    return this.tell(order, from === 'buyer' ? order.sellerId : order.buyerId, from === 'buyer' ? 'The buyer wrote in your order' : 'The seller wrote in your order');
  }

  private async tell(order: P2pOrder, customerId: string, title: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { storeId: true } });
    if (!customer) return;
    // Once per five minutes per order and person: the subject dedupes within that window.
    const window = Math.floor(Date.now() / tellEveryMs);
    await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.p2p.order_message', { subject: `order_message:${order.id}:${window}`, title, body: 'Open the order to read it.', link: `/orders/${order.id}`, mode: order.mode });
  }
}

/** A message from the viewer's side: their own lines are `you`; Afrippa's team is never a person's name. */
function present(message: P2pOrderMessage, viewer: Party | null) {
  return {
    object: 'p2p_order_message' as const,
    id: message.id,
    from: viewer && message.author === viewer ? 'you' : message.author,
    body: message.body,
    file: message.fileName
      ? { name: message.fileName, content_type: message.fileType, size: message.fileSize, width: message.fileWidth, height: message.fileHeight }
      : null,
    created_at: message.createdAt.toISOString(),
  };
}
