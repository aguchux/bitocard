import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, configSchema } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Encryption } from '../common/encryption.js';
import { z } from 'zod';
import { integrationFields, integrationKeys, isPlatformKey, ownerOf, sharedKeys } from './definitions.js';
import type { Platform } from '../generated/prisma/client.js';
import { parseXpub } from '../crypto/derive.js';
import { supplierCredentialGroups, supplierCredentialKey } from './supplier-credentials.js';

/** The validation rule for a setting: a platform setting's environment rule, or a supplier credential's kind. */
export function schemaFor(key: string): z.ZodType | null {
  if (isPlatformKey(key)) return configSchema.shape[key];
  const field = integrationFields.get(key);
  if (!field) return null;
  if (key === 'CRYPTO_SIGNER_SECRET') return z.string().min(32, 'use at least 32 characters');
  if (/^CRYPTO_(TEST_)?XPUB_/.test(key)) {
    return z.string().refine(value => {
      try {
        parseXpub(value);
        return true;
      } catch {
        return false;
      }
    }, 'paste an account extended public key (xpub, zpub, tpub or vpub), never a private key');
  }
  // Custody calls carry signed transfer requests and sanctions answers: never over plain HTTP (a local fake in tests aside).
  if (['CRYPTO_SIGNER_URL', 'CHAINALYSIS_API_URL', 'TRM_API_URL', 'COINGECKO_API_URL', 'COINBASE_PRICE_URL', 'AFRICASTALKING_API_URL', 'KYC_SPACES_ENDPOINT', 'VERCEL_API_URL', 'DOMAIN_DNS_LOOKUP_URL', 'CLOUDFLARE_API_URL', 'ANTHROPIC_API_URL', 'OPENAI_API_URL', 'DEEPSEEK_API_URL', 'GITHUB_API_URL'].includes(key)) return z.string().url().refine(secureUrl, 'use an https:// address');
  return field.kind === 'url' ? z.string().url() : z.string().min(1);
}

/** HTTPS, or plain HTTP only to this machine (local development and tests). */
export function secureUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

/** How long an instance trusts its copy of the admin settings before reading them again. */
export const integrationsMaxAgeMs = 30_000;

export type StoredIntegration = { value: string; secret: boolean; updatedById: string | null; updatedAt: Date };

/**
 * The API's configuration with admin-set integration settings applied: an admin value wins, then the environment, then
 * the default. Services read `config` synchronously; the copy is refreshed before each request (at most every 30
 * seconds, and at once after an admin change on this instance), so a new key works without a restart.
 *
 * Settings belong to a product (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 8; `platforms` on each group): `config` is
 * BitoCard's, with Afrippa's own values for the settings only Afrippa uses (its crypto); `configFor('afrippa')` is
 * Afrippa's, where the services both use (email, SMS, Google, AI, files, push, GitHub) take only Afrippa's own values,
 * else their defaults, never BitoCard's values or the environment BitoCard runs on.
 */
@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger('Integrations');
  private merged: AppConfig;
  private afrippaMerged: AppConfig;
  private storedValues: Record<Platform, Map<string, StoredIntegration>> = { bitocard: new Map(), afrippa: new Map() };
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  /** Changes whenever the effective settings change, so derived clients are rebuilt. */
  private version = 0;

  constructor(
    @Inject(APP_CONFIG) readonly env: AppConfig,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.merged = env;
    this.afrippaMerged = afrippaBase(env);
  }

  /** Without a database: the environment only (unit tests of a single service). */
  static fromConfig(config: AppConfig) {
    return new IntegrationsService(config);
  }

  /** BitoCard's settings (and Afrippa's own for its crypto, which only Afrippa's code reads). */
  get config(): AppConfig {
    return this.merged;
  }

  /** A product's settings: BitoCard's (`config`), or Afrippa's, which never include BitoCard's values for shared services. */
  configFor(platform: Platform): AppConfig {
    return platform === 'afrippa' ? this.afrippaMerged : this.merged;
  }

  /** BitoCard's admin-set values (secrets still decrypted only in `config`), for its admin app. */
  get stored(): ReadonlyMap<string, StoredIntegration> {
    return this.storedValues.bitocard;
  }

  /** A product's admin-set values, for its admin app. */
  storedFor(platform: Platform): ReadonlyMap<string, StoredIntegration> {
    return this.storedValues[platform];
  }

  /**
   * A supplier's credentials set in the admin app (Settings > Integrations), by field: `supplier('telnyx').API_KEY`.
   * For suppliers whose adapters are not built yet; Reloadly and VTpass use `config`.
   */
  supplier(code: string): Record<string, string | undefined> {
    const group = supplierCredentialGroups.find(item => item.code === code);
    return Object.fromEntries((group?.fields ?? []).map(field => [field.suffix, this.storedValues.bitocard.get(supplierCredentialKey(code, field.suffix))?.value]));
  }

  /**
   * Admin-set values of any fields by key (flags as 'on' or 'off'): blockchain providers and wallet keys. Each key is
   * read from the product that owns it (Afrippa's for its crypto), or from the product named for a shared service.
   */
  values(keys: readonly string[], platform?: Platform): Record<string, string | undefined> {
    return Object.fromEntries(keys.map(key => [key, this.storedValues[sharedKeys.has(key) && platform ? platform : ownerOf(key)].get(key)?.value]));
  }

  async onModuleInit() {
    await this.refresh(true);
  }

  /** Re-reads the admin settings if this copy is older than 30 seconds (or always, with `force`). Never throws. */
  async refresh(force = false) {
    if (!this.prisma || (!force && Date.now() - this.loadedAt < integrationsMaxAgeMs)) return;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  /** A value built from the settings (for example a provider client), rebuilt only when the settings change. */
  derive<T>(build: (config: AppConfig) => T): () => T {
    return this.deriveFor('bitocard', build);
  }

  /** The same, from one product's settings: an Afrippa email client is built from Afrippa's settings only. */
  deriveFor<T>(platform: Platform, build: (config: AppConfig) => T): () => T {
    let builtFor = -1;
    let value: T;
    return () => {
      if (builtFor !== this.version) {
        value = build(this.configFor(platform));
        builtFor = this.version;
      }
      return value;
    };
  }

  private async load() {
    try {
      const rows = await this.prisma!.integrationSetting.findMany();
      const stored: Record<Platform, Map<string, StoredIntegration>> = { bitocard: new Map(), afrippa: new Map() };
      const overrides: Record<Platform, Record<string, unknown>> = { bitocard: {}, afrippa: {} };
      for (const row of rows) {
        const key = row.key;
        const schema = schemaFor(key);
        if (!schema) continue;
        let plain: string;
        try {
          plain = row.encrypted ? this.encryption().decrypt(row.value) : row.value;
        } catch (error) {
          this.logger.error({ err: error, key }, 'Could not decrypt an integration setting; ignoring it');
          continue;
        }
        const parsed = schema.safeParse(plain);
        if (!parsed.success) {
          this.logger.error({ key }, 'Stored integration setting is invalid; ignoring it');
          continue;
        }
        // A value kept for a product that no longer uses the setting (or never did) is ignored.
        if (row.platform !== (sharedKeys.has(key) ? row.platform : ownerOf(key))) continue;
        if (isPlatformKey(key)) overrides[row.platform][key] = parsed.data;
        stored[row.platform].set(key, { value: plain, secret: integrationFields.get(key)?.secret ?? row.encrypted, updatedById: row.updatedById, updatedAt: row.updatedAt });
      }
      // BitoCard's: the environment, its own values, and Afrippa's for the settings only Afrippa uses.
      const afrippaOnly = Object.fromEntries(Object.entries(overrides.afrippa).filter(([key]) => !sharedKeys.has(key)));
      const merged = { ...this.env, ...overrides.bitocard, ...afrippaOnly } as AppConfig;
      // Afrippa's: never BitoCard's values or environment for a shared service, only its own or the default.
      const afrippaMerged = { ...afrippaBase(this.env), ...overrides.afrippa } as AppConfig;
      if (fingerprint(merged, afrippaMerged, stored) !== fingerprint(this.merged, this.afrippaMerged, this.storedValues)) this.version += 1;
      this.merged = merged;
      this.afrippaMerged = afrippaMerged;
      this.storedValues = stored;
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not read integration settings; keeping the current ones');
    } finally {
      this.loadedAt = Date.now();
    }
  }

  private encryption() {
    if (!this.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.env.ENCRYPTION_KEY);
  }
}

/**
 * Afrippa's settings before its own values: the environment for everything but the services both products use, which
 * start from their defaults (a shared service's environment value is BitoCard's account).
 */
function afrippaBase(env: AppConfig): AppConfig {
  const defaults = Object.fromEntries(
    integrationKeys
      .filter(key => sharedKeys.has(key))
      .map(key => {
        const parsed = configSchema.shape[key].safeParse(undefined);
        return [key, parsed.success ? parsed.data : undefined];
      }),
  );
  return { ...env, ...defaults } as AppConfig;
}

/** What services depend on: both products' settings in effect, and every stored credential. */
function fingerprint(config: AppConfig, afrippa: AppConfig, stored: Record<Platform, ReadonlyMap<string, StoredIntegration>>) {
  const pick = (from: AppConfig) => Object.fromEntries([...integrationFields.keys()].filter(isPlatformKey).map(key => [key, from[key]]));
  const credentials = (['bitocard', 'afrippa'] as const).flatMap(platform => [...stored[platform]].filter(([key]) => !isPlatformKey(key)).map(([key, item]) => [platform, key, item.value]));
  return JSON.stringify([pick(config), pick(afrippa), credentials]);
}
