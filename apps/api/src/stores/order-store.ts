import type { PrismaService } from '../database/prisma.service.js';
import type { Store } from '../generated/prisma/client.js';

/**
 * The store an order belongs to, now that a reseller can run several: the store its customer bought from, else (orders
 * from the reseller's own systems) their oldest published store. Null when they have none: callers fall back to the
 * reseller's name and BitoCard's neutral address.
 */
export async function orderStore(prisma: PrismaService, order: { resellerId: string; customerId: string | null }): Promise<Store | null> {
  if (order.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: order.customerId }, include: { store: true } });
    if (customer?.store && customer.store.resellerId === order.resellerId) return customer.store;
  }
  return prisma.store.findFirst({ where: { resellerId: order.resellerId, status: 'published' }, orderBy: { createdAt: 'asc' } });
}

/** The same choice from stores already loaded (oldest first): the customer's store, else the first published one. */
export function pickOrderStore<T extends { id: string; status: string }>(stores: T[], customerStoreId: string | null | undefined): T | null {
  return (customerStoreId ? stores.find(store => store.id === customerStoreId) : undefined) ?? stores.find(store => store.status === 'published') ?? null;
}
