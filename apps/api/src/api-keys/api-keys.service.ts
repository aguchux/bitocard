import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import type { ApiKey, ApiKeyMode } from '../generated/prisma/client.js';

/** Every scope an API key can hold. New endpoints add their scope here and document it. */
export const apiKeyScopes = [
  'catalogue:read',
  'quotes:write',
  'orders:read',
  'orders:write',
  'wallet:read',
  'wallet:write',
  'webhooks:manage',
  'events:read',
  'stores:manage',
  'customers:verify',
] as const;

export const maxActiveKeys = 20;
const prefixLength = 14;
const hour = 60 * 60 * 1000;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such API key.');

export function presentApiKey(key: ApiKey) {
  return {
    object: 'api_key' as const,
    id: key.id,
    name: key.name,
    mode: key.mode,
    prefix: key.prefix,
    scopes: key.scopes,
    created_at: key.createdAt.toISOString(),
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
    expires_at: key.expiresAt?.toISOString() ?? null,
    revoked_at: key.revokedAt?.toISOString() ?? null,
  };
}

/** Secret keys for reseller systems: shown once, stored only as a SHA-256 hash. */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(resellerId: string, userId: string, input: { name: string; mode: ApiKeyMode; scopes?: string[] }) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (input.mode === 'live' && reseller.status !== 'active') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'permission_error',
        'reseller_not_verified',
        'Live keys are available once your business is verified. Use a test key in the sandbox until then.',
        'mode',
      );
    }
    const active = await this.prisma.apiKey.count({ where: { resellerId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (active >= maxActiveKeys) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'api_key_limit_reached', `You can have up to ${maxActiveKeys} active keys. Revoke one first.`);
    }
    return this.issue(resellerId, userId, input.name, input.mode, input.scopes ?? [...apiKeyScopes]);
  }

  async list(resellerId: string) {
    const keys = await this.prisma.apiKey.findMany({ where: { resellerId }, orderBy: { createdAt: 'desc' } });
    return { object: 'list' as const, data: keys.map(presentApiKey) };
  }

  /** Issues a replacement with the same name, mode and scopes. The old key keeps working for `overlapHours`. */
  async roll(resellerId: string, userId: string, id: string, overlapHours: number) {
    const old = await this.prisma.apiKey.findFirst({ where: { id, resellerId } });
    if (!old || old.revokedAt || (old.expiresAt && old.expiresAt <= new Date())) throw notFound();
    const replacement = await this.issue(resellerId, userId, old.name, old.mode, old.scopes);
    const expiresAt = new Date(Date.now() + overlapHours * hour);
    await this.prisma.apiKey.update({
      where: { id: old.id },
      data: overlapHours === 0 ? { revokedAt: new Date() } : { expiresAt: old.expiresAt && old.expiresAt < expiresAt ? old.expiresAt : expiresAt },
    });
    return replacement;
  }

  async revoke(resellerId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, resellerId } });
    if (!key) throw notFound();
    const revoked = key.revokedAt ? key : await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return presentApiKey(revoked);
  }

  private async issue(resellerId: string, userId: string, name: string, mode: ApiKeyMode, scopes: string[]) {
    const secret = `bc_${mode}_${randomToken()}`;
    const key = await this.prisma.apiKey.create({
      data: { resellerId, name, mode, scopes, prefix: secret.slice(0, prefixLength), keyHash: sha256(secret), createdById: userId },
    });
    return { ...presentApiKey(key), secret };
  }
}
