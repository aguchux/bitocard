import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { vpnExpiry } from '../suppliers/vpnresellers.adapter.js';

/** A new VPN password: 32 URL-safe characters (192 bits), within every supplier's 6 to 50 character rule. */
export const vpnPassword = () => randomBytes(24).toString('base64url');

export type PreparedVpnCredentials = {
  subscriptionId: string;
  username: string;
  password: string;
  expiresAt: Date;
  credentialVersion: number;
};

/**
 * Creates a VPN username and password before the first supplier request and stores the password in encrypted
 * `OrderDelivery` storage. Asking again for the same order returns the same values, which makes an uncertain supplier
 * create safe to reconcile or retry without inventing a second account or password.
 */
@Injectable()
export class VpnCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async prepare(orderId: string): Promise<PreparedVpnCredentials> {
    const existing = await this.read(orderId);
    if (existing) return existing;

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, resellerId: true, mode: true, productId: true, supplierCode: true, supplierReference: true, status: true },
    });
    if (order.status !== 'processing') throw new Error('VPN credentials can only be prepared for a processing order');
    if (order.supplierCode !== 'vpnresellers') throw new Error('VPN credentials require the VPNresellers supplier');

    const username = `bc-${order.supplierReference.replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 50);
    const password = vpnPassword();
    // The term starts when the paid order is first sent to the supplier; at least 30 full days (`vpnExpiry`).
    const expiresAt = vpnExpiry();
    const codeEncrypted = this.encryption().encrypt(password);
    try {
      await this.prisma.$transaction(async tx => {
        const delivery = await tx.orderDelivery.create({
          data: {
            orderId: order.id,
            kind: 'vpn_account',
            codeEncrypted,
            serial: username,
            details: { credential_version: '1' },
          },
        });
        await tx.vpnSubscription.create({
          data: {
            orderId: order.id,
            deliveryId: delivery.id,
            resellerId: order.resellerId,
            mode: order.mode,
            productId: order.productId,
            supplierCode: order.supplierCode,
            expiresAt,
          },
        });
      });
    } catch (error) {
      // A second worker may have won the unique order constraint. Its committed credentials are authoritative.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }

    const prepared = await this.read(orderId);
    if (!prepared) throw new Error('VPN credentials were not stored');
    return prepared;
  }

  private async read(orderId: string): Promise<PreparedVpnCredentials | null> {
    const subscription = await this.prisma.vpnSubscription.findUnique({ where: { orderId }, include: { delivery: true } });
    if (!subscription) return null;
    if (subscription.delivery.kind !== 'vpn_account' || !subscription.delivery.serial || !subscription.delivery.codeEncrypted) {
      throw new Error('VPN credential delivery is incomplete');
    }
    return {
      subscriptionId: subscription.id,
      username: subscription.delivery.serial,
      password: this.encryption().decrypt(subscription.delivery.codeEncrypted),
      expiresAt: subscription.expiresAt ?? (() => { throw new Error('VPN provisioning expiry is missing'); })(),
      credentialVersion: subscription.credentialVersion,
    };
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }
}
