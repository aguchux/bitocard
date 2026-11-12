import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { DiscoveryRecorder } from './discovery/recorder.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PushService } from '../notifications/push.service.js';
import { ContactRequestsService, listingPath } from './contact.service.js';
import { publicName } from './search.service.js';
import { onlineAmong } from './presence.js';
import { CloudflareTurn, type IceServer } from './turn.js';

export { onlineMs } from './presence.js';

/** Presence is written at most this often per person. */
export const presenceWriteMs = 15_000;
/** A call rings this long before it is missed. */
export const ringMs = 45_000;
/** A side that has not looked at an answered call for this long has gone: the call ends. */
export const quietMs = 30_000;
/** A buyer starts at most this many calls an hour. */
export const callsPerHour = 10;
/** Connection details one call may carry (offers, answers, candidates). */
export const maxSignals = 300;
const maxSdp = 20_000;
const maxCandidate = 1_000;
/** Calls are kept (without their connection details) this long, for the seller's list of calls. */
export const keepCallsMs = 90 * 86_400_000;

const live = ['ringing', 'answered'];
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such call.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const unavailable = () => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'calls_unavailable', 'Calls are not available just now. Chat with the seller, or ask them to call you back.');

const callInclude = {
  listing: { select: { id: true, title: true, country: true, ref: true, slug: true, customerId: true } },
  caller: { select: { id: true, name: true, storeId: true } },
  callee: { select: { id: true, name: true, storeId: true } },
} satisfies Prisma.ClassifiedCallInclude;
type CallRow = Prisma.ClassifiedCallGetPayload<{ include: typeof callInclude }>;

export type SignalInput = { kind: 'offer' | 'answer' | 'candidate'; payload: unknown };

/**
 * Calls in the browser between a buyer and a seller while both are on udozo.com: the buyer rings, the seller's open
 * pages ring (and a push says so), the seller answers or declines, and the two browsers swap their connection details
 * here (polled: no sockets on Vercel). Audio goes through Cloudflare's TURN relay only, so neither side learns the
 * other's phone number or internet address; nothing is recorded.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly inbox: InboxService,
    private readonly contacts: ContactRequestsService,
    private readonly discovery: DiscoveryRecorder,
    private readonly push: PushService,
  ) {}

  private turn() {
    const config = this.integrations.config;
    return new CloudflareTurn({ keyId: config.CLOUDFLARE_TURN_KEY_ID, token: config.CLOUDFLARE_TURN_API_TOKEN, baseUrl: config.CLOUDFLARE_TURN_API_URL });
  }

  /** Whether calls are offered at all (the relay is set up). */
  available() {
    return this.turn().configured();
  }

  /**
   * Whether someone can take a call now: udozo.com open in the last minute, or Udozo's app on a phone that rings even when
   * closed (opened in the last 30 days, still signed in).
   */
  async online(customerId: string) {
    return (await onlineAmong(this.prisma, [customerId])).has(customerId) || (await this.push.ringable([customerId])).has(customerId);
  }

  /** A page says the customer is here (written at most every 15 seconds) and hears of a call ringing for them. */
  async presence(customer: CustomerWithStore) {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO "customer_presence" ("customer_id", "seen_at") VALUES (${customer.id}::uuid, ${now})
      ON CONFLICT ("customer_id") DO UPDATE SET "seen_at" = EXCLUDED."seen_at"
      WHERE "customer_presence"."seen_at" < ${new Date(now.getTime() - presenceWriteMs)}`;
    await this.settle({ calleeId: customer.id, status: 'ringing' });
    const ringing = await this.prisma.classifiedCall.findFirst({ where: { calleeId: customer.id, status: 'ringing' }, include: callInclude, orderBy: { createdAt: 'desc' } });
    return { object: 'classified_presence' as const, calls: this.available(), incoming: ringing ? this.present(ringing, customer.id) : null };
  }

  /** The buyer rings the seller of a listing, who must be on udozo.com now. */
  async start(customer: CustomerWithStore, listingId: string) {
    const listing = await this.contacts.contactable(customer, listingId);
    if (listing.contact === 'chat') throw conflict('calls_not_offered', 'This seller takes messages only: chat with them here.');
    return this.ring(customer, listing, listing.customerId, {
      offline: ['seller_offline', 'The seller is not on Udozo right now. Ask them to call you back, or chat with them here.'],
      busy: ['seller_busy', 'The seller is on another call. Try again in a few minutes, or chat with them here.'],
    });
  }

  /**
   * Either side of a chat calls the other (a seller calling back a buyer too). Never where either blocked the other,
   * and a buyer never calls a seller who takes messages only.
   */
  async startInChat(customer: CustomerWithStore, chatId: string) {
    const chat = await this.prisma.classifiedConversation.findUnique({ where: { id: chatId }, include: { listing: { select: { id: true, country: true, contact: true, status: true } } } });
    if (!chat || (chat.buyerId !== customer.id && chat.sellerId !== customer.id)) throw notFound();
    const buyer = chat.buyerId === customer.id;
    if (chat.buyerBlockedAt || chat.sellerBlockedAt) throw conflict('conversation_blocked', 'You can no longer call in this chat.');
    if (buyer && chat.listing.contact === 'chat') throw conflict('calls_not_offered', 'This seller takes messages only: chat with them here.');
    const other = buyer ? 'seller' : 'buyer';
    return this.ring(customer, chat.listing, buyer ? chat.sellerId : chat.buyerId, {
      offline: [`${other}_offline`, `The ${other} is not on Udozo right now. Write to them here instead.`],
      busy: [`${other}_busy`, `The ${other} is on another call. Try again in a few minutes.`],
    });
  }

  private async ring(customer: CustomerWithStore, listing: { id: string; country: string }, calleeId: string, words: { offline: [string, string]; busy: [string, string] }) {
    if (!this.available()) throw unavailable();
    await this.settle({ OR: [{ callerId: { in: [customer.id, calleeId] } }, { calleeId: { in: [customer.id, calleeId] } }], status: { in: live } });
    if (!(await this.online(calleeId))) throw conflict(...words.offline);
    const recent = await this.prisma.classifiedCall.count({ where: { callerId: customer.id, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= callsPerHour) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'call_limit', `You can make ${callsPerHour} calls an hour. Try again later, or chat with the seller here.`);
    const busy = (id: string) => this.prisma.classifiedCall.findFirst({ where: { status: { in: live }, OR: [{ callerId: id }, { calleeId: id }] }, select: { id: true } });
    if (await busy(customer.id)) throw conflict('call_in_progress', 'You are already in a call. End it first.');
    if (await busy(calleeId)) throw conflict(...words.busy);
    const iceServers = await this.iceServers();
    let call: CallRow;
    try {
      call = await this.prisma.classifiedCall.create({ data: { listingId: listing.id, callerId: customer.id, calleeId, country: listing.country }, include: callInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict(...words.busy);
      throw error;
    }
    // A call to the listing's seller says the caller wanted it (never a seller calling a buyer back).
    if (calleeId === call.listing.customerId) await this.discovery.record(customer.id, listing.country, 'call', listing.id);
    await this.inbox.customer({ customerId: call.callee.id, storeId: call.callee.storeId }, 'customer.classifieds.call_incoming', {
      subject: call.id,
      title: `${publicName(call.caller.name)} is calling you`,
      body: `About “${call.listing.title ?? 'a listing'}”. Open Udozo to answer.`,
      link: call.callee.id === call.listing.customerId ? '/account/requests' : listingPath(call.listing),
    });
    // The callee's phones ring too, the app closed or not: after the reply, never failing the call.
    waitUntil(this.push.ring(call.callee.id, { callId: call.id, caller: publicName(call.caller.name), about: call.listing.title }));
    return { ...this.present(call, customer.id), ice_servers: iceServers };
  }

  /** The call, with the other side's connection details after `after` (polled by both sides). */
  async get(customer: CustomerWithStore, id: string, after?: string) {
    const call = await this.party(customer, id);
    const field = call.callerId === customer.id ? 'callerSeenAt' : 'calleeSeenAt';
    await this.prisma.classifiedCall.updateMany({ where: { id, status: { in: live } }, data: { [field]: new Date() } });
    await this.settle({ id });
    const fresh = await this.prisma.classifiedCall.findUniqueOrThrow({ where: { id }, include: callInclude });
    let since: bigint | undefined;
    if (after !== undefined) {
      if (!/^\d{1,18}$/.test(after)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Give the last signal id you read.', 'after');
      since = BigInt(after);
    }
    const signals = live.includes(fresh.status)
      ? await this.prisma.classifiedCallSignal.findMany({ where: { callId: id, fromId: { not: customer.id }, ...(since !== undefined ? { id: { gt: since } } : {}) }, orderBy: { id: 'asc' }, take: 100 })
      : [];
    return { ...this.present(fresh, customer.id), signals: signals.map(signal => ({ id: signal.id.toString(), kind: signal.kind, payload: signal.payload })) };
  }

  /** The seller answers a ringing call (and gets the relay's credentials). */
  async answer(customer: CustomerWithStore, id: string) {
    const call = await this.party(customer, id);
    if (call.calleeId !== customer.id) throw notFound();
    await this.settle({ id });
    const iceServers = await this.iceServers();
    const now = new Date();
    const claimed = await this.prisma.classifiedCall.updateMany({ where: { id, status: 'ringing' }, data: { status: 'answered', answeredAt: now, calleeSeenAt: now } });
    if (!claimed.count) throw conflict('call_ended', 'The call has ended.');
    // The callee's other phones stop ringing (the one that answered knows it did).
    waitUntil(this.push.hangUp(customer.id, id, 'answered'));
    return { ...this.present(await this.prisma.classifiedCall.findUniqueOrThrow({ where: { id }, include: callInclude }), customer.id), ice_servers: iceServers };
  }

  /** Either side ends it: the caller before an answer cancels, the seller declines, after an answer it ends. */
  async end(customer: CustomerWithStore, id: string) {
    const call = await this.party(customer, id);
    const side = call.callerId === customer.id ? 'caller' : 'callee';
    const now = new Date();
    const status = call.status === 'answered' ? 'ended' : side === 'caller' ? 'cancelled' : 'declined';
    const ended = await this.prisma.classifiedCall.updateMany({ where: { id, status: call.status === 'answered' ? 'answered' : 'ringing' }, data: { status, endedAt: now, endedBy: side } });
    await this.prisma.classifiedCallSignal.deleteMany({ where: { callId: id } });
    if (ended.count && call.status === 'ringing') waitUntil(this.push.hangUp(call.calleeId, id, 'ended'));
    return this.present(await this.prisma.classifiedCall.findUniqueOrThrow({ where: { id }, include: callInclude }), customer.id);
  }

  /** One side's connection detail: its offer or answer, or a network candidate, for the other side to read. */
  async signal(customer: CustomerWithStore, id: string, input: SignalInput) {
    const call = await this.party(customer, id);
    if (!live.includes(call.status)) throw conflict('call_ended', 'The call has ended.');
    const payload = checkSignal(input);
    const count = await this.prisma.classifiedCallSignal.count({ where: { callId: id } });
    if (count >= maxSignals) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'too_many_signals', 'This call cannot take more connection details.');
    const row = await this.prisma.classifiedCallSignal.create({ data: { callId: id, fromId: customer.id, kind: input.kind, payload: payload as Prisma.InputJsonValue } });
    return { object: 'classified_call_signal' as const, id: row.id.toString(), kind: row.kind };
  }

  /** The seller's recent calls (and the buyer's own), newest first. */
  async recent(customer: CustomerWithStore) {
    const rows = await this.prisma.classifiedCall.findMany({ where: { OR: [{ calleeId: customer.id }, { callerId: customer.id }] }, include: callInclude, orderBy: { createdAt: 'desc' }, take: 30 });
    return { object: 'list' as const, data: rows.map(row => this.present(row, customer.id)) };
  }

  /**
   * Calls that ran out: ringing past its time is missed (the seller told), an answered call with a side gone quiet is
   * lost. Each change is claimed once. Run by every look at a call, and by the `classifieds` job for the rest, which also
   * deletes calls past 90 days.
   */
  async settle(where: Prisma.ClassifiedCallWhereInput = { status: { in: live } }) {
    const now = Date.now();
    const due = await this.prisma.classifiedCall.findMany({
      where: { AND: [where, { OR: [{ status: 'ringing', createdAt: { lt: new Date(now - ringMs) } }, { status: 'answered', OR: [{ callerSeenAt: { lt: new Date(now - quietMs) } }, { calleeSeenAt: { lt: new Date(now - quietMs) } }] }] }] },
      include: callInclude,
      take: 200,
    });
    for (const call of due) {
      const status = call.status === 'ringing' ? 'missed' : 'lost';
      const claimed = await this.prisma.classifiedCall.updateMany({ where: { id: call.id, status: call.status }, data: { status, endedAt: new Date(), endedBy: 'udozo' } });
      if (!claimed.count) continue;
      await this.prisma.classifiedCallSignal.deleteMany({ where: { callId: call.id } });
      if (status === 'missed') {
        waitUntil(this.push.hangUp(call.callee.id, call.id, 'ended'));
        await this.inbox.customer({ customerId: call.callee.id, storeId: call.callee.storeId }, 'customer.classifieds.call_missed', {
          subject: call.id,
          title: `You missed a call from ${publicName(call.caller.name)}`,
          body: `About “${call.listing.title ?? 'a listing'}”. Reply in a chat, or stay on Udozo to take their next call.`,
          link: call.callee.id === call.listing.customerId ? '/account/requests' : '/account/messages',
        });
      }
    }
    return due.length;
  }

  /** The job's work: settle what ran out, delete old calls and old answered requests. */
  async job() {
    const settled = await this.settle();
    const { count } = await this.prisma.classifiedCall.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - keepCallsMs) }, status: { notIn: live } } });
    return { settled, deleted: count, old_requests: await this.contacts.purgeOld() };
  }

  private async party(customer: CustomerWithStore, id: string) {
    const call = await this.prisma.classifiedCall.findUnique({ where: { id } });
    if (!call || (call.callerId !== customer.id && call.calleeId !== customer.id)) throw notFound();
    return call;
  }

  private async iceServers(): Promise<IceServer[]> {
    const turn = this.turn();
    if (!turn.configured()) throw unavailable();
    try {
      return await turn.iceServers();
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not make call relay credentials');
      throw unavailable();
    }
  }

  /** A call as one side sees it: the other side by their public name only, never their number or address. */
  present(row: CallRow, viewerId: string) {
    const role = row.callerId === viewerId ? ('caller' as const) : ('callee' as const);
    const other = role === 'caller' ? row.callee : row.caller;
    return {
      object: 'classified_call' as const,
      id: row.id,
      status: row.status,
      role,
      with: { name: publicName(other.name) },
      listing: { id: row.listing.id, title: row.listing.title, path: listingPath(row.listing) },
      ring_until: row.status === 'ringing' ? new Date(row.createdAt.getTime() + ringMs).toISOString() : null,
      answered_at: row.answeredAt?.toISOString() ?? null,
      ended_at: row.endedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}

const bad = (message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, 'payload');

/** Only the fields a browser's connection detail has, within their sizes. */
export function checkSignal(input: SignalInput) {
  const payload = (input.payload ?? null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw bad('Give the connection detail.');
  if (input.kind === 'offer' || input.kind === 'answer') {
    if (payload.type !== input.kind || typeof payload.sdp !== 'string' || !payload.sdp || payload.sdp.length > maxSdp) throw bad('Give the session description.');
    return { type: input.kind, sdp: payload.sdp };
  }
  if (input.kind !== 'candidate') throw bad('Give an offer, an answer or a candidate.');
  const candidate = payload.candidate;
  if (candidate !== null && (typeof candidate !== 'string' || candidate.length > maxCandidate)) throw bad('Give the candidate.');
  const mid = payload.sdpMid;
  const line = payload.sdpMLineIndex;
  const fragment = payload.usernameFragment;
  if (mid !== undefined && mid !== null && (typeof mid !== 'string' || mid.length > 64)) throw bad('Give the candidate.');
  if (line !== undefined && line !== null && (!Number.isInteger(line) || (line as number) < 0 || (line as number) > 64)) throw bad('Give the candidate.');
  if (fragment !== undefined && fragment !== null && (typeof fragment !== 'string' || fragment.length > 256)) throw bad('Give the candidate.');
  return { candidate, sdpMid: mid ?? null, sdpMLineIndex: line ?? null, ...(typeof fragment === 'string' ? { usernameFragment: fragment } : {}) };
}
