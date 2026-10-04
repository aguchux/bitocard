import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ConnectionStatus, IntegrationApproval, LedgerMode, ResellerConnection } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { connectionEmail } from '../notifications/templates.js';
import { ProviderError } from '../payments/provider-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { connectable, connectableIntegrations, type ConnectableIntegration } from './connectable.js';

/** Why a reseller cannot connect their own integrations yet (null: they can). */
export type AccessReason = 'switch_off' | 'plan' | 'not_verified' | 'no_country' | null;
export type ConnectionDecision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const maxValueLength = 1000;
const hintOf = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : '…');
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such integration.');

/** Which status a decision moves a connection from, and to. */
const decisions: Record<ConnectionDecision, { from: ConnectionStatus[]; to: ConnectionStatus }> = {
  approve: { from: ['pending_review'], to: 'active' },
  reject: { from: ['pending_review'], to: 'rejected' },
  suspend: { from: ['active', 'pending_review'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'active' },
};

/**
 * Resellers' own integrations, phase 1: which integrations are offered where, and resellers' own connections to them
 * (credentials stored like BitoCard's: encrypted, write-only, audited). Three gates: the `own_integrations` switch and
 * plan feature, the integration offered in the reseller's country, and the connection approved (live only; automatic
 * or by review, per integration). Live credentials are checked with a harmless call when saved; sandbox credentials
 * are never sent anywhere (the sandbox never calls real providers).
 */
@Injectable()
export class ResellerIntegrationsService {
  private readonly logger = new Logger('ResellerIntegrations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
  ) {}

  /** Whether the reseller may connect their own integrations in this mode. */
  async access(resellerId: string, mode: LedgerMode): Promise<{ allowed: boolean; reason: AccessReason }> {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true } });
    const reason: AccessReason = !(await this.settings.isOn('own_integrations', resellerId))
      ? 'switch_off'
      : !reseller.plan.features.includes('own_integrations')
        ? 'plan'
        : !reseller.country
          ? 'no_country'
          : mode === 'live' && reseller.status !== 'active'
            ? 'not_verified'
            : null;
    return { allowed: reason === null, reason };
  }

  /** Integrations offered in the reseller's country, with their connection in this mode. */
  async list(resellerId: string, mode: LedgerMode) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const [access, offers, connections] = await Promise.all([
      this.access(resellerId, mode),
      this.prisma.integrationOffer.findMany(),
      this.prisma.resellerConnection.findMany({ where: { resellerId, mode } }),
    ]);
    const data = connectableIntegrations
      .filter(item => {
        const offer = offers.find(row => row.integrationId === item.id);
        return offer && offeredIn(offer, reseller.country);
      })
      .map(item => {
        const offer = offers.find(row => row.integrationId === item.id);
        return presentIntegration(item, offer?.approval ?? 'review', connections.find(row => row.integrationId === item.id) ?? null, this.apiBase);
      });
    return { object: 'list' as const, access, data };
  }

  /** Connects (or replaces the credentials of) the reseller's own account. Blank secrets keep the saved ones. */
  async connect(resellerId: string, mode: LedgerMode, userId: string, integrationId: string, submitted: Record<string, unknown>) {
    const integration = connectable(integrationId);
    if (!integration) throw notFound();
    const access = await this.access(resellerId, mode);
    if (!access.allowed) throw accessDenied(access.reason);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const offer = await this.prisma.integrationOffer.findUnique({ where: { integrationId } });
    if (!offer || !offeredIn(offer, reseller.country)) throw notFound();

    const existing = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (existing?.status === 'suspended') {
      throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'connection_suspended', 'BitoCard suspended this connection. Contact support to have it reinstated.');
    }
    const saved = existing?.credentialsEncrypted ? (JSON.parse(this.encryption().decrypt(existing.credentialsEncrypted)) as Record<string, string>) : {};
    const values = prepare(integration, submitted, saved);

    // Live credentials must work before they are saved; the sandbox never calls real providers.
    if (mode === 'live') await this.runCheck(integration, values);

    const changed = !existing?.credentialsEncrypted || JSON.stringify(sorted(values)) !== JSON.stringify(sorted(saved));
    // New or changed live credentials are reviewed again where the integration needs review.
    const status: ConnectionStatus =
      mode === 'test' || offer.approval === 'automatic' ? 'active' : existing?.status === 'active' && !changed ? 'active' : 'pending_review';
    const data = {
      status,
      credentialsEncrypted: this.encryption().encrypt(JSON.stringify(values)),
      publicValues: Object.fromEntries(integration.fields.filter(item => !item.secret && values[item.key]).map(item => [item.key, values[item.key]])),
      hints: Object.fromEntries(integration.fields.filter(item => item.secret && values[item.key]).map(item => [item.key, hintOf(values[item.key])])),
      lastCheckedAt: mode === 'live' ? new Date() : null,
      lastCheckOk: mode === 'live' ? true : null,
      lastCheckMessage: null,
      decisionNote: null,
      connectedById: userId,
    };
    const connection = await this.prisma.resellerConnection.upsert({
      where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } },
      create: { resellerId, integrationId, mode, ...data },
      update: data,
    });
    await this.audit.record({
      actorId: userId,
      action: existing?.credentialsEncrypted ? 'connection.updated' : 'connection.connected',
      targetType: 'reseller_connection',
      targetId: connection.id,
      before: existing ? auditView(existing) : null,
      after: auditView(connection),
    });
    if (mode === 'live') await this.notify(resellerId, integration.name, status === 'pending_review' ? 'pending' : 'connected');
    if (status === 'pending_review' && existing?.status !== 'pending_review') {
      await this.inbox.admins('admin.connection.review', {
        subject: `${connection.id}:${connection.updatedAt.getTime()}`,
        title: `${integration.name} connection to review`,
        body: `${reseller.name} connected their own ${integration.name} account. Review it before it can be used.`,
        link: '/resellers/connections',
      });
    }
    return presentIntegration(integration, offer.approval, connection, this.apiBase);
  }

  /** Runs the check again (live); the sandbox has nothing to check. */
  async check(resellerId: string, mode: LedgerMode, integrationId: string) {
    const integration = connectable(integrationId);
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (!integration || !connection?.credentialsEncrypted) throw notFound();
    let ok = true;
    let message: string | null = null;
    if (mode === 'live') {
      try {
        await this.runCheck(integration, JSON.parse(this.encryption().decrypt(connection.credentialsEncrypted)) as Record<string, string>);
      } catch (error) {
        ok = false;
        message = error instanceof ApiError ? error.message : 'The check failed.';
      }
    }
    const updated = await this.prisma.resellerConnection.update({ where: { id: connection.id }, data: { lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckMessage: message } });
    const offer = await this.prisma.integrationOffer.findUnique({ where: { integrationId } });
    return presentIntegration(integration, offer?.approval ?? 'review', updated, this.apiBase);
  }

  /** Erases the credentials. A suspended connection stays suspended (with nothing stored) until reinstated. */
  async disconnect(resellerId: string, mode: LedgerMode, userId: string, integrationId: string) {
    const integration = connectable(integrationId);
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (!integration || !connection || connection.status === 'disconnected') throw notFound();
    const updated = await this.prisma.resellerConnection.update({
      where: { id: connection.id },
      data: { status: connection.status === 'suspended' ? 'suspended' : 'disconnected', credentialsEncrypted: null, publicValues: {}, hints: {}, lastCheckOk: null, lastCheckMessage: null },
    });
    await this.audit.record({ actorId: userId, action: 'connection.disconnected', targetType: 'reseller_connection', targetId: connection.id, before: auditView(connection), after: auditView(updated) });
    if (mode === 'live') await this.notify(resellerId, integration.name, 'disconnected');
  }

  /**
   * The decrypted credentials of an active connection, for the reseller's own orders and payments only (later phases).
   * Never returned by the API.
   */
  async credentials(resellerId: string, integrationId: string, mode: LedgerMode) {
    return (await this.active(resellerId, integrationId, mode))?.credentials ?? null;
  }

  /** An active connection's ID and decrypted credentials, or null. */
  async active(resellerId: string, integrationId: string, mode: LedgerMode) {
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode } } });
    if (connection?.status !== 'active' || !connection.credentialsEncrypted) return null;
    return { id: connection.id, credentials: JSON.parse(this.encryption().decrypt(connection.credentialsEncrypted)) as Record<string, string> };
  }

  /**
   * A live supplier connection's saved credentials, whatever its status, to check a notification sent to its own
   * address (only its signature is checked with them; processing still needs the connection active). Null when it does
   * not exist or holds nothing.
   */
  async forNotification(connectionId: string, integrationId: string) {
    const connection = /^[0-9a-f-]{36}$/i.test(connectionId) ? await this.prisma.resellerConnection.findUnique({ where: { id: connectionId } }) : null;
    if (!connection || connection.mode !== 'live' || connection.integrationId !== integrationId || !connection.credentialsEncrypted) return null;
    return { id: connection.id, resellerId: connection.resellerId, credentials: JSON.parse(this.encryption().decrypt(connection.credentialsEncrypted)) as Record<string, string> };
  }

  // ---- Admin

  /** Every connectable integration with where it is offered, its approval and how many resellers use it. */
  async adminOffers() {
    const [offers, counts] = await Promise.all([
      this.prisma.integrationOffer.findMany(),
      this.prisma.resellerConnection.groupBy({ by: ['integrationId', 'status'], where: { mode: 'live' }, _count: { _all: true } }),
    ]);
    return {
      object: 'list' as const,
      data: connectableIntegrations.map(item => {
        const offer = offers.find(row => row.integrationId === item.id);
        const count = (status: ConnectionStatus) => counts.find(row => row.integrationId === item.id && row.status === status)?._count._all ?? 0;
        return {
          object: 'integration_offer' as const,
          integration_id: item.id,
          kind: item.kind,
          name: item.name,
          offered: Boolean(offer && (offer.global || offer.countries.length)),
          global: offer?.global ?? false,
          countries: offer?.countries ?? [],
          approval: offer?.approval ?? 'review',
          connections: { active: count('active'), pending_review: count('pending_review'), suspended: count('suspended') },
          updated_at: offer?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  async setOffer(adminId: string | null, integrationId: string, input: { global: boolean; countries: string[]; approval: IntegrationApproval }) {
    if (!connectable(integrationId)) throw notFound();
    const countries = [...new Set(input.countries.map(code => code.toUpperCase()))].sort();
    const known = await this.prisma.country.findMany({ where: { code: { in: countries } } });
    const unknown = countries.filter(code => !known.some(row => row.code === code));
    if (unknown.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_unknown', `Unknown countries: ${unknown.join(', ')}.`, 'countries');
    const before = await this.prisma.integrationOffer.findUnique({ where: { integrationId } });
    const data = { global: input.global, countries, approval: input.approval, updatedById: adminId };
    const after = await this.prisma.integrationOffer.upsert({ where: { integrationId }, create: { integrationId, ...data }, update: data });
    await this.audit.record({ actorId: adminId, action: 'integration_offer.updated', targetType: 'integration_offer', targetId: integrationId, before, after });
    return (await this.adminOffers()).data.find(item => item.integration_id === integrationId);
  }

  /** Connections for review and oversight, newest first. Live only unless asked. */
  async adminConnections(filter: { status?: ConnectionStatus; mode?: LedgerMode }) {
    const rows = await this.prisma.resellerConnection.findMany({
      where: { status: filter.status, mode: filter.mode ?? 'live' },
      include: { reseller: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return { object: 'list' as const, data: rows.map(row => ({ ...presentAdminConnection(row), reseller: { id: row.reseller.id, name: row.reseller.name, country: row.reseller.country } })) };
  }

  async decide(adminId: string | null, id: string, decision: ConnectionDecision, reason: string | undefined) {
    const connection = await this.prisma.resellerConnection.findUnique({ where: { id }, include: { reseller: true } });
    if (!connection) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such connection.');
    const rule = decisions[decision];
    if ((decision === 'reject' || decision === 'suspend') && !reason?.trim()) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Give a reason; the reseller sees it.', 'reason');
    }
    if (decision === 'reinstate' && !connection.credentialsEncrypted) {
      throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'connection_empty', 'The reseller disconnected it; they connect again instead.');
    }
    // Conditional on the current status, so two admins cannot both decide.
    const claimed = await this.prisma.resellerConnection.updateMany({
      where: { id, status: { in: rule.from } },
      data: {
        status: rule.to,
        decisionNote: reason?.trim() || null,
        decidedById: adminId,
        decidedAt: new Date(),
        // A rejected connection keeps nothing.
        ...(decision === 'reject' ? { credentialsEncrypted: null, publicValues: {}, hints: {} } : {}),
      },
    });
    if (claimed.count === 0) {
      throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'connection_state_changed', `This connection is ${connection.status.replace('_', ' ')}; it cannot be ${decision}d.`);
    }
    const updated = await this.prisma.resellerConnection.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId: adminId, action: `connection.${decision}d`, targetType: 'reseller_connection', targetId: id, before: auditView(connection), after: { ...auditView(updated), reason } });
    const name = connectable(connection.integrationId)?.name ?? connection.integrationId;
    const event = decision === 'approve' || decision === 'reinstate' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';
    await this.notify(connection.resellerId, name, event, reason);
    const outcomes = {
      approve: { type: 'connection.approved', title: `${name} connection approved`, body: `Your own ${name} account is approved and ready to use.` },
      reinstate: { type: 'connection.reinstated', title: `${name} connection reinstated`, body: `BitoCard reinstated your own ${name} account; it is in use again.` },
      reject: { type: 'connection.rejected', title: `${name} connection rejected`, body: `BitoCard rejected your own ${name} account and erased its credentials. Reason: ${reason?.trim()}` },
      suspend: { type: 'connection.suspended', title: `${name} connection suspended`, body: `BitoCard suspended your own ${name} account; orders use BitoCard's suppliers meanwhile. Reason: ${reason?.trim()}` },
    } as const;
    await this.inbox.reseller(connection.resellerId, outcomes[decision].type, {
      subject: `${id}:${updated.decidedAt?.getTime()}`,
      title: outcomes[decision].title,
      body: outcomes[decision].body,
      link: '/integrations',
      mode: connection.mode,
    });
    return { ...presentAdminConnection(updated), reseller: { id: connection.reseller.id, name: connection.reseller.name, country: connection.reseller.country } };
  }

  // ---- Helpers

  /** BitoCard's public API address, where suppliers send notifications. */
  private get apiBase() {
    return this.integrations.config.DIDWW_CALLBACK_URL;
  }

  private async runCheck(integration: ConnectableIntegration, values: Record<string, string>) {
    try {
      await integration.check(values, this.integrations.config);
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'credentials_rejected', `${integration.name} did not accept these credentials. Check them and try again.`, 'values');
      }
      this.logger.warn({ err: error, integration: integration.id }, 'Could not check a reseller connection');
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'integration_unreachable', `We could not reach ${integration.name} to check these credentials. Try again in a moment.`);
    }
  }

  private async notify(resellerId: string, integration: string, event: Parameters<typeof connectionEmail>[2], note?: string) {
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, include: { user: true } });
    if (owner) await this.email.send(connectionEmail(owner.user.email, integration, event, note)).catch(error => this.logger.warn({ err: error, resellerId }, 'Could not send the email'));
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Saving credentials needs ENCRYPTION_KEY to be set.');
    return new Encryption(key);
  }
}

const offeredIn = (offer: { global: boolean; countries: string[] }, country: string | null) => offer.global || Boolean(country && offer.countries.includes(country));

const sorted = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));

function accessDenied(reason: AccessReason) {
  const messages: Record<Exclude<AccessReason, null>, string> = {
    switch_off: 'Connecting your own integrations is not switched on for your account. Contact BitoCard to ask for it.',
    plan: 'Your plan does not include your own integrations. Change plan to use them.',
    not_verified: 'Your account goes live after the identity check; live integrations need a live account.',
    no_country: 'Choose your business country first.',
  };
  return new ApiError(HttpStatus.FORBIDDEN, 'permission_error', `own_integrations_${reason}`, messages[reason as Exclude<AccessReason, null>]);
}

/** Checks the submitted values against the integration's fields. Blank or missing secrets keep the saved ones. */
function prepare(integration: ConnectableIntegration, submitted: Record<string, unknown>, saved: Record<string, string>) {
  const unknown = Object.keys(submitted).find(key => !integration.fields.some(item => item.key === key));
  if (unknown) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_unknown', `${integration.name} has no field ${unknown}.`, `values.${unknown}`);
  const values: Record<string, string> = {};
  for (const item of integration.fields) {
    const raw = submitted[item.key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'invalid_value', `${item.label} must be text.`, `values.${item.key}`);
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > maxValueLength) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'invalid_value', `${item.label} is too long.`, `values.${item.key}`);
    // A non-secret sent as null or "" clears it; a blank secret keeps the saved one.
    const kept = value || (item.secret ? (saved[item.key] ?? '') : raw === undefined ? (saved[item.key] ?? '') : '');
    if (item.required && !kept) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', `Enter the ${item.label}.`, `values.${item.key}`);
    if (kept) values[item.key] = kept;
  }
  return values;
}

/** What the reseller sees: never a secret, only its last four characters. */
function presentIntegration(integration: ConnectableIntegration, approval: IntegrationApproval, connection: ResellerConnection | null, apiBase: string) {
  const publicValues = (connection?.publicValues ?? {}) as Record<string, string>;
  const hints = (connection?.hints ?? {}) as Record<string, string>;
  return {
    object: 'integration' as const,
    id: integration.id,
    kind: integration.kind,
    name: integration.name,
    description: integration.description,
    approval,
    fields: integration.fields.map(item => ({
      key: item.key,
      label: item.label,
      secret: item.secret,
      required: item.required,
      help: item.help ?? null,
      value: item.secret ? null : (publicValues[item.key] ?? null),
      hint: item.secret ? (hints[item.key] ?? null) : null,
    })),
    connection: connection && connection.status !== 'disconnected' ? { ...presentConnection(connection), notifications: notificationSetup(integration, connection, apiBase) } : null,
  };
}

/**
 * Where the supplier sends this live connection's order updates, and whether they can be accepted yet (a manual setup
 * needs the signature secret saved). Null in the sandbox and for suppliers without notifications.
 */
function notificationSetup(integration: ConnectableIntegration, connection: ResellerConnection, apiBase: string) {
  if (!integration.notifications || connection.mode !== 'live') return null;
  const hints = (connection.hints ?? {}) as Record<string, string>;
  return {
    url: `${apiBase.replace(/\/+$/, '')}/v1/webhooks/${integration.id}/${connection.id}`,
    setup: integration.notifications.setup,
    ready: integration.notifications.setup === 'automatic' || Boolean(hints[integration.notifications.secretField]),
  };
}

function presentConnection(connection: ResellerConnection) {
  return {
    object: 'connection' as const,
    id: connection.id,
    mode: connection.mode,
    status: connection.status,
    /** Suppliers: `preferred` (used before BitoCard's suppliers), `fallback` (only when BitoCard has no offer) or `off`. */
    routing: connection.routing,
    catalogue: { synced_at: connection.lastSyncedAt?.toISOString() ?? null, error: connection.lastSyncError },
    decision_note: connection.decisionNote,
    last_check: connection.lastCheckedAt ? { checked_at: connection.lastCheckedAt.toISOString(), ok: connection.lastCheckOk, message: connection.lastCheckMessage } : null,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}

function presentAdminConnection(connection: ResellerConnection) {
  const integration = connectable(connection.integrationId);
  return {
    ...presentConnection(connection),
    integration: { id: connection.integrationId, name: integration?.name ?? connection.integrationId, kind: integration?.kind ?? null },
    // Non-secret values only (for example the account or contract code), to recognise the account.
    public_values: connection.publicValues,
    decided_at: connection.decidedAt?.toISOString() ?? null,
  };
}

/** Audit snapshots: which fields are set (with hints), never a secret or the encrypted blob. */
function auditView(connection: ResellerConnection) {
  return { status: connection.status, mode: connection.mode, integration: connection.integrationId, public_values: connection.publicValues, hints: connection.hints };
}
