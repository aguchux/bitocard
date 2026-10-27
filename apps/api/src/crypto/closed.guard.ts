import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/**
 * Crypto has left BitoCard (`docs/CRYPTO_SPINOFF_PLAN.md`). Afrippa's own routes live under `/v1/afrippa/`
 * (crypto wallets `/v1/afrippa/crypto`, the P2P market `/v1/afrippa/p2p`, the public markets and traders
 * `/v1/afrippa/markets`, `/v1/afrippa/traders`), and the retired ones where they were (the exchange `/v1/exchange` and
 * `/v1/store/exchange`, resellers' coins `/v1/crypto`). Until Afrippa's own front door opens they answer exactly as an
 * unknown route does. `CRYPTO_ROUTES=open` (tests and local development only; refused in production) keeps them for
 * the code Afrippa reuses. Afrippa's admin routes (`/v1/afrippa/admin/…`) and chain notifications
 * (`/v1/afrippa/webhooks/chain/…`) stay. Money customers can withdraw (Safe pay sales) is cashed out at
 * `/v1/store/cash`, BitoCard's.
 */
export const closedCryptoRoutes = /^\/v1\/(?:afrippa\/(?:crypto|p2p|markets|traders)|store\/exchange|crypto|exchange)(?:\/|$)/;

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
