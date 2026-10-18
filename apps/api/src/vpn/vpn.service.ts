import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, Prisma, type VpnSubscription } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ProviderError } from '../payments/provider-error.js';
import type { VpnState } from '../suppliers/adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { vpnExpiryDate, VpnresellersAdapter, vpnTermDays } from '../suppliers/vpnresellers.adapter.js';
import { EventsService } from '../webhooks/events.service.js';
import { vpnPassword } from './vpn-credentials.service.js';
import { presentVpn, presentVpnForAdmin, type VpnStatus, vpnStatuses } from './presenter.js';

export { presentVpn, presentVpnForAdmin, vpnStatuses };

/** Final: access is off for good and nothing more is checked (the daily reconciliation still catches a re-enabled one). */
const ended = new Set<VpnStatus>(['expired', 'revoked', 'failed']);

/** An active account is read again at least this often, and when shown and older than `freshMs`. */
const activeSyncMs = 6 * 60 * 60 * 1000;
const freshMs = 10 * 60 * 1000;
/** After a failed supplier check, ask again on this schedule; past its end, admins are told. */
const retryMs = [5, 15, 60, 180, 360].map(minutes => minutes * 60 * 1000);
/** A password can be reset at most once a minute. */
const resetEveryMs = 60 * 1000;
/** Credit alert: below this many dollars (the integration's `LOW_BALANCE_USD`), or lasting fewer days than this. */
const defaultLowBalanceUsd = 25;
const lowRunwayDays = 7;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such VPN subscription.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);


type Actor = { kind: 'reseller'; resellerId: string } | { kind: 'customer'; orderId: string } | { kind: 'admin'; adminId: string; reason: string };

/**
 * VPN access after its order. Supplier accounts bill every day they are Active, so BitoCard, not the supplier, ends
 * them: each subscription has the state it should be in (active within its term while its order is completed; off
 * otherwise), and `sync` makes the supplier match, then reads it back before believing it.
 *
 * - **Ending access:** at `expires_at` (`expired`), after its order is refunded (`revoked`), or by an admin
 *   (`suspended`). Disabled with the supplier and read again; until confirmed, retried and then raised to admins.
 * - **Drift:** an active account whose supplier expiry differs from ours (or has none, which renews automatically) is
 *   set back to our date; one the supplier disabled during its term goes to `needs_review` (never re-enabled blindly).
 * - **Password reset:** a new password is stored encrypted as pending before the supplier is asked, and sent again
 *   until confirmed, so an unclear reply never leaves the customer with a password nobody knows.
 * - **Reconciliation** (daily): the supplier's Active accounts against ours, its credit, the credit used since the
 *   last check and how long it lasts; admins are told about strays and low credit.
 *
 * Sandbox subscriptions (and `sandbox_` accounts) never call the supplier: their transitions are simulated.
 */
@Injectable()
export class VpnService {
  private readonly logger = new Logger('Vpn');

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: SupplierAdapters,
    private readonly events: EventsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private simulated(sub: Pick<VpnSubscription, 'mode' | 'supplierAccountId'>) {
    return sub.mode === 'test' || Boolean(sub.supplierAccountId?.startsWith('sandbox_'));
  }

  private supplier(sub: VpnSubscription) {
    const supplier = this.adapters.get(sub.supplierCode).vpn;
    if (!supplier) throw new ProviderError(sub.supplierCode, 'VPN accounts cannot be managed with this supplier', true);
    return supplier;
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  // -- Reading -------------------------------------------------------------------------------------------------------

  async list(resellerId: string, mode: LedgerMode, filter: { order_id?: string; status?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.vpnSubscription.findMany({
      where: { resellerId, mode, ...(filter.order_id ? { orderId: filter.order_id } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(presentVpn), has_more: rows.length > limit };
  }

  private async find(resellerId: string, mode: LedgerMode, id: string) {
    const sub = await this.prisma.vpnSubscription.findFirst({ where: { id, resellerId, mode } });
    if (!sub) throw notFound();
    return sub;
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    return presentVpn(await this.fresh(await this.find(resellerId, mode, id)));
  }

  /** The order's VPN access (its page, for the customer who proved the order is theirs). */
  async forOrder(orderId: string) {
    const sub = await this.prisma.vpnSubscription.findUnique({ where: { orderId } });
    return sub ? presentVpn(await this.fresh(sub)) : null;
  }

  /** Read again from the supplier when shown and stale (never fails the read). */
  private async fresh(sub: VpnSubscription) {
    if (sub.status !== 'active' || (sub.lastSyncedAt && Date.now() - sub.lastSyncedAt.getTime() < freshMs)) return sub;
    try {
      return await this.sync(sub.id);
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', vpnId: sub.id }, 'VPN status not read');
      return sub;
    }
  }

  // -- Keeping the supplier in step ----------------------------------------------------------------------------------

  /**
   * What the subscription should be now, from its order: `active` within its term while the order is completed, else
   * the state that ends it. Null while the order is still being provisioned (the order flow owns it until then).
   */
  private desired(sub: VpnSubscription, orderStatus: string, now: Date): VpnStatus | null {
    if (orderStatus === 'processing') return null;
    if (orderStatus === 'failed') return 'failed';
    if (orderStatus === 'refunded') return 'revoked';
    // Past its term, access has ended whatever else happened (a suspension or a review ends with it).
    if (sub.expiresAt && sub.expiresAt <= now) return 'expired';
    if (sub.status === 'suspended') return 'suspended';
    return 'active';
  }

  /**
   * Makes the supplier match what the subscription should be, reads it back, and saves the outcome (with a
   * `vpn_subscription.updated` event when the status changed). Returns the saved subscription.
   */
  async sync(id: string, now = new Date()): Promise<VpnSubscription> {
    const sub = await this.prisma.vpnSubscription.findUniqueOrThrow({ where: { id }, include: { order: { select: { status: true } } } });
    const want = this.desired(sub, sub.order.status, now);
    if (!want) return sub;
    if (!sub.supplierAccountId) {
      // No account was ever confirmed: nothing to switch off.
      return this.save(sub, { status: want === 'active' ? 'needs_review' : want === 'suspended' ? 'suspended' : 'failed', nextSyncAt: null, lastSyncedAt: now }, want === 'active' ? 'Completed order has no supplier account' : null);
    }
    if (this.simulated(sub)) {
      return this.save(sub, { status: want, supplierStatus: want === 'active' ? 'Active' : 'Disabled', lastSyncedAt: now, syncFailures: 0, lastError: null, ...this.endFields(sub, want, now) }, null);
    }
    try {
      const supplier = this.supplier(sub);
      let state = await supplier.status(sub.supplierAccountId);
      if (want === 'active') {
        if (state.status === 'disabled') {
          return this.save(sub, { status: 'needs_review', supplierStatus: state.supplierStatus, lastSyncedAt: now, nextSyncAt: null, syncFailures: 0, lastError: 'Disabled at the supplier during its term' }, 'The supplier disabled this account before its term ended. Check why before enabling it again.');
        }
        const ours = sub.expiresAt ? vpnExpiryDate(sub.expiresAt) : null;
        const theirs = state.expiresAt ? vpnExpiryDate(state.expiresAt) : null;
        let drift: string | null = null;
        if (ours && theirs !== ours) {
          state = await supplier.expire(sub.supplierAccountId, ours);
          state = await supplier.status(sub.supplierAccountId);
          drift = `Supplier expiry was ${theirs ?? 'none (auto-renewal)'}; set back to ${ours}.`;
          if ((state.expiresAt ? vpnExpiryDate(state.expiresAt) : null) !== ours) throw new ProviderError(sub.supplierCode, `expiry still ${state.expiresAt?.toISOString() ?? 'none'} after setting ${ours}`, false);
        }
        const saved = await this.save(
          sub,
          { status: 'active', supplierStatus: state.supplierStatus, lastSyncedAt: now, syncFailures: 0, lastError: null, nextSyncAt: this.nextActiveSync(sub, now) },
          null,
        );
        if (drift) await this.alert(saved, 'VPN expiry drift corrected', drift, true);
        return saved;
      }
      // Access should be off.
      if (state.status !== 'disabled') {
        await supplier.disable(sub.supplierAccountId);
        state = await supplier.status(sub.supplierAccountId);
      }
      if (state.status !== 'disabled') throw new ProviderError(sub.supplierCode, `still ${state.supplierStatus ?? 'unknown'} after disabling`, false);
      return this.save(sub, { status: want, supplierStatus: state.supplierStatus, lastSyncedAt: now, syncFailures: 0, lastError: null, ...this.endFields(sub, want, now) }, null);
    } catch (error) {
      return this.failedCheck(sub, want, error as Error, now);
    }
  }

  private endFields(sub: VpnSubscription, want: VpnStatus, now: Date) {
    if (want === 'active') return { nextSyncAt: this.nextActiveSync(sub, now), disabledAt: null };
    // A suspension is looked at again when its term ends, to close it as expired.
    return { nextSyncAt: want === 'suspended' && sub.expiresAt && sub.expiresAt > now ? sub.expiresAt : null, disabledAt: sub.disabledAt ?? now };
  }

  /** At the end of its term, else within `activeSyncMs`. */
  private nextActiveSync(sub: VpnSubscription, now: Date) {
    const regular = new Date(now.getTime() + activeSyncMs);
    return sub.expiresAt && sub.expiresAt < regular ? sub.expiresAt : regular;
  }

  /** A supplier check that did not settle: asked again later; past the schedule, admins are told (billing may continue). */
  private async failedCheck(sub: VpnSubscription, want: VpnStatus, error: Error, now: Date) {
    const failures = sub.syncFailures + 1;
    const delay = retryMs[Math.min(failures - 1, retryMs.length - 1)];
    const saved = await this.prisma.vpnSubscription.update({
      where: { id: sub.id },
      data: { syncFailures: failures, lastError: error.message.slice(0, 500), nextSyncAt: new Date(now.getTime() + delay) },
    });
    this.logger.warn({ vpnId: sub.id, failures, err: error.message }, 'VPN supplier check failed');
    if (failures >= retryMs.length) {
      await this.alert(saved, want === 'active' ? 'VPN account not confirmed' : 'VPN account still billing', `The supplier has not confirmed this account is ${want === 'active' ? 'active with its expiry' : 'disabled'} after ${failures} checks: ${error.message.slice(0, 200)}`);
    }
    return saved;
  }

  /** Saves a check's outcome; records `vpn_subscription.updated` when the status changed, and tells admins when asked. */
  private async save(sub: VpnSubscription, data: Prisma.VpnSubscriptionUpdateInput, attention: string | null) {
    const changed = data.status !== undefined && data.status !== sub.status;
    const saved = await this.prisma.$transaction(async tx => {
      const updated = await tx.vpnSubscription.update({ where: { id: sub.id }, data });
      if (changed) await this.events.record(tx, { resellerId: sub.resellerId, mode: sub.mode, type: 'vpn_subscription.updated', object: presentVpn(updated) });
      return updated;
    });
    if (changed) this.events.committed();
    if (attention) await this.alert(saved, 'VPN account needs review', attention);
    return saved;
  }

  /** Tells operations at most once a day per account (`alertedAt`), or every time for `always` (corrections made). */
  private async alert(sub: VpnSubscription, title: string, body: string, always = false) {
    if (sub.mode !== 'live') return;
    const now = Date.now();
    if (!always && sub.alertedAt && now - sub.alertedAt.getTime() < 24 * 60 * 60 * 1000) return;
    await this.prisma.vpnSubscription.update({ where: { id: sub.id }, data: { alertedAt: new Date(now) } });
    await this.inbox.admins('admin.vpn.attention', { subject: `${sub.id}:${title}:${new Date(now).toISOString().slice(0, always ? 19 : 10)}`, title, body, link: `/orders/vpn?q=${sub.orderId}` });
  }

  /**
   * Every few minutes: subscriptions due a check (term ending, retries, stale active ones), those whose order was
   * refunded or failed and are not ended yet, and password resets still unconfirmed.
   */
  async job(now = new Date()) {
    const due = await this.prisma.vpnSubscription.findMany({
      where: {
        OR: [
          { status: { in: ['active', 'suspended', 'provisioning'] }, nextSyncAt: { lte: now } },
          { status: { in: ['active', 'provisioning', 'needs_review', 'suspended'] }, order: { status: { in: ['refunded', 'failed'] } } },
          { status: { in: ['active', 'suspended', 'needs_review'] }, expiresAt: { lte: now } },
        ],
      },
      orderBy: { nextSyncAt: 'asc' },
      select: { id: true },
      take: 50,
    });
    const outcome = { checked: 0, ended: 0, passwords: 0 };
    for (const { id } of due) {
      try {
        const saved = await this.sync(id, now);
        outcome.checked += 1;
        if (ended.has(saved.status as VpnStatus)) outcome.ended += 1;
      } catch (error) {
        this.logger.error({ err: error, vpnId: id }, 'VPN check failed');
      }
    }
    const pending = await this.prisma.vpnSubscription.findMany({ where: { pendingPasswordEncrypted: { not: null }, status: 'active' }, select: { id: true }, take: 20 });
    for (const { id } of pending) {
      try {
        if ((await this.applyPendingPassword(id)) === 'changed') outcome.passwords += 1;
      } catch (error) {
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', vpnId: id }, 'VPN password change still unconfirmed');
      }
    }
    return outcome;
  }

  // -- Password reset ------------------------------------------------------------------------------------------------

  async resellerReset(resellerId: string, mode: LedgerMode, id: string) {
    const sub = await this.find(resellerId, mode, id);
    return this.reset(sub, { kind: 'reseller', resellerId });
  }

  async customerReset(order: { id: string }) {
    const sub = await this.prisma.vpnSubscription.findUnique({ where: { orderId: order.id } });
    if (!sub) throw notFound();
    return this.reset(sub, { kind: 'customer', orderId: order.id });
  }

  /**
   * A new password for active access. The new one is kept encrypted as pending before the supplier is asked; once
   * the supplier confirms, it replaces the delivered one (the order shows it). An unclear reply keeps it pending and
   * the same password is sent again (by the next request or the job), never a different one.
   */
  private async reset(sub: VpnSubscription, actor: Actor) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: sub.orderId }, select: { status: true } });
    if (order.status !== 'completed' || sub.status !== 'active' || (sub.expiresAt && sub.expiresAt <= new Date())) {
      throw conflict('vpn_not_active', 'Only active VPN access can have its password reset.');
    }
    if (!sub.pendingPasswordEncrypted && sub.passwordChangedAt && Date.now() - sub.passwordChangedAt.getTime() < resetEveryMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'password_recently_reset', 'The password was just reset. Wait a minute before resetting it again.');
    }
    if (!sub.pendingPasswordEncrypted) {
      const claimed = await this.prisma.vpnSubscription.updateMany({ where: { id: sub.id, pendingPasswordEncrypted: null }, data: { pendingPasswordEncrypted: this.encryption().encrypt(vpnPassword()) } });
      if (claimed.count === 0) this.logger.log({ vpnId: sub.id }, 'VPN password reset already in progress; continuing it');
    }
    const outcome = await this.applyPendingPassword(sub.id);
    if (outcome === 'refused') throw conflict('vpn_password_reset_failed', 'The password could not be reset. Try again shortly, or contact support.');
    if (outcome === 'unclear') {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'vpn_password_reset_pending', 'The new password is not confirmed yet. Try again in a minute: the same reset continues.');
    }
    const saved = await this.prisma.vpnSubscription.findUniqueOrThrow({ where: { id: sub.id }, include: { delivery: true } });
    if (actor.kind === 'admin') {
      await this.audit.record({ actorId: actor.adminId, action: 'vpn.password_reset', targetType: 'vpn_subscription', targetId: sub.id, before: { credential_version: sub.credentialVersion }, after: { credential_version: saved.credentialVersion, reason: actor.reason } });
      return { vpn_subscription: presentVpnForAdmin(saved) };
    }
    return {
      vpn_subscription: presentVpn(saved),
      credentials: { username: saved.delivery.serial!, password: this.encryption().decrypt(saved.delivery.codeEncrypted!) },
    };
  }

  /** Sends the pending password; `changed` once confirmed (and saved as the delivered one), else `unclear` or `refused`. */
  private async applyPendingPassword(id: string): Promise<'changed' | 'unclear' | 'refused' | 'none'> {
    const sub = await this.prisma.vpnSubscription.findUniqueOrThrow({ where: { id } });
    if (!sub.pendingPasswordEncrypted) return 'none';
    const encryption = this.encryption();
    if (!this.simulated(sub)) {
      if (!sub.supplierAccountId) return 'refused';
      try {
        const state: VpnState = await this.supplier(sub).changePassword(sub.supplierAccountId, encryption.decrypt(sub.pendingPasswordEncrypted));
        if (state.supplierAccountId !== sub.supplierAccountId) throw new ProviderError(sub.supplierCode, 'password change answered for another account', false);
      } catch (error) {
        if (error instanceof ProviderError && error.definite) {
          await this.prisma.vpnSubscription.updateMany({ where: { id, pendingPasswordEncrypted: sub.pendingPasswordEncrypted }, data: { pendingPasswordEncrypted: null, lastError: error.message.slice(0, 500) } });
          return 'refused';
        }
        return 'unclear';
      }
    }
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.vpnSubscription.updateMany({
        where: { id, pendingPasswordEncrypted: sub.pendingPasswordEncrypted },
        data: { pendingPasswordEncrypted: null, passwordChangedAt: new Date(), credentialVersion: { increment: 1 } },
      });
      if (claimed.count === 0) return;
      const delivery = await tx.orderDelivery.findUniqueOrThrow({ where: { id: sub.deliveryId } });
      await tx.orderDelivery.update({
        where: { id: sub.deliveryId },
        data: { codeEncrypted: sub.pendingPasswordEncrypted, details: { ...((delivery.details as Record<string, string> | null) ?? {}), credential_version: String(sub.credentialVersion + 1) } },
      });
    });
    return 'changed';
  }

  // -- Admins --------------------------------------------------------------------------------------------------------

  async adminList(filter: { status?: string; mode?: LedgerMode; q?: string; limit?: number }) {
    const q = filter.q?.trim();
    const uuid = q && /^[0-9a-f-]{36}$/i.test(q) ? q : null;
    const rows = await this.prisma.vpnSubscription.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.mode ? { mode: filter.mode } : {}),
        ...(q ? { OR: uuid ? [{ id: uuid }, { orderId: uuid }, { resellerId: uuid }] : [{ supplierAccountId: q }, { delivery: { serial: q } }] } : {}),
      },
      include: { order: { select: { status: true, resellerId: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(filter.limit ?? 100, 200),
    });
    return { object: 'list' as const, data: rows.map(presentVpnForAdmin) };
  }

  /** Counts by status, accounts needing attention, and the latest reconciliation. */
  async health() {
    const [counts, attention, latest, dueSoon] = await Promise.all([
      this.prisma.vpnSubscription.groupBy({ by: ['status', 'mode'], _count: { _all: true } }),
      this.prisma.vpnSubscription.count({ where: { mode: 'live', OR: [{ status: 'needs_review' }, { syncFailures: { gte: retryMs.length } }, { pendingPasswordEncrypted: { not: null } }] } }),
      this.prisma.vpnReconciliation.findFirst({ where: { supplierCode: 'vpnresellers' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.vpnSubscription.count({ where: { mode: 'live', status: 'active', expiresAt: { lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } } }),
    ]);
    const live = Object.fromEntries(vpnStatuses.map(status => [status, counts.find(row => row.status === status && row.mode === 'live')?._count._all ?? 0]));
    const test = Object.fromEntries(vpnStatuses.map(status => [status, counts.find(row => row.status === status && row.mode === 'test')?._count._all ?? 0]));
    return { object: 'vpn_health' as const, live, test, needs_attention: attention, ending_in_3_days: dueSoon, reconciliation: latest ? presentReconciliation(latest) : null, low_balance_usd: this.lowBalanceUsd() };
  }

  async adminSync(adminId: string, id: string) {
    await this.prisma.vpnSubscription.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw notFound();
    });
    const saved = await this.sync(id);
    await this.audit.record({ actorId: adminId, action: 'vpn.synced', targetType: 'vpn_subscription', targetId: id, before: null, after: { status: saved.status } });
    return presentVpnForAdmin(saved);
  }

  /** Suspends active access (abuse, a supplier problem): disabled with the supplier, `suspended` until enabled again. */
  async adminSuspend(adminId: string, id: string, reason: string) {
    const sub = await this.prisma.vpnSubscription.findUnique({ where: { id } });
    if (!sub) throw notFound();
    if (!['active', 'needs_review'].includes(sub.status)) throw conflict('vpn_not_active', 'Only active VPN access, or access under review, can be suspended.');
    await this.save(sub, { status: 'suspended', nextSyncAt: new Date() }, null);
    const saved = await this.sync(id);
    await this.audit.record({ actorId: adminId, action: 'vpn.suspended', targetType: 'vpn_subscription', targetId: id, before: presentVpnForAdmin(sub), after: { ...presentVpnForAdmin(saved), reason } });
    return presentVpnForAdmin(saved);
  }

  /**
   * Turns access back on within its term (after a suspension, or once a review found the supplier's disable was a
   * mistake): enabled with the supplier and its expiry checked again.
   */
  async adminEnable(adminId: string, id: string, reason: string) {
    const sub = await this.prisma.vpnSubscription.findUnique({ where: { id }, include: { order: { select: { status: true } } } });
    if (!sub) throw notFound();
    if (!['suspended', 'needs_review'].includes(sub.status)) throw conflict('vpn_not_suspended', 'Only suspended VPN access, or access under review, can be enabled.');
    if (sub.order.status !== 'completed' || !sub.supplierAccountId || !sub.expiresAt || sub.expiresAt <= new Date()) throw conflict('vpn_term_over', 'This VPN access cannot be enabled: its order is not completed or its term has ended.');
    if (!this.simulated(sub)) {
      try {
        await this.supplier(sub).enable(sub.supplierAccountId);
      } catch (error) {
        throw conflict('vpn_enable_failed', `The supplier did not enable the account: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    await this.save(sub, { status: 'active', disabledAt: null, syncFailures: 0, nextSyncAt: new Date() }, null);
    const saved = await this.sync(id);
    await this.audit.record({ actorId: adminId, action: 'vpn.enabled', targetType: 'vpn_subscription', targetId: id, before: presentVpnForAdmin(sub), after: { ...presentVpnForAdmin(saved), reason } });
    return presentVpnForAdmin(saved);
  }

  async adminReset(adminId: string, id: string, reason: string) {
    const sub = await this.prisma.vpnSubscription.findUnique({ where: { id } });
    if (!sub) throw notFound();
    return this.reset(sub, { kind: 'admin', adminId, reason });
  }

  // -- Reconciliation ------------------------------------------------------------------------------------------------

  private lowBalanceUsd() {
    const value = Number(this.integrations.supplier('vpnresellers').LOW_BALANCE_USD);
    return Number.isFinite(value) && value > 0 ? value : defaultLowBalanceUsd;
  }

  /**
   * Daily, live only: every Active account at the supplier against BitoCard's active subscriptions, the credit left,
   * the credit used since the last check, and how many days it lasts. Ours that should be off are checked at once;
   * strays and low credit are raised to admins. Nothing is concluded from an incomplete list.
   */
  async reconcile(adminId: string | null = null) {
    const adapter = this.adapters.get('vpnresellers');
    if (!(adapter instanceof VpnresellersAdapter) || !adapter.configured()) return { skipped: 'not_configured' as const };
    const expected = await this.prisma.vpnSubscription.findMany({ where: { mode: 'live', status: 'active', supplierCode: 'vpnresellers' }, select: { id: true, supplierAccountId: true } });
    const previous = await this.prisma.vpnReconciliation.findFirst({ where: { supplierCode: 'vpnresellers', balanceCents: { not: null } }, orderBy: { createdAt: 'desc' } });
    let balance: number | null = null;
    let listed: Awaited<ReturnType<VpnresellersAdapter['listAccounts']>> | null = null;
    const errors: string[] = [];
    try {
      balance = await adapter.balanceUsd();
    } catch (error) {
      errors.push(`balance: ${(error as Error).message}`);
    }
    try {
      listed = await adapter.listAccounts('Active');
    } catch (error) {
      errors.push(`accounts: ${(error as Error).message}`);
    }
    const complete = Boolean(listed?.complete);
    const active = new Set(listed?.accounts.filter(item => item.status === 'active').map(item => item.id) ?? []);
    const ours = new Set(expected.map(item => item.supplierAccountId).filter((value): value is string => Boolean(value)));
    const unexpected = complete ? (listed?.accounts ?? []).filter(item => item.status === 'active' && !ours.has(item.id)).map(item => ({ id: item.id, username: item.username })) : [];
    const missing = complete ? expected.filter(item => item.supplierAccountId && !active.has(item.supplierAccountId)).map(item => ({ id: item.id, supplier_account_id: item.supplierAccountId })) : [];
    const monthly = adapter.monthlyCostUsd();
    const billed = complete ? active.size : expected.length;
    const runway = balance !== null && monthly && billed > 0 ? balance / ((billed * monthly) / vpnTermDays) : null;
    const balanceCents = balance === null ? null : Math.round(balance * 100);
    const spent = balanceCents !== null && previous?.balanceCents != null && previous.balanceCents >= balanceCents ? previous.balanceCents - balanceCents : null;
    const saved = await this.prisma.vpnReconciliation.create({
      data: {
        supplierCode: 'vpnresellers',
        balanceCents,
        spentCents: spent,
        supplierActive: complete ? active.size : 0,
        expectedActive: expected.length,
        runwayDays: runway,
        unexpected: unexpected as Prisma.InputJsonValue,
        missing: missing as Prisma.InputJsonValue,
        complete,
        error: errors.join('; ').slice(0, 1000) || null,
      },
    });
    // Ours that the supplier bills but should be off are checked again now; ours it shows inactive, too.
    if (unexpected.length) {
      const strays = await this.prisma.vpnSubscription.findMany({ where: { supplierCode: 'vpnresellers', mode: 'live', supplierAccountId: { in: unexpected.map(item => item.id) } }, select: { id: true } });
      if (strays.length) await this.prisma.vpnSubscription.updateMany({ where: { id: { in: strays.map(item => item.id) } }, data: { nextSyncAt: new Date() } });
    }
    if (missing.length) await this.prisma.vpnSubscription.updateMany({ where: { id: { in: missing.map(item => item.id) } }, data: { nextSyncAt: new Date() } });
    const day = new Date().toISOString().slice(0, 10);
    if (unexpected.length) {
      await this.inbox.admins('admin.vpn.attention', {
        subject: `vpn-reconcile:${day}:unexpected`,
        title: `${unexpected.length} VPN ${unexpected.length === 1 ? 'account is' : 'accounts are'} billing unexpectedly`,
        body: `The supplier shows ${unexpected.length} Active ${unexpected.length === 1 ? 'account' : 'accounts'} BitoCard does not expect to be active (${unexpected.slice(0, 5).map(item => item.username).join(', ')}${unexpected.length > 5 ? '…' : ''}). Ours are being disabled; disable any others in the supplier panel.`,
        link: '/orders/vpn',
      });
    }
    if (balance !== null && (balance < this.lowBalanceUsd() || (runway !== null && runway < lowRunwayDays))) {
      await this.inbox.admins('admin.vpn.credit_low', {
        subject: `vpn-reconcile:${day}:credit`,
        title: 'VPN supplier credit is running low',
        body: `$${balance.toFixed(2)} left${runway !== null ? `, about ${Math.floor(runway)} days at ${billed} active ${billed === 1 ? 'account' : 'accounts'}` : ''}. Top up the supplier account: new VPN orders fail once it runs out.`,
        link: '/orders/vpn',
      });
    }
    if (adminId) await this.audit.record({ actorId: adminId, action: 'vpn.reconciliation_run', targetType: 'vpn_reconciliation', targetId: saved.id, before: null, after: presentReconciliation(saved) });
    return presentReconciliation(saved);
  }

  async reconciliations(limit = 30) {
    const rows = await this.prisma.vpnReconciliation.findMany({ where: { supplierCode: 'vpnresellers' }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 90) });
    return { object: 'list' as const, data: rows.map(presentReconciliation) };
  }
}

export function presentReconciliation(row: { id: string; balanceCents: number | null; spentCents: number | null; supplierActive: number; expectedActive: number; runwayDays: number | null; unexpected: Prisma.JsonValue; missing: Prisma.JsonValue; complete: boolean; error: string | null; createdAt: Date }) {
  return {
    object: 'vpn_reconciliation' as const,
    id: row.id,
    balance_usd_cents: row.balanceCents,
    spent_usd_cents: row.spentCents,
    supplier_active: row.supplierActive,
    expected_active: row.expectedActive,
    runway_days: row.runwayDays === null ? null : Math.round(row.runwayDays * 10) / 10,
    unexpected: row.unexpected,
    missing: row.missing,
    complete: row.complete,
    error: row.error,
    created_at: row.createdAt.toISOString(),
  };
}
