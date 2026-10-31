import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { readFeatureRules } from '../catalogue/features.js';
import { worldwideCategories } from '../catalogue/pricing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type ConnectionRouting, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import type { CatalogueItem, CatalogueScope, SupplierAdapter } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { chunks, inGroups, offerChanged, offerData, SuppliersService } from '../suppliers/suppliers.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { connectable } from './connectable.js';
import { ResellerIntegrationsService } from './reseller-integrations.service.js';

const notConnected = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'connection_not_active', 'Connect this supplier, and have it approved, first.');

/**
 * Resellers' own supplier accounts as a source (phase 3): their catalogue, synced with their own credentials onto the
 * shared BitoCard products, and when to use it. In the sandbox the catalogue is simulated from BitoCard's offers for the
 * same supplier (the sandbox never calls suppliers).
 */
@Injectable()
export class OwnSuppliersService {
  private readonly logger = new Logger('OwnSuppliers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ResellerIntegrationsService,
    private readonly adapters: SupplierAdapters,
    private readonly suppliers: SuppliersService,
    private readonly inbox: InboxService,
  ) {}

  /** The adapter on an active own connection (live), or null. Only ever for that reseller's own orders. */
  async adapterFor(resellerId: string, integrationId: string): Promise<SupplierAdapter | null> {
    const active = await this.connections.active(resellerId, integrationId, 'live');
    return active ? this.adapters.forAccount(integrationId, active.credentials, active.id) : null;
  }

  /** Fetches the reseller's own catalogue and prices onto BitoCard products. Offers no longer listed become unavailable. */
  async sync(resellerId: string, mode: LedgerMode, integrationId: string) {
    const integration = connectable(integrationId);
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (!integration || integration.kind !== 'supplier' || connection?.status !== 'active') throw notConnected();
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { countryRef: { include: { categories: true } } } });
    const now = new Date();
    const seen = new Set<string>();
    try {
      if (mode === 'test') {
        // Simulated: BitoCard's own offers from the same supplier stand in for the reseller's.
        const offers = await this.prisma.supplierProduct.findMany({ where: { supplierCode: integrationId, available: true } });
        await this.saveOffers(
          connection,
          resellerId,
          mode,
          integrationId,
          offers.map(offer => ({ sku: offer.sku, offer: { productId: offer.productId, costCurrency: offer.costCurrency, costRatio: offer.costRatio, costFeeMinor: offer.costFeeMinor, meta: (offer.meta ?? undefined) as Prisma.InputJsonValue | undefined } })),
          now,
        );
        for (const offer of offers) seen.add(offer.sku);
      } else {
        const adapter = await this.adapterFor(resellerId, integrationId);
        if (!adapter) throw notConnected();
        const enabled = new Set(reseller.countryRef?.categories.filter(item => item.enabled).map(item => item.category) ?? []);
        // The same feature rules as BitoCard's own account with this supplier (DIDWW's numbers, for example).
        const features = adapter.gatedFeatures?.length ? readFeatureRules((await this.prisma.supplier.findUnique({ where: { code: adapter.code } }))?.featureRules) : undefined;
        const scopes = new Map<string, CatalogueScope>();
        for (const category of adapter.syncs.filter(item => enabled.has(item))) {
          const country = worldwideCategories.has(category) ? null : reseller.country;
          scopes.set(`${category}:${country}`, { category, country, ...(features ? { features } : {}) });
        }
        const items: CatalogueItem[] = [];
        const skus = new Set<string>();
        for (const scope of scopes.values()) {
          for (const item of await adapter.catalogue(scope)) {
            if (skus.has(item.sku)) continue;
            skus.add(item.sku);
            items.push(item);
          }
        }
        const { ids } = await this.suppliers.upsertProducts(items);
        await this.saveOffers(connection, resellerId, mode, integrationId, items.map(item => ({ sku: item.sku, offer: offerData(item, ids.get(item.productKey)!) })), now);
        for (const sku of skus) seen.add(sku);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = (error as Error).message.slice(0, 500);
      await this.prisma.resellerConnection.update({ where: { id: connection.id }, data: { lastSyncError: message } });
      this.logger.warn({ err: error, resellerId, integration: integrationId }, 'Own catalogue sync failed');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'own_sync_failed', `Your ${integration.name} catalogue could not be fetched: ${message}`);
    }
    const withdrawn = await this.prisma.resellerOffer.updateMany({ where: { connectionId: connection.id, available: true, sku: { notIn: [...seen] } }, data: { available: false } });
    await this.prisma.resellerConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: now, lastSyncError: null } });
    return { object: 'own_catalogue_sync' as const, integration: integrationId, mode, offers: seen.size, withdrawn: withdrawn.count };
  }

  /** Saves a reseller's own catalogue in batches, like BitoCard's: only what changed is written. */
  private async saveOffers(connection: { id: string }, resellerId: string, mode: LedgerMode, supplierCode: string, entries: Array<{ sku: string; offer: ReturnType<typeof offerData> }>, now: Date) {
    for (const chunk of chunks(entries, 500)) {
      const existing = await this.prisma.resellerOffer.findMany({ where: { connectionId: connection.id, sku: { in: chunk.map(entry => entry.sku) } } });
      const bySku = new Map(existing.map(offer => [offer.sku, offer]));
      const fresh: Prisma.ResellerOfferCreateManyInput[] = [];
      const changed: Array<() => Promise<unknown>> = [];
      const unchanged: string[] = [];
      for (const { sku, offer } of chunk) {
        const old = bySku.get(sku);
        if (!old) fresh.push({ connectionId: connection.id, resellerId, mode, supplierCode, sku, ...offer, available: true, syncedAt: now });
        else if (offerChanged(old, offer)) changed.push(() => this.prisma.resellerOffer.update({ where: { id: old.id }, data: { ...offer, available: true, syncedAt: now } }));
        else unchanged.push(old.id);
      }
      if (fresh.length) await this.prisma.resellerOffer.createMany({ data: fresh, skipDuplicates: true });
      await inGroups(changed);
      if (unchanged.length) await this.prisma.resellerOffer.updateMany({ where: { id: { in: unchanged } }, data: { available: true, syncedAt: now } });
    }
  }

  /** When to use this supplier: before BitoCard's (`preferred`), only when BitoCard has no offer (`fallback`), or never (`off`). */
  async setRouting(resellerId: string, mode: LedgerMode, integrationId: string, routing: ConnectionRouting) {
    const updated = await this.prisma.resellerConnection.updateMany({ where: { resellerId, integrationId, mode, status: { not: 'disconnected' } }, data: { routing } });
    if (updated.count === 0) throw notConnected();
  }

  /** Daily: refreshes every active live own-supplier catalogue. One failing account does not stop the others. */
  async syncAll() {
    const rows = await this.prisma.resellerConnection.findMany({ where: { mode: 'live', status: 'active', routing: { not: 'off' } } });
    const outcome = { synced: 0, failed: 0 };
    for (const row of rows.filter(item => connectable(item.integrationId)?.kind === 'supplier')) {
      try {
        await this.sync(row.resellerId, 'live', row.integrationId);
        outcome.synced += 1;
      } catch (error) {
        outcome.failed += 1;
        const name = connectable(row.integrationId)?.name ?? row.integrationId;
        await this.inbox.reseller(row.resellerId, 'connection.sync_failed', {
          // Once a day at most.
          subject: `${row.id}:${new Date().toISOString().slice(0, 10)}`,
          title: `${name} catalogue not refreshed`,
          body: `${error instanceof ApiError ? error.message : `Your ${name} catalogue could not be fetched.`} Your last synced offers stay in use; check the connection.`,
          link: '/integrations',
          mode: 'live',
        });
      }
    }
    return outcome;
  }
}
