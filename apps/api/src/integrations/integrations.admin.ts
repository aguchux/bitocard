import { Body, Controller, Get, HttpStatus, Injectable, Module, Param, Put } from '@nestjs/common';
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
import { integrationGroups, isPlatformKey, type IntegrationField, type IntegrationGroup } from './definitions.js';
import { IntegrationsService, schemaFor } from './integrations.service.js';
import { linksFor } from './links.js';

type Source = 'admin' | 'environment' | 'default' | 'unset';
type Submitted = string | number | boolean | null;

const maxValueLength = 4000;
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
    return { object: 'list' as const, data: integrationGroups.map(group => this.presentGroup(group)) };
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
    return this.presentGroup(group);
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

  private presentGroup(group: IntegrationGroup) {
    const fields = group.fields.map(field => this.presentField(field));
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
      updated_at: updates.sort().at(-1) ?? null,
      fields,
    };
  }

  private presentField(field: IntegrationField) {
    const stored = this.integrations.stored.get(field.key);
    // Supplier credentials live only in the admin app; platform settings fall back to the environment, then the default.
    const platform = isPlatformKey(field.key);
    const effective: unknown = platform ? this.integrations.config[field.key as keyof AppConfig] : stored?.value;
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
}

@Module({ imports: [AuthModule], controllers: [IntegrationsAdminController], providers: [IntegrationsAdminService] })
export class IntegrationsAdminModule {}
