import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The header a store's server names its store in (the subdomain); without it, the request is for bitocard.com. */
export const storeHeader = 'bitocard-store';
/** bitocard.com's own store (seeded by migration; reserved, so no reseller can take it). */
export const houseSubdomain = 'bitocard';

/** The store a request names: the `BitoCard-Store` header, else the `store` query (cacheable catalogue reads), else bitocard.com (null). */
export function storeKey(req: Request) {
  const value = req.get(storeHeader) ?? (typeof req.query?.store === 'string' ? req.query.store : undefined);
  const key = value?.trim().toLowerCase();
  return key && key !== houseSubdomain ? key : null;
}

/** The store subdomain the request names (null for bitocard.com). */
export const StoreKey = createParamDecorator((_data: unknown, context: ExecutionContext) => storeKey(context.switchToHttp().getRequest<Request>()));
