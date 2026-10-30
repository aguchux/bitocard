import { Inject, Injectable, Logger } from '@nestjs/common';
import { houseStoreId as rootStoreId } from '../checkout/house-ids.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { CloudflareDns } from '../domains/cloudflare.js';
import { VercelDomains } from '../domains/vercel.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';

/** The zone every hosted store lives under. */
export const storeHostDomain = 'bitocard.com';

/** The `comment` on the Cloudflare records BitoCard makes for stores. */
const recordComment = (storeId: string) => `bitocard:store:${storeId}`;

const sameHost = (a: string, b: string) => a.trim().toLowerCase().replace(/\.$/, '') === b.trim().toLowerCase().replace(/\.$/, '');

type HostConfig = Pick<AppConfig, 'VERCEL_API_TOKEN' | 'VERCEL_TEAM_ID' | 'VERCEL_STOREFRONT_PROJECT' | 'VERCEL_API_URL' | 'CLOUDFLARE_API_TOKEN' | 'CLOUDFLARE_ZONE_ID' | 'CLOUDFLARE_API_URL' | 'STORE_HOST_TARGET'>;

export function storeHostClients(config: HostConfig) {
  return {
    vercel: new VercelDomains({ token: config.VERCEL_API_TOKEN, teamId: config.VERCEL_TEAM_ID, project: config.VERCEL_STOREFRONT_PROJECT, baseUrl: config.VERCEL_API_URL }),
    cloudflare: new CloudflareDns({ token: config.CLOUDFLARE_API_TOKEN, zoneId: config.CLOUDFLARE_ZONE_ID, baseUrl: config.CLOUDFLARE_API_URL }),
    target: config.STORE_HOST_TARGET.trim() || 'cname.vercel-dns.com',
  };
}

/** Test connection: bitocard.com's zone and the storefront project, read with their tokens. Provider errors are thrown. */
export async function checkStoreHosts(config: HostConfig) {
  const { vercel, cloudflare } = storeHostClients(config);
  if (!cloudflare.configured()) return { ok: false, message: 'Set the Cloudflare API token and zone ID first.' };
  if (!vercel.configured()) return { ok: false, message: 'Set the Vercel token and storefront project in Domains (Vercel) first.' };
  const zone = await cloudflare.zone();
  if (zone !== storeHostDomain) return { ok: false, message: `That zone is ${zone}: use the ${storeHostDomain} zone.` };
  const project = await vercel.check();
  return { ok: true, message: `Connected to the ${zone} zone and the ${project} project.` };
}

/** A record at the store's name that BitoCard did not make: never overwritten. */
class HostConflict extends Error {}

/**
 * Each store's address, `<subdomain>.bitocard.com`: a DNS-only CNAME in bitocard.com's Cloudflare zone pointing to
 * Vercel, and the address on the storefront's Vercel project (which issues its certificate). Set up when the store is
 * created or renamed; the `domains` job retries anything pending or failed. Reseller stores and BitoCard's own
 * country stores (`ng`, `gh`, `ke`…) are both hosted this way; only the single root `bitocard` store is skipped (it
 * already is bitocard.com, with no address of its own to set up).
 */
@Injectable()
export class StoreHostsService {
  private readonly logger = new Logger(StoreHostsService.name);
  private readonly clients: () => { vercel: VercelDomains; cloudflare: CloudflareDns; target: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    integrations: IntegrationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.clients = integrations.derive(storeHostClients);
  }

  configured() {
    const { vercel, cloudflare } = this.clients();
    return vercel.configured() && cloudflare.configured();
  }

  /** Sets the store's address up (or moves it after a rename). Never throws: a failure is kept on the store for the job. */
  async sync(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    // Root bitocard.com needs no address, and Afrippa's store is reached on afrippa.com, never a bitocard.com one.
    // Udozo's stores are served on its wildcard (`*.udozo.com` on Vercel), so they need no address of their own.
    if (!store || store.id === rootStoreId || store.platform !== 'bitocard' || this.config.APP_PRODUCT === 'udozo') return null;
    if (!this.configured()) return 'pending' as const;
    const { vercel, cloudflare, target } = this.clients();
    const name = `${store.subdomain}.${storeHostDomain}`;
    try {
      // A rename: the old address is taken down first (only BitoCard's own record), so it can be someone else's later.
      if (store.hostName && store.hostName !== store.subdomain) {
        await vercel.removeFromProject(`${store.hostName}.${storeHostDomain}`);
        if (store.hostRecordId) await cloudflare.deleteRecord(store.hostRecordId);
        await this.prisma.store.update({ where: { id: store.id }, data: { hostName: null, hostRecordId: null } });
      }
      const existing = await cloudflare.records(name);
      const ours = existing.find(record => record.type === 'CNAME' && sameHost(record.content, target));
      const other = existing.find(record => record !== ours);
      if (other) throw new HostConflict(`${name} already has a ${other.type} record in Cloudflare that BitoCard did not make. Remove it, then the store is set up on the next run.`);
      const recordId = ours?.id ?? (await cloudflare.createRecord({ type: 'CNAME', name, content: target, comment: recordComment(store.id) }));
      await vercel.addToProject(name);
      await this.prisma.store.update({
        where: { id: store.id },
        data: { hostStatus: 'ready', hostName: store.subdomain, hostRecordId: recordId, hostError: null, hostSyncedAt: new Date() },
      });
      return 'ready' as const;
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'unknown error').slice(0, 500);
      this.logger.warn({ err: message, store: store.id }, 'Store address not set up');
      await this.prisma.store.update({ where: { id: store.id }, data: { hostStatus: 'failed', hostError: message, hostSyncedAt: new Date() } });
      if (error instanceof HostConflict) {
        await this.inbox.admins('admin.store.address_failed', {
          subject: `${store.id}:${store.subdomain}`,
          title: `${name} is not set up`,
          body: message,
          link: `/resellers/${store.resellerId}`,
        });
      }
      return 'failed' as const;
    }
  }

  /** The `domains` job: stores whose address is pending or failed, oldest attempt first. */
  async job() {
    if (!this.configured()) return { set_up: 0, failed: 0, skipped: 'store addresses not configured' };
    const due = await this.prisma.store.findMany({
      where: { hostStatus: { in: ['pending', 'failed'] }, id: { not: rootStoreId }, platform: 'bitocard' },
      orderBy: [{ hostSyncedAt: { sort: 'asc', nulls: 'first' } }],
      select: { id: true },
      take: 50,
    });
    const outcome = { set_up: 0, failed: 0 };
    for (const { id } of due) {
      if ((await this.sync(id)) === 'ready') outcome.set_up += 1;
      else outcome.failed += 1;
    }
    return outcome;
  }
}
