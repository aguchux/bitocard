import { createHmac } from 'node:crypto';
import { Encryption } from '../common/encryption.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { ProductCategory, StockCode } from '../generated/prisma/client.js';
import { ProviderError } from '../payments/provider-error.js';
import type { Delivery, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';

/** BitoCard's own stock: codes an admin has bought and added (Catalog > Stock), sold like any supplier's offer. */
export const stockSupplier = 'stock';
/** Categories delivered as codes, which can be stocked. */
export const stockCategories = ['gift_cards', 'software'] as const satisfies readonly ProductCategory[];

/** HMAC of a code, so the same code is never stocked twice without keeping it in the clear. */
export const stockCodeHash = (key: string, code: string) => createHmac('sha256', Buffer.from(key, 'base64')).update(code.trim()).digest('hex');

class OutOfStock extends Error {}

/**
 * Fulfils from BitoCard's own stock. Placing an order claims the next codes in one statement (rows locked, others
 * skipped, so two orders never get the same code) and marks them with the order's reference; checking an order
 * returns the codes it claimed, or claims them if the first attempt never committed. Not enough codes is a clear
 * refusal, so the order can move to another supplier or fail and release its hold.
 */
export class StockAdapter implements SupplierAdapter {
  readonly code = stockSupplier;
  /** Never synced: an admin adds the products and codes. */
  readonly syncs: ProductCategory[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionKey: string | undefined,
  ) {}

  configured() {
    return true;
  }

  async catalogue() {
    return [];
  }

  placeOrder(request: FulfilmentRequest) {
    return this.claim(request);
  }

  async orderStatus(request: FulfilmentRequest): Promise<FulfilmentResult> {
    try {
      return await this.claim(request);
    } catch (error) {
      if (error instanceof ProviderError && error.definite) return { status: 'failed', detail: error.message };
      throw error;
    }
  }

  private async claim(request: FulfilmentRequest): Promise<FulfilmentResult> {
    if (!this.encryptionKey) throw new ProviderError(this.code, 'ENCRYPTION_KEY is not configured', false);
    const offer = await this.prisma.supplierProduct.findUnique({ where: { supplierCode_sku: { supplierCode: this.code, sku: request.sku } } });
    if (!offer) throw new ProviderError(this.code, 'no such stock item', true);
    let codes: StockCode[];
    try {
      codes = await this.prisma.$transaction(async tx => {
        const claimed = await tx.stockCode.findMany({ where: { orderReference: request.reference }, orderBy: { seq: 'asc' } });
        if (claimed.length) return claimed;
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "stock_codes" SET "status" = 'sold', "order_reference" = ${request.reference}, "sold_at" = now()
          WHERE "id" IN (
            SELECT "id" FROM "stock_codes" WHERE "offer_id" = ${offer.id}::uuid AND "status" = 'available'
            ORDER BY "seq" LIMIT ${request.quantity} FOR UPDATE SKIP LOCKED
          )
          RETURNING "id"`;
        if (rows.length < request.quantity) throw new OutOfStock();
        // The last code sold takes the offer off sale until more are added.
        const left = await tx.stockCode.count({ where: { offerId: offer.id, status: 'available' } });
        if (left === 0) await tx.supplierProduct.update({ where: { id: offer.id }, data: { available: false } });
        return tx.stockCode.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { seq: 'asc' } });
      });
    } catch (error) {
      if (error instanceof OutOfStock) throw new ProviderError(this.code, `not enough codes in stock for ${request.quantity}`, true);
      throw error;
    }
    const encryption = new Encryption(this.encryptionKey);
    const kind: Delivery['kind'] = request.category === 'software' ? 'licence_key' : 'gift_card';
    return {
      status: 'completed',
      supplierTransactionId: `stock_${request.reference}`,
      deliveries: codes.map(code => ({ kind, code: encryption.decrypt(code.codeEncrypted), ...(code.pinEncrypted ? { pin: encryption.decrypt(code.pinEncrypted) } : {}) })),
    };
  }
}
