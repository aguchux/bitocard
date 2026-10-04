import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import webpush from 'web-push';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Device, Notification, NotificationAudience, Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { notificationTypes, type NotificationType } from './inbox.js';

/** After the first try: 1 minute, 5 minutes, 30 minutes; then it is given up (a push is only useful while fresh). */
export const pushRetryMs = [60_000, 5 * 60_000, 30 * 60_000];
const maxAttempts = pushRetryMs.length + 1;
/** How long a claimed delivery is left alone while it is being sent. */
const leaseMs = 60_000;
const timeoutMs = 10_000;
/** Push services keep an undelivered message this long (the browser may be offline). */
const ttlSeconds = 24 * 3600;
/** A person's most devices: registering another drops the one seen least recently. */
const maxDevicesPerPerson = 20;
/** A device whose pushes keep being refused is dropped. */
const maxDeviceFailures = 3;

/**
 * Browser push services BitoCard sends to (Chrome and Edge via FCM, Firefox, Safari, Windows). A subscription naming
 * any other address is refused, so a registration can never make the API call an arbitrary server.
 */
const pushHosts = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export function pushEndpointAllowed(endpoint: string, allowAnyHost: boolean) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (allowAnyHost) return url.protocol === 'https:' || url.protocol === 'http:';
  return url.protocol === 'https:' && !url.port && pushHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

const base64url = /^[A-Za-z0-9_-]+$/;
const decodedLength = (value: string) => (base64url.test(value) ? Buffer.from(value, 'base64url').length : -1);

/**
 * Staff: pushed by default for warnings, urgent ones and security notices; urgent and security are always pushed.
 * Customers: each type says (`push`, `locked`), since what a customer wants on their phone (their order is ready)
 * differs from what staff do.
 */
export function pushDefault(type: NotificationType) {
  const definition = notificationTypes[type];
  if (definition.realm === 'customer') return { push: definition.push, locked: 'locked' in definition && definition.locked === true };
  return {
    push: definition.realm === 'personal' || definition.severity === 'warning' || definition.severity === 'critical',
    locked: definition.realm === 'personal' || definition.severity === 'critical',
  };
}

/** "Chrome on Windows" from a user agent, for people to recognise their devices. */
export function deviceLabel(userAgent: string | null | undefined) {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Whose devices and preferences: a user (admins, reseller staff) or a storefront customer. */
export type PushOwner = { userId: string } | { customerId: string };

/**
 * The signed-in recipient registering or managing devices: who they are, their audience, their session, and (admins)
 * their roles or (customers) their store.
 */
export type PushCaller = { owner: PushOwner; audience: NotificationAudience; sessionId: string; adminRoles?: string[]; storeId?: string };

const ownerWhere = (owner: PushOwner) => ('userId' in owner ? { userId: owner.userId } : { customerId: owner.customerId });
const ownerKey = (row: { userId: string | null; customerId: string | null }) => row.userId ?? `customer:${row.customerId}`;

type SendResult = { ok: true } | { ok: false; gone: boolean; retry: boolean; error: string };

/**
 * Push notifications to registered devices (Web Push). Every in-app notification is also pushed, once, to each of the
 * recipient's devices whose session is still signed in, if their preferences say so. Sending happens after the reply
 * and is retried briefly by the `push` job; a push never holds up or undoes the change behind it. Payloads are
 * encrypted end to end (only the browser can read them) and carry what the inbox shows, never codes or PINs.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** The VAPID keys, or null while push is switched off. */
  private vapid() {
    const config = this.integrations.config;
    return config.WEB_PUSH_PUBLIC_KEY && config.WEB_PUSH_PRIVATE_KEY
      ? { subject: config.WEB_PUSH_SUBJECT, publicKey: config.WEB_PUSH_PUBLIC_KEY, privateKey: config.WEB_PUSH_PRIVATE_KEY }
      : null;
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Push notifications are not available yet.');
    return new Encryption(key);
  }

  /** What a browser needs to subscribe. */
  settings() {
    const vapid = this.vapid();
    return { object: 'push_settings' as const, enabled: vapid !== null, public_key: vapid?.publicKey ?? null };
  }

  // -- Devices ---------------------------------------------------------------------------------------------------

  /** Registers this browser for the signed-in person (or moves it to them, if someone else used it before). */
  async register(caller: PushCaller, input: { endpoint: string; keys: { p256dh: string; auth: string }; label?: string }, userAgent?: string | null) {
    if (!this.vapid()) throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'push_not_configured', 'Push notifications are not switched on yet.');
    if (!pushEndpointAllowed(input.endpoint, this.integrations.env.WEBHOOK_ALLOW_PRIVATE_URLS)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'push_endpoint_invalid', 'This browser’s push service is not supported.', 'endpoint');
    }
    if (decodedLength(input.keys.p256dh) !== 65 || decodedLength(input.keys.auth) !== 16) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'push_keys_invalid', 'The subscription keys are not valid.', 'keys');
    }
    if (caller.audience === 'customer' && !caller.storeId) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'store_required', 'Customers register on their store.');
    const data = {
      audience: caller.audience,
      userId: 'userId' in caller.owner ? caller.owner.userId : null,
      customerId: 'customerId' in caller.owner ? caller.owner.customerId : null,
      storeId: caller.audience === 'customer' ? caller.storeId! : null,
      sessionId: caller.sessionId,
      keysEncrypted: this.encryption().encrypt(JSON.stringify(input.keys)),
      label: (input.label?.trim() || deviceLabel(userAgent)).slice(0, 80),
      failures: 0,
      lastSeenAt: new Date(),
    };
    const device = await this.prisma.device.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
    const extra = await this.prisma.device.findMany({ where: ownerWhere(caller.owner), orderBy: { lastSeenAt: 'desc' }, skip: maxDevicesPerPerson, select: { id: true } });
    if (extra.length) await this.prisma.device.deleteMany({ where: { id: { in: extra.map(item => item.id) } } });
    return this.present(device, caller.sessionId);
  }

  async list(caller: PushCaller) {
    const devices = await this.prisma.device.findMany({ where: ownerWhere(caller.owner), orderBy: { lastSeenAt: 'desc' } });
    return { object: 'list' as const, data: devices.map(device => this.present(device, caller.sessionId)) };
  }

  async remove(caller: PushCaller, id: string) {
    const removed = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.device.deleteMany({ where: { id, ...ownerWhere(caller.owner) } }) : { count: 0 };
    if (removed.count === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such device.');
  }

  /** Sends a test push to one of the person's devices now, and says whether the push service accepted it. */
  async test(caller: PushCaller, id: string) {
    const device = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.device.findFirst({ where: { id, ...ownerWhere(caller.owner) } }) : null;
    if (!device) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such device.');
    const result = await this.send(device, {
      id: `test-${Date.now()}`,
      type: 'test',
      title: 'Push notifications are on',
      body: `${device.label} will get your notifications.`,
      severity: 'info',
      link: '/notifications',
      mode: null,
      account: null,
      icon: await this.iconFor(device.storeId),
    });
    await this.recordResult(device, result);
    return { object: 'push_test' as const, sent: result.ok, error: result.ok ? null : result.error };
  }

  present(device: Device, sessionId?: string) {
    return {
      object: 'device' as const,
      id: device.id,
      channel: device.channel,
      label: device.label,
      /** Registered from the session making this request (this browser). */
      current: device.sessionId === sessionId,
      last_pushed_at: device.lastPushedAt?.toISOString() ?? null,
      last_seen_at: device.lastSeenAt.toISOString(),
      created_at: device.createdAt.toISOString(),
    };
  }

  // -- Preferences -----------------------------------------------------------------------------------------------

  /** The notification types this person can receive (by realm and roles), each with whether it is pushed. */
  async preferences(caller: PushCaller) {
    const types = await this.typesFor(caller);
    const chosen = new Map((await this.prisma.notificationPreference.findMany({ where: ownerWhere(caller.owner) })).map(row => [row.type, row.push]));
    return {
      object: 'list' as const,
      data: types.map(type => {
        const { push, locked } = pushDefault(type);
        return {
          object: 'notification_preference' as const,
          type,
          label: notificationTypes[type].label,
          severity: notificationTypes[type].severity,
          push: locked ? true : (chosen.get(type) ?? push),
          default: push,
          locked,
        };
      }),
    };
  }

  async setPreference(caller: PushCaller, type: string, push: boolean) {
    const types = await this.typesFor(caller);
    if (!types.includes(type as NotificationType)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'You do not get this notification.', 'type');
    if (pushDefault(type as NotificationType).locked && !push) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'preference_locked', 'Urgent and security notifications are always pushed.', 'push');
    }
    const where: Prisma.NotificationPreferenceWhereUniqueInput =
      'userId' in caller.owner ? { userId_type: { userId: caller.owner.userId, type } } : { customerId_type: { customerId: caller.owner.customerId, type } };
    await this.prisma.notificationPreference.upsert({ where, create: { ...ownerWhere(caller.owner), type, push }, update: { push } });
    return (await this.preferences(caller)).data.find(item => item.type === type)!;
  }

  private async typesFor(caller: PushCaller): Promise<NotificationType[]> {
    const all = Object.keys(notificationTypes) as NotificationType[];
    if (caller.audience === 'customer' || !('userId' in caller.owner)) return all.filter(type => notificationTypes[type].realm === 'customer');
    if (caller.audience === 'admin') {
      const adminRoles = caller.adminRoles ?? [];
      const superAdmin = adminRoles.includes('super_admin');
      return all.filter(type => {
        const definition = notificationTypes[type];
        return definition.realm === 'admin' && (superAdmin || (definition.roles as string[]).some(role => adminRoles.includes(role)));
      });
    }
    const roles = new Set((await this.prisma.resellerMember.findMany({ where: { userId: caller.owner.userId }, select: { role: true } })).map(row => row.role as string));
    return all.filter(type => {
      const definition = notificationTypes[type];
      if (definition.realm === 'personal') return true;
      return definition.realm === 'reseller' && (roles.has('owner') || (definition.roles as string[]).some(role => roles.has(role)));
    });
  }

  // -- Delivery --------------------------------------------------------------------------------------------------

  /**
   * Queues each new notification for its recipient's devices (where their preferences push it) and starts sending
   * after the reply. Never throws.
   */
  async enqueue(notifications: Notification[]) {
    try {
      if (!this.vapid() || notifications.length === 0) return;
      const userIds = [...new Set(notifications.flatMap(row => (row.userId ? [row.userId] : [])))];
      const customerIds = [...new Set(notifications.flatMap(row => (row.customerId ? [row.customerId] : [])))];
      const owners = { OR: [{ userId: { in: userIds } }, { customerId: { in: customerIds } }] };
      const [devices, preferences] = await Promise.all([
        this.prisma.device.findMany({ where: owners, select: { id: true, userId: true, customerId: true, storeId: true } }),
        this.prisma.notificationPreference.findMany({ where: owners }),
      ]);
      const pushed = (row: Notification) => {
        const type = row.type as NotificationType;
        if (!notificationTypes[type]) return false;
        const { push, locked } = pushDefault(type);
        return locked || (preferences.find(item => ownerKey(item) === ownerKey(row) && item.type === type)?.push ?? push);
      };
      // A customer's device only gets their notifications from the store it subscribed on.
      const matches = (row: Notification, device: (typeof devices)[number]) => ownerKey(device) === ownerKey(row) && (!row.customerId || device.storeId === row.storeId);
      const data = notifications.filter(pushed).flatMap(row => devices.filter(device => matches(row, device)).map(device => ({ notificationId: row.id, deviceId: device.id })));
      if (data.length === 0) return;
      const created = await this.prisma.pushDelivery.createManyAndReturn({ data, skipDuplicates: true, select: { id: true } });
      waitUntil(Promise.all(created.map(item => this.deliver(item.id))).catch(error => this.logger.error({ err: error }, 'Push delivery failed')));
    } catch (error) {
      this.logger.error({ err: error }, 'Could not queue push notifications');
    }
  }

  /** Every 5 minutes: retries deliveries that are due, and gives up on stale ones. Safe to run twice. */
  async runDue(now = new Date()) {
    const due = await this.prisma.pushDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 200,
      select: { id: true },
    });
    const outcome = { sent: 0, retrying: 0, failed: 0 };
    for (const { id } of due) {
      const status = await this.deliver(id, now);
      if (status === 'sent') outcome.sent += 1;
      else if (status === 'pending') outcome.retrying += 1;
      else if (status === 'failed') outcome.failed += 1;
    }
    return outcome;
  }

  /** One try at one delivery. Returns its new status, or null if another worker has it. */
  async deliver(id: string, now = new Date()) {
    const claimed = await this.prisma.pushDelivery.updateMany({
      where: { id, status: 'pending', nextAttemptAt: { lte: now } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + leaseMs) },
    });
    if (claimed.count === 0) return null;
    const delivery = await this.prisma.pushDelivery.findUniqueOrThrow({ where: { id }, include: { notification: true, device: true } });
    const { device, notification } = delivery;
    const finish = (data: { status: 'sent' | 'pending' | 'failed'; lastError?: string | null; nextAttemptAt?: Date; sentAt?: Date }) =>
      this.prisma.pushDelivery.updateMany({ where: { id, attempts: delivery.attempts }, data }).then(() => data.status);

    // Only devices still signed in get pushes; a device whose session ended is dropped.
    if (!(await this.signedIn(device, now))) {
      await this.prisma.device.deleteMany({ where: { id: device.id } });
      return 'failed';
    }
    if (!this.vapid()) return finish({ status: 'failed', lastError: 'Push is switched off' });

    const result = await this.send(device, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      link: notification.link,
      mode: notification.mode,
      // Staff: the reseller account it is about (SHQ opens it). Customers never see reseller IDs.
      account: notification.audience === 'reseller' ? notification.resellerId : null,
      icon: await this.iconFor(notification.storeId),
    });
    await this.recordResult(device, result);
    if (result.ok) return finish({ status: 'sent', lastError: null, sentAt: new Date() });
    if (result.retry && delivery.attempts < maxAttempts) return finish({ status: 'pending', lastError: result.error, nextAttemptAt: new Date(now.getTime() + pushRetryMs[delivery.attempts - 1]) });
    return finish({ status: 'failed', lastError: result.error });
  }

  /**
   * Whether the session that registered the device is still signed in. Staff sessions are in `sessions`. Storefront
   * customers have no sign-in yet (it comes with hosted checkout): until it exists and is checked here, their devices
   * are treated as signed out, so nothing is ever pushed to a customer device that could not be verified.
   */
  private async signedIn(device: Device, now: Date) {
    if (device.audience === 'customer') return false;
    const session = await this.prisma.session.findUnique({ where: { id: device.sessionId }, select: { revokedAt: true, expiresAt: true, userId: true } });
    return Boolean(session && !session.revokedAt && session.expiresAt > now && session.userId === device.userId);
  }

  /** The notification icon: Bitocard's app icon (public/icon-192.png) for staff; for customers their store's logo (never BitoCard's brand), if any. */
  private async iconFor(storeId: string | null) {
    if (!storeId) return '/icon-192.png';
    return (await this.prisma.store.findUnique({ where: { id: storeId }, select: { logoUrl: true } }))?.logoUrl ?? null;
  }

  /** Keeps the device's record: last push, failures; drops it when the push service says it is gone or keeps refusing. */
  private async recordResult(device: Device, result: SendResult) {
    if (result.ok) {
      await this.prisma.device.updateMany({ where: { id: device.id }, data: { lastPushedAt: new Date(), failures: 0 } });
    } else if (result.gone || (!result.retry && device.failures + 1 >= maxDeviceFailures)) {
      await this.prisma.device.deleteMany({ where: { id: device.id } });
    } else if (!result.retry) {
      await this.prisma.device.updateMany({ where: { id: device.id }, data: { failures: { increment: 1 } } });
    }
  }

  /** Encrypts and sends one push (RFC 8291 aes128gcm, VAPID). Never throws. */
  private async send(device: Device, payload: Record<string, unknown> & { severity: string; body: string }): Promise<SendResult> {
    const vapid = this.vapid();
    if (!vapid) return { ok: false, gone: false, retry: false, error: 'Push is switched off' };
    // Checked again before every send, in case the rules tightened since it was registered.
    if (!pushEndpointAllowed(device.endpoint, this.integrations.env.WEBHOOK_ALLOW_PRIVATE_URLS)) return { ok: false, gone: true, retry: false, error: 'Push service not allowed' };
    try {
      const keys = JSON.parse(this.encryption().decrypt(device.keysEncrypted)) as { p256dh: string; auth: string };
      const request = webpush.generateRequestDetails({ endpoint: device.endpoint, keys }, JSON.stringify({ ...payload, body: payload.body.slice(0, 300) }), {
        vapidDetails: vapid,
        TTL: ttlSeconds,
        urgency: payload.severity === 'critical' ? 'high' : 'normal',
        contentEncoding: 'aes128gcm',
      });
      const res = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body as unknown as BodyInit,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 200 && res.status < 300) return { ok: true };
      const error = `HTTP ${res.status}`;
      // 404/410: the subscription no longer exists. 429 and 5xx: try again. Anything else is refused.
      return { ok: false, gone: res.status === 404 || res.status === 410, retry: res.status === 429 || res.status >= 500, error };
    } catch (error) {
      return { ok: false, gone: false, retry: true, error: (error as Error).message.slice(0, 300) };
    }
  }
}
