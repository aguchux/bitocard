import { createHmac } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { traderNewDeviceEmail } from '../notifications/templates.js';
import { afrippaStoreId } from './ids.js';

/** The header afrippa.com's server sends a browser's device ID in (from its own `afr_device` cookie). */
export const deviceHeader = 'afrippa-device';
const devicePattern = /^afd_[A-Za-z0-9_-]{43}$/;
/** At most this many Afrippa accounts first seen on one device within `accountWindowMs`. */
export const maxAccountsPerDevice = 3;
const accountWindowMs = 30 * 24 * 3600_000;
/** Two traders who used one device within this long are the same person for an order. */
const sharedWindowMs = 90 * 24 * 3600_000;

/**
 * Afrippa's device checks (docs/CRYPTO_SPINOFF_PLAN.md, fraud controls): afrippa.com keeps a random ID per browser in
 * its own cookie and sends it with every request it signs. Only a keyed hash of it is kept, per trader
 * (`trader_devices`). A sign-in from a device the trader never used tells them (email from Afrippa and a locked notice);
 * the same device on both sides of an order is the same person; one device opening many accounts is refused. A request
 * without a device ID (another client, or an old browser) is never refused for that alone.
 */
@Injectable()
export class TraderDevicesService {
  private readonly logger = new Logger('TraderDevices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
  ) {}

  /** The device's hash from the request, or null when it sent none (or a malformed one). */
  hashOf(req: Pick<Request, 'get'>) {
    const id = req.get(deviceHeader);
    if (!id || !devicePattern.test(id)) return null;
    const key = this.integrations.env.ENCRYPTION_KEY ?? '';
    return createHmac('sha256', Buffer.from(key, 'base64')).update(`afrippa-device:${id}`).digest('hex');
  }

  /** Refuses a sign-up from a device that already opened `maxAccountsPerDevice` accounts within 30 days. */
  async requireRoomForSignup(hash: string | null) {
    if (!hash) return;
    const recent = await this.prisma.traderDevice.findMany({
      where: { deviceHash: hash, firstSeenAt: { gte: new Date(Date.now() - accountWindowMs) }, customer: { storeId: afrippaStoreId } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    if (recent.length >= maxAccountsPerDevice) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'device_limit', 'Too many Afrippa accounts were opened from this device. Sign in to an account you already have.');
    }
  }

  /**
   * Records that a trader used a device; a sign-in from a device they never used before tells them (`alert`), unless it
   * is their first (signing up).
   */
  async seen(customerId: string, hash: string | null, options: { alert?: boolean } = {}) {
    if (!hash) return;
    const now = new Date();
    const known = await this.prisma.traderDevice.findUnique({ where: { customerId_deviceHash: { customerId, deviceHash: hash } } });
    if (known) {
      await this.prisma.traderDevice.update({ where: { id: known.id }, data: { lastSeenAt: now } });
      return;
    }
    const others = await this.prisma.traderDevice.count({ where: { customerId } });
    await this.prisma.traderDevice.createMany({ data: [{ customerId, deviceHash: hash }], skipDuplicates: true });
    if (!options.alert || others === 0) return;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, storeId: true } });
    if (!customer) return;
    await this.email.sendFor('afrippa', traderNewDeviceEmail(customer.email, now)).catch(error => this.logger.warn({ err: error }, 'Could not email a new-device alert'));
    await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.security.new_device', {
      subject: `${customerId}:${hash.slice(0, 16)}`,
      title: 'A new device signed in',
      body: 'Your Afrippa account was signed in on a device you have not used before. If this was not you, change your password at once.',
      link: '/security',
    });
  }

  /** Whether two traders used one device within 90 days (the same person, for an order). */
  async shared(a: string, b: string) {
    const since = new Date(Date.now() - sharedWindowMs);
    const rows = await this.prisma.traderDevice.findMany({ where: { customerId: { in: [a, b] }, lastSeenAt: { gte: since } }, select: { customerId: true, deviceHash: true } });
    const first = new Set(rows.filter(row => row.customerId === a).map(row => row.deviceHash));
    return rows.some(row => row.customerId === b && first.has(row.deviceHash));
  }

  /** A trader's devices for Afrippa's admins: how many, when each was used, and who else used it (never the ID). */
  async forAdmin(customerId: string) {
    const devices = await this.prisma.traderDevice.findMany({ where: { customerId }, orderBy: { lastSeenAt: 'desc' }, take: 50 });
    const sharedWith = await this.prisma.traderDevice.findMany({
      where: { deviceHash: { in: devices.map(device => device.deviceHash) }, customerId: { not: customerId } },
      select: { deviceHash: true, customer: { select: { id: true, email: true } } },
    });
    return {
      object: 'list' as const,
      data: devices.map(device => ({
        object: 'trader_device' as const,
        id: device.id,
        first_seen_at: device.firstSeenAt.toISOString(),
        last_seen_at: device.lastSeenAt.toISOString(),
        shared_with: sharedWith.filter(row => row.deviceHash === device.deviceHash).map(row => ({ id: row.customer.id, email: row.customer.email })),
      })),
    };
  }
}
