import { HttpStatus, Injectable } from '@nestjs/common';
import { shopOrigin } from '../classifieds/listings.service.js';
import { buyOrderHoldingStatuses, holdingStatuses } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { WatermarkService } from '../watermarks/watermarks.service.js';
import { posCountedStatuses, tillBlock } from './catalogue-rules.js';
import { limitsOf } from './plans.js';

export type CatalogueFilter = { q?: string; category?: string; barcode?: string; show?: 'all' | 'sellable' | 'low_stock' | 'out_of_stock' | 'blocked'; limit?: number; offset?: number };
export type ProductBlock = 'plan_limit' | 'not_live' | 'no_price' | 'out_of_stock';

const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');

/**
 * The shop's catalogue at the till (docs/UDOZO_POS_PLAN.md, milestone 2): the owner's listings ticked Sell at POS, read
 * live from udozo.com every time, so a new price, photo or stock shows at once and unticking one takes it off. The stock
 * free to sell is the listing's own less what online buyers hold. When a paid plan lapsed to Free, only the first ticked
 * up to its product limit sell; the rest stay listed and say why.
 */
@Injectable()
export class PosCatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly watermarks: WatermarkService,
  ) {}

  async catalogue(customer: CustomerWithStore, filter: CatalogueFilter) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, include: { plan: true } });
    if (!account) throw noAccount();
    const limit = limitsOf(account.plan).products;

    // Every listing ticked, light, in the order it was ticked: the plan's limit keeps the first ones selling.
    const rows = await this.prisma.classifiedListing.findMany({
      where: { customerId: customer.id, posEnabledAt: { not: null }, status: { in: posCountedStatuses } },
      select: { id: true, ref: true, sku: true, title: true, barcode: true, status: true, priceKind: true, priceMinor: true, saleMethod: true, currency: true, stock: true, reorderLevel: true, categoryId: true, onShop: true, posEnabledAt: true, category: { select: { parentId: true } } },
      orderBy: [{ posEnabledAt: 'asc' }, { id: 'asc' }],
    });
    const held = await this.held(rows.map(row => row.id));
    const products = rows.map((row, index) => {
      const units = held.get(row.id) ?? 0;
      const available = Math.max(0, row.stock - units);
      const block: ProductBlock | null = tillBlock(row, limit === null || index < limit) ?? (available === 0 ? 'out_of_stock' : null);
      const lowStock = row.reorderLevel !== null && row.stock <= row.reorderLevel;
      return { row, held: units, available, block, lowStock };
    });

    const words = filter.q?.trim().toLowerCase();
    const shown = products.filter(({ row, block, lowStock, available }) => {
      if (filter.barcode && row.barcode !== filter.barcode.trim()) return false;
      if (filter.category && row.categoryId !== filter.category && row.category?.parentId !== filter.category) return false;
      if (words && !(row.title ?? '').toLowerCase().includes(words) && !(row.sku ?? '').toLowerCase().includes(words) && row.barcode?.toLowerCase() !== words && String(row.ref) !== words) return false;
      switch (filter.show ?? 'all') {
        case 'sellable':
          return block === null;
        case 'low_stock':
          return lowStock;
        case 'out_of_stock':
          return block === 'out_of_stock' || (block === null && available === 0);
        case 'blocked':
          return block !== null && block !== 'out_of_stock';
        default:
          return true;
      }
    });
    const offset = filter.offset ?? 0;
    const take = filter.limit ?? 50;
    const page = shown.slice(offset, offset + take);

    // The page's categories and first photos.
    const details = await this.prisma.classifiedListing.findMany({
      where: { id: { in: page.map(item => item.row.id) } },
      select: { id: true, category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } }, media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1 } },
    });
    const byId = new Map(details.map(item => [item.id, item]));
    const categories = await this.categories(rows.map(row => row.categoryId).filter((id): id is string => id !== null));

    return {
      object: 'list' as const,
      currency: account.currency,
      plan: { code: account.plan.code, name: account.plan.name },
      summary: {
        products: products.length,
        limit,
        over_limit: limit === null ? 0 : Math.max(0, products.length - limit),
        sellable: products.filter(item => item.block === null).length,
        low_stock: products.filter(item => item.lowStock).length,
        out_of_stock: products.filter(item => item.block === 'out_of_stock').length,
      },
      categories,
      total: shown.length,
      has_more: offset + take < shown.length,
      data: page.map(({ row, held: units, available, block, lowStock }) => {
        const detail = byId.get(row.id);
        const photo = detail?.media[0];
        return {
          object: 'pos_product' as const,
          id: row.id,
          ref: Number(row.ref),
          sku: row.sku,
          title: row.title,
          price: { kind: row.priceKind, amount: row.priceMinor === null ? null : Number(row.priceMinor), currency: row.currency },
          barcode: row.barcode,
          category: detail?.category ? { id: detail.category.id, name: detail.category.name, parent: detail.category.parent ? { id: detail.category.parent.id, name: detail.category.parent.name } : null } : null,
          photo_url: photo ? this.watermarks.url(photo, 480) : null,
          status: row.status,
          stock: row.stock,
          /** Units held for online buyers (UdozoPay orders and accepted buy orders): never sold at the till. */
          held: units,
          available,
          reorder_level: row.reorderLevel,
          low_stock: lowStock,
          /** Also on udozo.com; false for a shop-only listing. */
          on_udozo: row.onShop,
          /** Null when the till can sell it; else why not. */
          blocked: block,
          ticked_at: row.posEnabledAt!.toISOString(),
          edit_url: `${shopOrigin}/account/listings/${row.id}`,
        };
      }),
    };
  }

  /** Units held for online buyers, per listing. */
  private async held(ids: string[]) {
    const totals = new Map<string, number>();
    if (!ids.length) return totals;
    const [orders, buyOrders] = await Promise.all([
      this.prisma.classifiedOrder.groupBy({ by: ['listingId'], where: { listingId: { in: ids }, status: { in: holdingStatuses } }, _sum: { quantity: true } }),
      this.prisma.classifiedBuyOrder.groupBy({ by: ['listingId'], where: { listingId: { in: ids }, status: { in: buyOrderHoldingStatuses } }, _sum: { quantity: true } }),
    ]);
    for (const group of [...orders, ...buyOrders]) totals.set(group.listingId, (totals.get(group.listingId) ?? 0) + (group._sum.quantity ?? 0));
    return totals;
  }

  /** The top categories the shop's products are in, with how many each holds, for the catalogue's filter. */
  private async categories(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.classifiedCategory.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, parent: { select: { id: true, name: true } } } });
    const tops = new Map<string, { id: string; name: string; count: number }>();
    const topOf = new Map(rows.map(row => [row.id, row.parent ?? { id: row.id, name: row.name }]));
    for (const id of ids) {
      const top = topOf.get(id);
      if (!top) continue;
      const entry = tops.get(top.id) ?? { id: top.id, name: top.name, count: 0 };
      entry.count += 1;
      tops.set(top.id, entry);
    }
    return [...tops.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
}
