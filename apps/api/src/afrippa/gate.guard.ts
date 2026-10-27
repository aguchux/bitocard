import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { storeHeader } from '../customers/store-key.js';
import { afrippaSubdomain } from './ids.js';
import { afrippaSignatureHeader, verifyAfrippaRequest } from './signature.js';

/**
 * Afrippa's customer and public routes (`/v1/afrippa/account`, `/crypto`, `/p2p`, `/markets`, `/traders`): only Afrippa's server
 * reaches them, by signing each request (`Afrippa-Signature`, `./signature.ts`, with `AFRIPPA_SERVER_SECRET`).
 * Afrippa's admin (`/v1/afrippa/admin/…`) and chain providers' notifications (`/v1/afrippa/webhooks/chain/…`) are not
 * among them: they have their own sign-in and signatures.
 */
export const afrippaSignedRoutes = /^\/v1\/afrippa\/(?:account|crypto|p2p|markets|traders)(?:\/|$)/;

/** Crypto routes retired with BitoCard's crypto (the exchange, resellers' coins): no one reaches them; step 3 removes them. */
export const retiredCryptoRoutes = /^\/v1\/(?:store\/exchange|crypto|exchange)(?:\/|$)/;

/** Every route an unsigned request is turned away from (as an unknown route). */
export const closedCryptoRoutes = new RegExp(`${afrippaSignedRoutes.source}|${retiredCryptoRoutes.source}`);

/**
 * The gate in front of Afrippa's routes (docs/CRYPTO_SPINOFF_PLAN.md, step 2): a request Afrippa's server signed is
 * let through and always acts for Afrippa's own store (`BitoCard-Store: afrippa`, whatever it sent), so only Afrippa's
 * traders' sessions count there, never a bitocard.com or reseller store customer's. Anything else answers exactly as an
 * unknown route does. `CRYPTO_ROUTES=open` (tests and local development; refused in production) lets unsigned requests
 * through as well, unchanged, for the crypto code's own tests.
 */
@Injectable()
export class AfrippaGateGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signedRoute = afrippaSignedRoutes.test(req.path);
    if (!signedRoute && !retiredCryptoRoutes.test(req.path)) return true;
    const request = { method: req.method, url: req.originalUrl, body: req.rawBody };
    if (signedRoute && verifyAfrippaRequest(req.get(afrippaSignatureHeader), this.config.AFRIPPA_SERVER_SECRET, request)) {
      req.headers[storeHeader] = afrippaSubdomain;
      return true;
    }
    if (this.config.CRYPTO_ROUTES === 'open') return true;
    throw new NotFoundException();
  }
}
