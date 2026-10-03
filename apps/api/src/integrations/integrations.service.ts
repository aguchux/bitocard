import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, configSchema } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Encryption } from '../common/encryption.js';
import { z } from 'zod';
import { integrationFields, isPlatformKey } from './definitions.js';
import { supplierCredentialGroups, supplierCredentialKey } from './supplier-credentials.js';

/** The validation rule for a setting: a platform setting's environment rule, or a supplier credential's kind. */
export function schemaFor(key: string): z.ZodType | null {
  if (isPlatformKey(key)) return configSchema.shape[key];
  const field = integrationFields.get(key);
  if (!field) return null;
  return field.kind === 'url' ? z.string().url() : z.string().min(1);
}

/** How long an instance trusts its copy of the admin settings before reading them again. */
export const integrationsMaxAgeMs = 30_000;

export type StoredIntegration = { value: string; secret: boolean; updatedById: string | null; updatedAt: Date };

/**
 * The API's configuration with admin-set integration settings applied: an admin value wins, then the environment, then
 * the default. Services read `config` synchronously; the copy is refreshed before each request (at most every 30
 * seconds, and at once after an admin change on this instance), so a new key works without a restart.
 */
@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger('Integrations');
  private merged: AppConfig;
  private storedValues = new Map<string, StoredIntegration>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  /** Changes whenever the effective settings change, so derived clients are rebuilt. */
  private version = 0;

  constructor(
    @Inject(APP_CONFIG) readonly env: AppConfig,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.merged = env;
  }

  /** Without a database: the environment only (unit tests of a single service). */
  static fromConfig(config: AppConfig) {
    return new IntegrationsService(config);
  }

  get config(): AppConfig {
    return this.merged;
  }

  /** Admin-set values (secrets still decrypted only in `config`), for the admin app. */
  get stored(): ReadonlyMap<string, StoredIntegration> {
    return this.storedValues;
  }

  /**
   * A supplier's credentials set in the admin app (Settings > Integrations), by field: `supplier('didww').API_KEY`.
   * For suppliers whose adapters are not built yet; Reloadly and VTpass use `config`.
   */
  supplier(code: string): Record<string, string | undefined> {
    const group = supplierCredentialGroups.find(item => item.code === code);
    return Object.fromEntries((group?.fields ?? []).map(field => [field.suffix, this.storedValues.get(supplierCredentialKey(code, field.suffix))?.value]));
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
    let builtFor = -1;
    let value: T;
    return () => {
      if (builtFor !== this.version) {
        value = build(this.merged);
        builtFor = this.version;
      }
      return value;
    };
  }

  private async load() {
    try {
      const rows = await this.prisma!.integrationSetting.findMany();
      const stored = new Map<string, StoredIntegration>();
      const overrides: Record<string, unknown> = {};
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
        if (isPlatformKey(key)) overrides[key] = parsed.data;
        stored.set(key, { value: plain, secret: integrationFields.get(key)?.secret ?? row.encrypted, updatedById: row.updatedById, updatedAt: row.updatedAt });
      }
      const merged = { ...this.env, ...overrides } as AppConfig;
      if (fingerprint(merged, stored) !== fingerprint(this.merged, this.storedValues)) this.version += 1;
      this.merged = merged;
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

/** What services depend on: platform settings in effect, and every supplier credential. */
function fingerprint(config: AppConfig, stored: ReadonlyMap<string, StoredIntegration>) {
  const platform = Object.fromEntries([...integrationFields.keys()].filter(isPlatformKey).map(key => [key, config[key]]));
  const suppliers = [...stored].filter(([key]) => !isPlatformKey(key)).map(([key, item]) => [key, item.value]);
  return JSON.stringify([platform, suppliers]);
}
