import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { type Caller, storeScopeOf } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export type ScopedRecord = 'esim' | 'number' | 'vpn' | 'dispute' | 'ticket';

const names: Record<ScopedRecord, string> = { esim: 'eSIM', number: 'number', vpn: 'VPN subscription', dispute: 'dispute', ticket: 'ticket' };

/**
 * API keys belong to a store and see only that store's records. Services look records up by reseller; this checks, for
 * a key, that the record is its store's (a record of another store answers exactly as one that does not exist).
 * Dashboard sessions see every store.
 */
/** List filters: a key's store only (records of one store). */
export const inStore = (storeId?: string) => (storeId ? { storeId } : {});
/** List filters: a key's store and the account's own (no store). */
export const inStoreOrAccount = (storeId?: string) => (storeId ? { OR: [{ storeId }, { storeId: null }] } : {});

@Injectable()
export class StoreScope {
  constructor(private readonly prisma: PrismaService) {}

  async check(caller: Caller, kind: ScopedRecord, id: string) {
    const storeId = storeScopeOf(caller);
    if (!storeId) return;
    const found = await this.storeOf(kind, id);
    // Disputes and tickets of the account itself (no store) are every store's, as account events are.
    if (found === storeId || (found === null && (kind === 'dispute' || kind === 'ticket') && (await this.exists(kind, id)))) return;
    throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${names[kind]}.`);
  }

  private async exists(kind: 'dispute' | 'ticket', id: string) {
    return kind === 'dispute' ? Boolean(await this.prisma.dispute.findUnique({ where: { id }, select: { id: true } })) : Boolean(await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true } }));
  }

  private async storeOf(kind: ScopedRecord, id: string) {
    const isId = /^[0-9a-f-]{36}$/i.test(id);
    if (!isId) return null;
    switch (kind) {
      case 'esim':
        return (await this.prisma.esim.findUnique({ where: { id }, select: { order: { select: { storeId: true } } } }))?.order.storeId ?? null;
      case 'number':
        return (await this.prisma.virtualNumber.findUnique({ where: { id }, select: { order: { select: { storeId: true } } } }))?.order.storeId ?? null;
      case 'vpn':
        return (await this.prisma.vpnSubscription.findUnique({ where: { id }, select: { order: { select: { storeId: true } } } }))?.order.storeId ?? null;
      case 'dispute':
        return (await this.prisma.dispute.findUnique({ where: { id }, select: { storeId: true } }))?.storeId ?? null;
      case 'ticket':
        return (await this.prisma.supportTicket.findUnique({ where: { id }, select: { storeId: true } }))?.storeId ?? null;
    }
  }
}

/**
 * The store a new key or webhook endpoint belongs to: the one named (the reseller's own), else the oldest published,
 * else the oldest. A reseller with none (running only on their own systems) gets an unpublished store made for them,
 * as the move to store keys did, so the API never needs a storefront.
 */
export async function storeForNew(prisma: PrismaService, resellerId: string, storeId?: string) {
  const stores = await prisma.store.findMany({ where: { resellerId }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true } });
  if (storeId) {
    if (!stores.some(store => store.id === storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.', 'store_id');
    return storeId;
  }
  const store = stores.find(item => item.status === 'published') ?? stores[0];
  if (store) return store.id;
  const reseller = await prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { name: true } });
  const base = `store${resellerId.replace(/-/g, '').slice(0, 16)}`;
  for (const subdomain of [base, `${base}${randomBytes(3).toString('hex')}`]) {
    try {
      return (await prisma.store.create({ data: { resellerId, name: reseller.name, subdomain }, select: { id: true } })).id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  throw new Error('Could not name a store for the API');
}
