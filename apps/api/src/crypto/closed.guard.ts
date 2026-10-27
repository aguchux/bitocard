import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/**
 * Crypto has left BitoCard (`docs/CRYPTO_SPINOFF_PLAN.md`): its routes for store customers, resellers and the public
 * (`/v1/store/crypto`, `/v1/store/p2p`, `/v1/store/exchange`, `/v1/crypto`, `/v1/exchange`) answer exactly as an
 * unknown route does until they move to Afrippa's own surface. `CRYPTO_ROUTES=open` (tests and local development only;
 * refused in production) keeps them for the code Afrippa will reuse. Admin routes and chain notifications stay.
 * Money customers can withdraw (Safe pay sales) is cashed out at `/v1/store/cash`, outside crypto.
 */
export const closedCryptoRoutes = /^\/v1\/(?:store\/(?:crypto|p2p|exchange)|crypto|exchange)(?:\/|$)/;

@Injectable()
export class CryptoClosedGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext) {
    if (this.config.CRYPTO_ROUTES === 'open' || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (closedCryptoRoutes.test(req.path)) throw new NotFoundException();
    return true;
  }
}
