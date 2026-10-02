import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ApiError } from '../common/errors/api-error';

// OWASP-recommended Argon2id settings: 19 MiB memory, 2 iterations, 1 lane.
// Algorithm.Argon2id is a const enum, which isolated modules cannot read; its value is 2.
const argonOptions = { algorithm: 2 as Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
export const passwordLength = { min: 10, max: 128 };

/** Hashes and checks passwords, and rejects passwords known from public data breaches. */
@Injectable()
export class PasswordsService {
  private readonly logger = new Logger('Passwords');
  /** Verified against when an account does not exist, so response time does not reveal it. */
  private dummyHash: Promise<string> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  hash(password: string) {
    return hash(password, argonOptions);
  }

  async verify(passwordHash: string | null, password: string) {
    const target = passwordHash ?? (await (this.dummyHash ??= hash('not-a-real-password', argonOptions)));
    const ok = await verify(target, password).catch(() => false);
    return ok && passwordHash !== null;
  }

  /** Throws `password_too_weak` or `password_breached`; length is already enforced by request validation. */
  async assertAcceptable(password: string) {
    if (new Set(password).size < 4) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_too_weak', 'Choose a password with more variety.', 'password');
    }
    if (this.config.PASSWORD_BREACH_CHECK && (await this.isBreached(password))) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'password_breached',
        'This password has appeared in a data breach. Choose a different one.',
        'password',
      );
    }
  }

  /**
   * Have I Been Pwned range check: only the first five characters of the SHA-1 hash leave the server.
   * Fails open (logs and allows) if the service is unreachable, so sign-up never depends on it.
   */
  private async isBreached(password: string) {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const res = await fetch(`${this.config.HIBP_API_URL}/range/${prefix}`, {
        headers: { 'add-padding': 'true' },
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return body.split('\n').some(line => {
        const [candidate, count] = line.trim().split(':');
        return candidate === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Breached-password check unavailable; allowing');
      return false;
    }
  }
}
