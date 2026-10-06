import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { ApiKeyMode } from '../generated/prisma/client.js';
import type { Caller } from './caller.js';
import { docsTokenLifetimeMs, docsTokenScopes, docsWriteRoles, issueDocsToken } from './docs-tokens.js';

/** Issues "Try it" tokens to signed-in resellers for the API documentation. */
@Injectable()
export class DocsTokensService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(caller: Caller, mode: ApiKeyMode, readOnlyRequested: boolean, now = Date.now()) {
    if (caller.kind !== 'session') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'session_required', 'Sign in to the dashboard to try the API.');
    if (!caller.resellerId || !caller.role) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
    const key = this.config.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Trying the API needs ENCRYPTION_KEY to be set.');
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: caller.resellerId } });
    if (reseller.status === 'suspended') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'reseller_suspended', 'This reseller account is suspended.');
    if (mode === 'live' && reseller.status !== 'active') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'permission_error',
        'reseller_not_verified',
        'Live mode is available once your business is verified. Try the sandbox until then.',
        'mode',
      );
    }
    // Staff who cannot create API keys cannot make changes through the docs either.
    const readOnly = readOnlyRequested || !docsWriteRoles.includes(caller.role);
    const expires = now + docsTokenLifetimeMs;
    return {
      object: 'docs_token' as const,
      token: issueDocsToken(key, { sid: caller.sessionId, rid: caller.resellerId, mode, ro: readOnly, exp: expires }),
      mode,
      read_only: readOnly,
      scopes: docsTokenScopes(readOnly),
      reseller: { id: reseller.id, name: reseller.name },
      expires_at: new Date(expires).toISOString(),
    };
  }
}
