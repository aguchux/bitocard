import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { worldwideCategories } from '../catalogue/pricing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type ConnectionRouting, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import type { CatalogueScope, SupplierAdapter } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { connectable } from './connectable.js';
import { ResellerIntegrationsService } from './reseller-integrations.service.js';

const notConnected = () => new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'connection_not_active', 'Connect this supplier, and have it approved, first.');

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
  ) {}

  /** The adapter on an active own connection (live), or null. Only ever for that reseller's own orders. */
  async adapterFor(resellerId: string, integrationId: string): Promise<SupplierAdapter | null> {
    const credentials = await this.connections.credentials(resellerId, integrationId, 'live');
    return credentials ? this.adapters.forAccount(integrationId, credentials) : null;
  }

  /** Fetches the reseller's own catalogue and prices onto BitoCard products. Offers no longer listed become unavailable. */
  async sync(resellerId: string, mode: LedgerMode, integrationId: string) {
    const integration = connectable(integrationId);
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (!integration || integration.kind !== 'supplier' || connection?.status !== 'active') throw notConnected();
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { countryRef: { include: { categories: true } } } });
    const now = new Date();
    const seen = new Set<string>();
    const save = (sku: string, productId: string, offer: { costCurrency: string; costRatio: Prisma.Decimal; costFeeMinor: bigint; meta: Prisma.InputJsonValue | undefined }) => {
      seen.add(sku);
      const data = { productId, ...offer, available: true, syncedAt: now };
      return this.prisma.resellerOffer.upsert({
        where: { connectionId_sku: { connectionId: connection.id, sku } },
        create: { connectionId: connection.id, resellerId, mode, supplierCode: integrationId, sku, ...data },
        update: data,
      });
    };

    try {
      if (mode === 'test') {
        // Simulated: BitoCard's own offers from the same supplier stand in for the reseller's.
        const offers = await this.prisma.supplierProduct.findMany({ where: { supplierCode: integrationId, available: true } });
        for (const offer of offers) {
          await save(offer.sku, offer.productId, { costCurrency: offer.costCurrency, costRatio: offer.costRatio, costFeeMinor: offer.costFeeMinor, meta: (offer.meta ?? undefined) as Prisma.InputJsonValue | undefined });
        }
      } else {
        const adapter = await this.adapterFor(resellerId, integrationId);
        if (!adapter) throw notConnected();
        const enabled = new Set(reseller.countryRef?.categories.filter(item => item.enabled).map(item => item.category) ?? []);
        const scopes = new Map<string, CatalogueScope>();
        for (const category of adapter.syncs.filter(item => enabled.has(item))) {
          const country = worldwideCategories.has(category) ? null : reseller.country;
          scopes.set(`${category}:${country}`, { category, country });
        }
        for (const scope of scopes.values()) {
          for (const item of await adapter.catalogue(scope)) {
            if (seen.has(item.sku)) continue;
            const { product } = await this.suppliers.upsertProduct(item);
            await save(item.sku, product.id, {
              costCurrency: item.costCurrency,
              costRatio: new Prisma.Decimal(item.costRatio),
              costFeeMinor: item.costFee,
              meta: (item.meta ?? undefined) as Prisma.InputJsonValue | undefined,
            });
          }
        }
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
      } catch {
        outcome.failed += 1;
      }
    }
    return outcome;
  }
}
