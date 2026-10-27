import { VercelDomains } from '../domains/vercel.js';
import { checkStoreHosts } from '../stores/store-hosts.service.js';
import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsObject, IsString, Matches } from 'class-validator';
import { AdminAuthService } from '../auth/admin-auth.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { type AppConfig, configSchema } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { checkProvider, checkWalletKeys, providerKeys } from '../crypto/chains/check.js';
import { chainProvider, walletKeyFields } from '../crypto/chains/providers.js';
import { checkScreener, checkSigner } from '../crypto/custody/check.js';
import { checkPrices } from '../crypto/price-feed.js';
import { screener } from '../crypto/custody/screening.js';
import { ProviderError } from '../payments/provider-error.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { integrationGroups, isPlatformKey, type IntegrationField, type IntegrationGroup } from './definitions.js';
import { inSandbox, urlsFor } from './endpoints.js';
import { IntegrationsService, schemaFor } from './integrations.service.js';
import { linksFor } from './links.js';
import { aiProvider, type AiProviderName, aiProviderLabels } from '../support/ai/providers.js';
import { GithubIssues } from '../support/github.js';

type Source = 'admin' | 'environment' | 'default' | 'unset';
type Submitted = string | number | boolean | null;

const maxValueLength = 4000;
/** Platform integrations with their own Test connection check (not a connectable adapter or a blockchain provider). */
const ownTests = new Set(['domains', 'store_hosts']);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such integration.');
const invalidValue = (key: string, message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'invalid_value', message, `values.${key}`);

/** The last four characters of a secret, so an admin can tell which key is set without it ever being shown. */
const hintOf = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : '…');

/** The admin view of integrations: what is set and where it comes from, never a secret's value. */
@Injectable()
export class IntegrationsAdminService {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    private readonly adminAuth: AdminAuthService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    await this.integrations.refresh(true);
    const access = await this.resellerAccess();
    // The blockchain integrations (wallet keys, chain providers, the signer, screening, prices) are Afrippa's now, not
    // BitoCard's (docs/CRYPTO_SPINOFF_PLAN.md): listed only while crypto's routes are open (tests, local development).
    const groups = this.integrations.env.CRYPTO_ROUTES === 'open' ? integrationGroups : integrationGroups.filter(group => group.section !== 'blockchain');
    return { object: 'list' as const, data: groups.map(group => this.presentGroup(group, access)) };
  }

  /**
   * Tests BitoCard's own credentials for an integration with a harmless call (a token, a balance), at the provider's
   * sandbox address when its Sandbox switch is on, otherwise live. Changes nothing; the outcome is audited.
   */
  async test(adminId: string, groupId: string) {
    const group = integrationGroups.find(item => item.id === groupId);
    if (!group) throw notFound();
    if (group.section === 'blockchain') return this.testBlockchain(adminId, group);
    if (group.id === 'domains') return this.testDomains(adminId);
    if (group.id === 'store_hosts') return this.testStoreHosts(adminId);
    if (group.id === 'anthropic' || group.id === 'openai' || group.id === 'deepseek') return this.testAi(adminId, group.id);
    if (group.id === 'github') return this.testGithub(adminId);
    const integration = connectable(groupId);
    if (!integration) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'integration_not_testable', `${group.name} cannot be tested yet: BitoCard’s adapter for it is still to be built.`);
    }
    await this.integrations.refresh(true);
    const config = this.integrations.config;
    const environment = inSandbox(config, groupId) ? ('sandbox' as const) : ('live' as const);
    const where = environment === 'sandbox' ? `${group.name}’s sandbox` : group.name;
    const values = integration.fromSettings(config);
    const missing = integration.fields.filter(item => item.secret && item.required && !values[item.key]?.trim());
    let ok = false;
    let message: string | null;
    if (missing.length) {
      message = `Set the ${missing.map(item => item.label).join(' and ')} first.`;
    } else {
      try {
        await integration.check(values as Record<string, string>, urlsFor(config, environment), environment);
        ok = true;
        message = null;
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(new RegExp(`^${groupId}: `), '') : 'unknown error';
        message = error instanceof ProviderError && error.definite ? `${where} refused these credentials (${detail}).` : `Could not reach ${where} (${detail}). Try again in a moment.`;
      }
    }
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: group.id, before: null, after: { environment, ok } });
    return { object: 'integration_test' as const, integration: group.id, environment, ok, message, tested_at: new Date().toISOString() };
  }

  /** Engineering escalations: the repository read with the token. */
  private async testGithub(adminId: string) {
    await this.integrations.refresh(true);
    const config = this.integrations.config;
    const github = new GithubIssues({ token: config.GITHUB_TOKEN as string | undefined, repo: config.GITHUB_REPO as string | undefined, baseUrl: String(config.GITHUB_API_URL ?? 'https://api.github.com') });
    let ok = false;
    let message: string | null = null;
    if (!github.configured()) message = 'Set the repository (owner/name) and the access token first.';
    else {
      try {
        message = `Issues go to ${await github.check()}.`;
        ok = true;
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(/^github: /, '') : 'unknown error';
        message = error instanceof ProviderError && error.definite ? `GitHub refused (${detail}).` : `Could not reach GitHub (${detail}). Try again in a moment.`;
      }
    }
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: 'github', before: null, after: { environment: 'live', ok } });
    return { object: 'integration_test' as const, integration: 'github', environment: 'live' as const, ok, message, tested_at: new Date().toISOString() };
  }

  /** An AI provider for support bots: its model list read with BitoCard's key. */
  private async testAi(adminId: string, provider: AiProviderName) {
    await this.integrations.refresh(true);
    const config = this.integrations.config;
    const apiKey = String(config[`${provider.toUpperCase()}_API_KEY` as keyof typeof config] ?? '').trim();
    const baseUrl = String(config[`${provider.toUpperCase()}_API_URL` as keyof typeof config] ?? '');
    let ok = false;
    let message: string | null = null;
    if (!apiKey) message = 'Set the API key first.';
    else {
      try {
        const models = await aiProvider(provider, { apiKey, baseUrl }).check();
        ok = true;
        message = models.length ? `The key can use ${models.length} models.` : null;
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(new RegExp(`^${provider}: `), '') : 'unknown error';
        message = error instanceof ProviderError && error.definite ? `${aiProviderLabels[provider]} refused this key (${detail}).` : `Could not reach ${aiProviderLabels[provider]} (${detail}). Try again in a moment.`;
      }
    }
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: provider, before: null, after: { environment: 'live', ok } });
    return { object: 'integration_test' as const, integration: provider, environment: 'live' as const, ok, message, tested_at: new Date().toISOString() };
  }

  /** Domains: the storefront project read with the token and team (proves all three). */
  private async testDomains(adminId: string) {
    await this.integrations.refresh(true);
    const config = this.integrations.config;
    const vercel = new VercelDomains({ token: config.VERCEL_API_TOKEN, teamId: config.VERCEL_TEAM_ID, project: config.VERCEL_STOREFRONT_PROJECT, baseUrl: config.VERCEL_API_URL });
    let ok = false;
    let message: string | null;
    if (!vercel.configured()) {
      message = 'Set the API token and the storefront project first.';
    } else {
      try {
        const name = await vercel.check();
        ok = true;
        message = `Connected to the ${name} project.`;
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(/^vercel: /, '') : 'unknown error';
        message = error instanceof ProviderError && error.definite ? `Vercel refused these settings (${detail}).` : `Could not reach Vercel (${detail}). Try again in a moment.`;
      }
    }
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: 'domains', before: null, after: { environment: 'live', ok } });
    return { object: 'integration_test' as const, integration: 'domains', environment: 'live' as const, ok, message, tested_at: new Date().toISOString() };
  }

  /** Store addresses: bitocard.com's Cloudflare zone and the storefront's Vercel project. */
  private async testStoreHosts(adminId: string) {
    await this.integrations.refresh(true);
    let ok = false;
    let message: string | null;
    try {
      ({ ok, message } = await checkStoreHosts(this.integrations.config));
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^(cloudflare|vercel): /, '') : 'unknown error';
      message = error instanceof ProviderError && error.definite ? `${error.provider === 'vercel' ? 'Vercel' : 'Cloudflare'} refused these settings (${detail}).` : `Could not reach ${error instanceof ProviderError && error.provider === 'vercel' ? 'Vercel' : 'Cloudflare'} (${detail}). Try again in a moment.`;
    }
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: 'store_hosts', before: null, after: { environment: 'live', ok } });
    return { object: 'integration_test' as const, integration: 'store_hosts', environment: 'live' as const, ok, message, tested_at: new Date().toISOString() };
  }

  /** A blockchain provider (the latest block on each chain it is set up for) or the wallet keys (their first addresses). */
  private async testBlockchain(adminId: string, group: IntegrationGroup) {
    await this.integrations.refresh(true);
    const provider = chainProvider(group.id);
    const values = this.integrations.values(group.fields.map(item => item.key));
    const outcome = provider
      ? await checkProvider(provider, this.integrations.values(providerKeys(provider)))
      : group.id === 'crypto_signer'
        ? await checkSigner(values)
        : screener(group.id)
          ? await checkScreener(screener(group.id)!, values)
          : group.id === 'crypto_prices'
            ? await checkPrices(values)
            : checkWalletKeys(this.integrations.values(walletKeyFields.map(item => item.key)));
    await this.audit.record({ actorId: adminId || null, action: 'integration.tested', targetType: 'integration', targetId: group.id, before: null, after: { environment: outcome.environment, ok: outcome.ok } });
    return { object: 'integration_test' as const, integration: group.id, environment: outcome.environment, ok: outcome.ok, message: outcome.message, chains: outcome.chains, tested_at: new Date().toISOString() };
  }

  /** Which integrations resellers may connect their own accounts to. */
  private async resellerAccess() {
    const offers = await this.prisma.integrationOffer.findMany({ select: { integrationId: true, resellerAccess: true } });
    return new Set(offers.filter(offer => offer.resellerAccess).map(offer => offer.integrationId));
  }

  /**
   * Sets or clears (null) some of one integration's fields. Needs the admin's current authenticator code. Cleared fields
   * fall back to the environment, then the default.
   */
  async update(adminId: string, groupId: string, values: Record<string, unknown>, code: string) {
    const group = integrationGroups.find(item => item.id === groupId);
    if (!group) throw notFound();
    const changes = Object.entries(values);
    if (changes.length === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Change at least one field.', 'values');
    const prepared = changes.map(([key, value]) => this.prepare(group, key, value));
    await this.adminAuth.confirmCode(adminId, code);

    await this.integrations.refresh(true);
    const before = this.auditView(group);
    await this.prisma.$transaction(async tx => {
      for (const change of prepared) {
        if (change.value === null) {
          await tx.integrationSetting.deleteMany({ where: { key: change.field.key } });
        } else {
          const value = change.field.secret ? this.encryption().encrypt(change.value) : change.value;
          await tx.integrationSetting.upsert({
            where: { key: change.field.key },
            create: { key: change.field.key, value, encrypted: change.field.secret, updatedById: adminId },
            update: { value, encrypted: change.field.secret, updatedById: adminId },
          });
        }
      }
    });
    await this.integrations.refresh(true);
    await this.audit.record({ actorId: adminId, action: 'integration.updated', targetType: 'integration', targetId: group.id, before, after: this.auditView(group) });
    return this.presentGroup(group, await this.resellerAccess());
  }

  /** Validates one submitted value against the same rules as the environment variable it replaces. */
  private prepare(group: IntegrationGroup, key: string, submitted: unknown): { field: IntegrationField; value: string | null } {
    const field = group.fields.find(item => item.key === key);
    if (!field) throw invalidValue(key, `${key} is not a setting of ${group.name}.`);
    if (submitted === null) return { field, value: null };
    const value = this.asString(field, submitted as Submitted);
    if (value === null) throw invalidValue(key, `${field.label} must be ${field.kind === 'flag' ? 'true or false' : field.kind === 'number' ? 'a number' : 'text'}, or null to clear it.`);
    if (value.length === 0) throw invalidValue(key, `${field.label} cannot be empty. Send null to clear it.`);
    if (value.length > maxValueLength) throw invalidValue(key, `${field.label} is too long.`);
    const parsed = schemaFor(field.key)!.safeParse(value);
    if (!parsed.success) throw invalidValue(key, `${field.label} is not valid: ${parsed.error.issues[0]?.message ?? 'check the value'}.`);
    return { field, value };
  }

  private asString(field: IntegrationField, value: Submitted) {
    if (field.kind === 'flag') return typeof value === 'boolean' ? (value ? 'on' : 'off') : null;
    if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : null;
    return typeof value === 'string' ? value.trim() : null;
  }

  private presentGroup(group: IntegrationGroup, access: Set<string>) {
    const fields = group.fields.map(field => this.presentField(field));
    const sandboxField = fields.find(field => field.kind === 'flag' && field.key.endsWith('_SANDBOX'));
    const required = fields.filter(field => field.required);
    const secrets = fields.filter(field => field.secret);
    const isSet = (field: (typeof fields)[number]) => field.source !== 'unset';
    const connected = required.length > 0 ? required.every(isSet) : secrets.length > 0 ? secrets.some(isSet) : true;
    const started = fields.some(field => field.secret && isSet(field)) || required.some(isSet);
    const updates = fields.map(field => field.updated_at).filter((value): value is string => value !== null);
    return {
      object: 'integration' as const,
      id: group.id,
      name: group.name,
      description: group.description,
      /** Where to sign up with the provider and find the credentials. */
      links: linksFor(group.id),
      status: connected ? ('connected' as const) : started ? ('incomplete' as const) : ('not_connected' as const),
      section: group.section,
      /** False while the supplier's adapter is not built: its credentials are saved for later and not used yet. */
      adapter_ready: group.adapterReady,
      webhook_url: group.webhookPath ? `https://api.bitocard.com${group.webhookPath}` : null,
      /** The Sandbox switch: true while BitoCard's account uses the provider's sandbox (never live); null without one. */
      sandbox: sandboxField ? sandboxField.value === true : null,
      /** Whether Test connection can check these credentials (a built adapter with a check). */
      testable: group.section === 'blockchain' || ownTests.has(group.id) || Boolean(connectable(group.id)),
      /** Resellers' own accounts: `available` once BitoCard's adapter can take them, `enabled` when an admin allows it. */
      reseller_access: { available: Boolean(connectable(group.id)), enabled: access.has(group.id) },
      updated_at: updates.sort().at(-1) ?? null,
      fields,
    };
  }

  private presentField(field: IntegrationField) {
    const stored = this.integrations.stored.get(field.key);
    // Supplier credentials live only in the admin app; platform settings fall back to the environment, then the default.
    const platform = isPlatformKey(field.key);
    // Switches stored for suppliers whose adapter is not built are read as booleans, like platform flags.
    const effective: unknown = platform ? this.integrations.config[field.key as keyof AppConfig] : field.kind === 'flag' && stored ? stored.value === 'on' : stored?.value;
    const fallback = platform ? configSchema.shape[field.key as keyof typeof configSchema.shape].safeParse(undefined) : null;
    const fromEnv: unknown = platform ? this.integrations.env[field.key as keyof AppConfig] : undefined;
    const source: Source = stored
      ? 'admin'
      : fromEnv === undefined
        ? 'unset'
        : fallback?.success && fallback.data !== undefined && JSON.stringify(fallback.data) === JSON.stringify(fromEnv)
          ? 'default'
          : 'environment';
    const raw = stored?.value ?? (effective === undefined ? null : String(effective));
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      secret: field.secret,
      required: field.required,
      help: field.help ?? null,
      source,
      /** Never set for secrets. */
      value: field.secret ? null : ((effective as string | number | boolean | undefined) ?? null),
      /** Secrets only: the last four characters, when set. */
      hint: field.secret && raw ? hintOf(raw) : null,
      updated_at: stored?.updatedAt.toISOString() ?? null,
    };
  }

  /** What the audit log keeps: values of plain settings, and only whether a secret is set (with its hint). */
  private auditView(group: IntegrationGroup) {
    return Object.fromEntries(
      group.fields.map(field => {
        const presented = this.presentField(field);
        return [field.key, field.secret ? { set: presented.source !== 'unset', source: presented.source, hint: presented.hint } : { value: presented.value, source: presented.source }];
      }),
    );
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Saving credentials needs ENCRYPTION_KEY to be set.');
    return new Encryption(key);
  }
}

class UpdateIntegrationDto {
  /** Field name to value; null clears an admin value (the environment, then the default, applies again). */
  @IsObject() values!: Record<string, unknown>;
  /** The admin's current authenticator code. */
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app' }) code!: string;
}

/** Service credentials and settings (Settings > Integrations). Super admins only; never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('super_admin')
@Controller('admin/integrations')
export class IntegrationsAdminController {
  constructor(private readonly service: IntegrationsAdminService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Put(':id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body() body: UpdateIntegrationDto) {
    return this.service.update(caller.kind === 'session' ? caller.userId : '', id, body.values, body.code);
  }

  /** Tests the saved credentials (sandbox or live, as the Sandbox switch says). */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.service.test(caller.kind === 'session' ? caller.userId : '', id);
  }
}

@Module({ imports: [AuthModule], controllers: [IntegrationsAdminController], providers: [IntegrationsAdminService] })
export class IntegrationsAdminModule {}
