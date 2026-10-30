import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PRODUCT_ONLY, type Product } from './product.js';

/**
 * Routes of the other product answer exactly as unknown routes do, before any other guard (`@ProductOnly`). Each
 * instance serves its own product's routes and the shared ones. `PRODUCT_ROUTES=all` (tests and local development;
 * refused in production) serves every route, so one test app covers both products' code.
 */
@Injectable()
export class ProductRoutesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http' || this.config.PRODUCT_ROUTES === 'all') return true;
    const owner = this.reflector.getAllAndOverride<Product | undefined>(PRODUCT_ONLY, [context.getHandler(), context.getClass()]);
    if (owner && owner !== this.config.APP_PRODUCT) throw new NotFoundException();
    return true;
  }
}
