import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, HttpStatus, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { Prisma } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Encryption } from '../encryption.js';
import { ApiError } from '../errors/api-error.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const SKIP_IDEMPOTENCY = 'idempotency:skip';

/**
 * Exempts a POST route from idempotency keys. Only for routes whose responses must never be stored or replayed
 * (they set cookies or return secrets) and that are safe to repeat, such as sign-in.
 */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY, true);
const keyFormat = /^[\x21-\x7e]{1,255}$/;
const ttlMs = 24 * 60 * 60 * 1000;

/**
 * Every POST must carry an Idempotency-Key header. The first request runs and its result is stored for 24 hours;
 * a retry with the same key and body gets the stored result (marked Idempotent-Replayed: true) instead of acting twice.
 * Server errors are not stored, so the caller can retry them with the same key. Stored responses can carry delivered
 * codes, PINs and order page links, so they are kept encrypted with ENCRYPTION_KEY (`{ sealed }`), like the codes themselves.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private encryption() {
    return this.config.ENCRYPTION_KEY ? new Encryption(this.config.ENCRYPTION_KEY) : null;
  }

  /** What is stored: the response sealed with ENCRYPTION_KEY (left as it is only where no key is configured, in development). */
  private seal(body: unknown): Prisma.InputJsonValue {
    const encryption = this.encryption();
    const json = JSON.stringify(body ?? null);
    return encryption ? { sealed: encryption.encrypt(json) } : (JSON.parse(json) as Prisma.InputJsonValue);
  }

  private open(stored: Prisma.JsonValue): unknown {
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && typeof stored.sealed === 'string' && Object.keys(stored).length === 1) {
      const encryption = this.encryption();
      if (!encryption) throw new Error('ENCRYPTION_KEY is needed to replay a stored response');
      return JSON.parse(encryption.decrypt(stored.sealed)) as unknown;
    }
    return stored;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (req.method !== 'POST') return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(SKIP_IDEMPOTENCY, [context.getHandler(), context.getClass()])) return next.handle();

    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      return throwError(() => new ApiError(HttpStatus.BAD_REQUEST, 'idempotency_error', 'idempotency_key_required', 'POST requests need an Idempotency-Key header.'));
    }
    if (!keyFormat.test(key)) {
      return throwError(() => new ApiError(HttpStatus.BAD_REQUEST, 'idempotency_error', 'idempotency_key_invalid', 'Idempotency-Key must be 1 to 255 printable characters.'));
    }

    const scope = idempotencyScope(req);
    const path = req.originalUrl.split('?')[0];
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const successStatus = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ?? HttpStatus.CREATED;

    return from(this.claim(scope, key, req.method, path, requestHash)).pipe(
      mergeMap(claim => {
        if (claim.replay) {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(claim.replay.status);
          return of(claim.replay.body);
        }
        return next.handle().pipe(
          mergeMap(body => from(this.complete(claim.id, successStatus, body)).pipe(mergeMap(() => of(body)))),
          catchError((error: unknown) => from(this.fail(claim.id, error)).pipe(mergeMap(() => throwError(() => error)))),
        );
      }),
    );
  }

  private async claim(scope: string, key: string, method: string, path: string, requestHash: string) {
    await this.prisma.idempotencyKey.deleteMany({ where: { scope, key, expiresAt: { lt: new Date() } } });
    try {
      const row = await this.prisma.idempotencyKey.create({
        data: { scope, key, method, path, requestHash, expiresAt: new Date(Date.now() + ttlMs) },
      });
      return { id: row.id, replay: null };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }

    const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
    if (existing.requestHash !== requestHash || existing.method !== method || existing.path !== path) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'idempotency_error', 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
    }
    if (existing.state === 'in_progress') {
      throw new ApiError(HttpStatus.CONFLICT, 'idempotency_error', 'idempotency_in_progress', 'A request with this Idempotency-Key is still being processed. Retry shortly.');
    }
    return { id: existing.id, replay: { status: existing.responseStatus ?? HttpStatus.OK, body: this.open(existing.responseBody) } };
  }

  private complete(id: string, status: number, body: unknown) {
    return this.prisma.idempotencyKey.update({
      where: { id },
      data: { state: 'completed', responseStatus: status, responseBody: this.seal(body) },
    });
  }

  /** Client errors are final and stored; server errors release the key so the request can be retried. */
  private async fail(id: string, error: unknown) {
    const status = error instanceof ApiError || isHttpError(error) ? (error as { getStatus(): number }).getStatus() : 500;
    if (status >= 500) {
      await this.prisma.idempotencyKey.delete({ where: { id } }).catch(() => undefined);
      return;
    }
    const body = error instanceof ApiError ? { error: error.toBody() } : { error: { type: 'invalid_request_error', code: `http_${status}`, message: (error as Error).message } };
    await this.prisma.idempotencyKey.update({ where: { id }, data: { state: 'completed', responseStatus: status, responseBody: this.seal(body) } });
  }
}

function isHttpError(error: unknown) {
  return typeof (error as { getStatus?: unknown })?.getStatus === 'function';
}

/**
 * Idempotency keys are scoped to the caller and, for a dashboard session, also to the reseller account and mode it is
 * acting in: the same key used in the sandbox and then live (or in two accounts) is two requests, never a replay of the
 * other's response. API keys and docs tokens already have one reseller and one mode.
 */
export function idempotencyScope(req: Request) {
  const scope = callerScope(req);
  const caller = (req as Request & { caller?: { kind: string; resellerId?: string | null } }).caller;
  if (caller?.kind !== 'session') return scope;
  return `${scope}:${caller.resellerId ?? '-'}:${req.get('bitocard-mode') === 'test' ? 'test' : 'live'}`;
}

/** Set by `RateLimitGuard` when a store request carries a live customer session (its ID, never the token). */
export type CustomerScopedRequest = Request & { customerSessionId?: string };

/** Keys are unique per caller (a person or an API key); requests without credentials share the anonymous scope. */
export function callerScope(req: Request) {
  const caller = (req as Request & { caller?: { id: string } }).caller?.id;
  if (caller) return caller;
  // A store customer's requests come from the store's server: scope them by their session, not the server's address.
  // Only a session the rate limiter has checked counts; an unknown or made-up token is anonymous (limited by address).
  const customer = (req as CustomerScopedRequest).customerSessionId;
  return customer ? `customer:${customer}` : 'anonymous';
}
