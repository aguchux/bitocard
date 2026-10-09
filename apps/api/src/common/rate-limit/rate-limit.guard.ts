import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { sha256 } from '../crypto.js';
import { ApiError } from '../errors/api-error.js';
import { callerScope, type CustomerScopedRequest } from '../idempotency/idempotency.interceptor.js';
import { clientHeader, signedClientIp } from './client-ip.js';

type Verdict = { success: boolean; limit: number; remaining: number; reset: number };

const windowMs = 60_000;

/**
 * Fixed one-minute windows in Redis using only INCR and PEXPIRE, so it behaves the same on Upstash and on plain
 * Redis (local Docker and CI). Upstash's own ratelimit library relies on an Upstash-only script flag.
 */
class RedisLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
  ) {}

  async limitFor(key: string): Promise<Verdict> {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const windowKey = `bitocard:ratelimit:${key}:${windowStart}`;
    const [count] = await this.redis.pipeline().incr(windowKey).pexpire(windowKey, windowMs * 2).exec<[number, number]>();
    const reset = windowStart + windowMs;
    return { success: count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - count), reset };
  }
}

/** Fixed one-minute windows in memory, for local development and tests when Redis is not configured. */
class MemoryLimiter {
  private readonly windows = new Map<string, { count: number; reset: number }>();
  constructor(private readonly limit: number) {}

  async limitFor(key: string): Promise<Verdict> {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || window.reset <= now) {
      window = { count: 0, reset: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return { success: window.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - window.count), reset: window.reset };
  }
}

type Limiter = { limitFor(key: string): Promise<Verdict> };

function limiterFor(config: AppConfig, limit: number): Limiter {
  if (config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN) {
    return new RedisLimiter(new Redis({ url: config.UPSTASH_REDIS_REST_URL, token: config.UPSTASH_REDIS_REST_TOKEN }), limit);
  }
  return new MemoryLimiter(limit);
}

const rateLimited = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'rate_limited', 'Too many requests. Retry after the time in the Retry-After header.');

/**
 * A per-address limit on /v1 that runs before the caller is identified (ADDRESS_RATE_LIMIT_PER_MINUTE), so requests
 * with made-up API keys, docs tokens or session cookies (each answered 401 after database lookups) cannot be sent without
 * limit. Generous: the per-caller limit below does the fine-grained work. Shoppers behind a store's server count by the
 * address it signs.
 */
@Injectable()
export class AddressRateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');
  private readonly limiter: Limiter;
  private readonly storeServerSecret: string | undefined;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.storeServerSecret = config.STORE_SERVER_SECRET;
    this.limiter = limiterFor(config, config.ADDRESS_RATE_LIMIT_PER_MINUTE);
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/v1/')) return true;
    const address = signedClientIp(req.get(clientHeader), this.storeServerSecret) ?? req.ip ?? 'unknown';
    let verdict: Verdict;
    try {
      verdict = await this.limiter.limitFor(`address:${address}`);
    } catch (error) {
      this.logger.error({ err: error }, 'Rate limiter unavailable; request allowed');
      return true;
    }
    if (verdict.success) return true;
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000))));
    throw rateLimited();
  }
}

/**
 * Per-caller request limit on /v1 (RATE_LIMIT_PER_MINUTE). Uses Upstash Redis when configured so the limit holds
 * across every function instance; if Redis is unreachable requests are allowed and the failure is logged. Callers are identified by API key once sign-in exists, by IP address until then.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');
  private readonly limiter: Limiter;
  private readonly storeServerSecret: string | undefined;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.storeServerSecret = config.STORE_SERVER_SECRET;
    this.limiter = limiterFor(config, config.RATE_LIMIT_PER_MINUTE);
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/v1/')) return true;
    const store = req.originalUrl.startsWith('/v1/store/');
    if (store) await this.identifyCustomer(req);
    const scope = callerScope(req);
    // Signed-out shoppers reach the API through their store's server: limit them by the address it vouches for.
    const shopper = store && scope === 'anonymous' ? signedClientIp(req.get(clientHeader), this.storeServerSecret) : null;
    const key = scope === 'anonymous' ? `ip:${shopper ?? req.ip ?? 'unknown'}` : `caller:${scope}`;
    let verdict: Verdict;
    try {
      verdict = await this.limiter.limitFor(key);
    } catch (error) {
      // A Redis outage must not take the API down: allow the request and report the failure.
      this.logger.error({ err: error }, 'Rate limiter unavailable; request allowed');
      return true;
    }
    const resetSeconds = Math.max(0, Math.ceil((verdict.reset - Date.now()) / 1000));

    res.setHeader('RateLimit-Limit', String(verdict.limit));
    res.setHeader('RateLimit-Remaining', String(verdict.remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));
    if (verdict.success) return true;

    res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
    throw rateLimited();
  }

  /**
   * Store customers' requests come from the store's server, so they are limited per customer session instead of the
   * server's address. Only a live session counts: a made-up token would otherwise get a fresh limit on every request.
   */
  private async identifyCustomer(req: CustomerScopedRequest) {
    const token = req.get('bitocard-customer-session');
    if (!token) return;
    try {
      const session = await this.prisma.customerSession.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, revokedAt: true, expiresAt: true } });
      if (session && !session.revokedAt && session.expiresAt > new Date()) req.customerSessionId = session.id;
    } catch (error) {
      this.logger.error({ err: error }, 'Could not check the customer session for rate limiting');
    }
  }
}
