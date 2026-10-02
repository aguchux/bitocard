import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { ApiError } from '../errors/api-error';
import { callerScope } from '../idempotency/idempotency.interceptor';

type Verdict = { success: boolean; limit: number; remaining: number; reset: number };

/** Fixed one-minute windows in memory, for local development and tests when Redis is not configured. */
class MemoryLimiter {
  private readonly windows = new Map<string, { count: number; reset: number }>();
  constructor(private readonly limit: number) {}

  async limitFor(key: string): Promise<Verdict> {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || window.reset <= now) {
      window = { count: 0, reset: now + 60_000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return { success: window.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - window.count), reset: window.reset };
  }
}

/**
 * Per-caller request limit on /v1 (RATE_LIMIT_PER_MINUTE). Uses Upstash Redis when configured so the limit holds
 * across every function instance. Callers are identified by API key once sign-in exists, by IP address until then.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter: { limitFor(key: string): Promise<Verdict> };

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN) {
      const redis = new Ratelimit({
        redis: new Redis({ url: config.UPSTASH_REDIS_REST_URL, token: config.UPSTASH_REDIS_REST_TOKEN }),
        limiter: Ratelimit.slidingWindow(config.RATE_LIMIT_PER_MINUTE, '1 m'),
        prefix: 'bitocard:ratelimit',
      });
      this.limiter = { limitFor: key => redis.limit(key) };
    } else {
      this.limiter = new MemoryLimiter(config.RATE_LIMIT_PER_MINUTE);
    }
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/v1/')) return true;
    const scope = callerScope(req);
    const key = scope === 'anonymous' ? `ip:${req.ip ?? 'unknown'}` : `caller:${scope}`;
    const verdict = await this.limiter.limitFor(key);
    const resetSeconds = Math.max(0, Math.ceil((verdict.reset - Date.now()) / 1000));

    res.setHeader('RateLimit-Limit', String(verdict.limit));
    res.setHeader('RateLimit-Remaining', String(verdict.remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));
    if (verdict.success) return true;

    res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
    throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'rate_limited', 'Too many requests. Retry after the time in the Retry-After header.');
  }
}
