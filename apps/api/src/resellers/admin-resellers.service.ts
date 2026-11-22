import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ResellerStatus } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ResellerLimitsService } from './limits.js';

const missingReseller = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');

/** The admin view of resellers: their status, identity check, store ceiling and history. */
@Injectable()
export class AdminResellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly limits: ResellerLimitsService,
  ) {}

  async listResellers(filter: { status?: ResellerStatus; country?: string }) {
    const resellers = await this.prisma.reseller.findMany({
      // BitoCard's own store accounts are not resellers, and Afrippa's operator account is not BitoCard's.
      where: { status: filter.status, country: filter.country?.toUpperCase(), house: false, platform: 'bitocard' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { object: 'list' as const, data: resellers.map(r => ({ object: 'reseller' as const, id: r.id, name: r.name, country: r.country, status: r.status, verified_at: r.verifiedAt?.toISOString() ?? null, test_account: Boolean(r.testAccountAt), created_at: r.createdAt.toISOString() })) };
  }

  async resellerDetail(id: string) {
    const reseller = await this.prisma.reseller.findUnique({
      where: { id },
      include: { members: { include: { user: true } }, stores: true },
    });
    if (!reseller || reseller.platform !== 'bitocard') throw missingReseller();
    const markedBy = reseller.testAccountBy ? await this.prisma.user.findUnique({ where: { id: reseller.testAccountBy }, select: { id: true, name: true } }) : null;
    return {
      object: 'reseller' as const,
      id: reseller.id,
      name: reseller.name,
      country: reseller.country,
      status: reseller.status,
      verified_at: reseller.verifiedAt?.toISOString() ?? null,
      verified_name: reseller.verifiedName,
      /** The mobile number the owner gave when opening the account (E.164), never confirmed. Null when none was given. */
      signup_phone: reseller.signupPhone,
      /** Sells as an `individual` or a `business`, with the profile the reseller keeps (never checked). */
      account_type: reseller.accountType === 'business' ? ('business' as const) : ('individual' as const),
      paused_for_kyb: reseller.kybPausedAt !== null,
      business_profile: {
        legal_name: reseller.legalName,
        address: [reseller.addressLine, reseller.city, reseller.state, reseller.postalCode].filter(Boolean).join(', ') || null,
        phone: reseller.businessPhone,
        description: reseller.businessDescription,
      },
      /** The registered business as KYB verified it; null until then. */
      verified_business:
        reseller.businessType === 'registered' && reseller.kybVerifiedAt
          ? { registered_name: reseller.registeredName, registration_number: reseller.registrationNumber, business_address: reseller.businessAddress, verified_at: reseller.kybVerifiedAt.toISOString() }
          : null,
      /** An admin marked it a test account (activated without the identity check, never moving money out): who, when and why. */
      test_account: reseller.testAccountAt
        ? { marked_at: reseller.testAccountAt.toISOString(), marked_by: markedBy ? { id: markedBy.id, name: markedBy.name } : null, reason: reseller.testAccountReason }
        : null,
      /** How many stores the reseller may run: their own ceiling (`max_stores`), else everyone's; null for no limit. */
      max_stores: reseller.maxStores,
      stores_allowed: await this.limits.storesAllowed(reseller.id),
      /** `two_step`: the member's two-step sign-in method, or null when it is off. `phone`: their confirmed primary mobile number, or null. */
      members: reseller.members.map(m => ({ user_id: m.userId, name: m.user.name, email: m.user.email, role: m.role, two_step: m.user.mfaMethod, phone: m.user.phoneVerifiedAt ? m.user.phone : null })),
      stores: reseller.stores.map(s => ({ id: s.id, name: s.name, subdomain: s.subdomain, status: s.status })),
      options: await this.settings.effectiveOptions(reseller.id),
      features: await this.settings.switchesFor(reseller.id),
      created_at: reseller.createdAt.toISOString(),
    };
  }

  /** Admin: activate (after verification) or suspend. Suspension stops every API key at once. */
  async updateReseller(actorId: string | null, id: string, input: { status?: ResellerStatus }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.platform !== 'bitocard') throw missingReseller();
    // Going live always needs the owner's identity check first; only a test account is activated without it.
    if (input.status === 'active' && before.status !== 'active' && !before.verifiedAt && !before.testAccountAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', "The owner's identity has not been verified yet: they pass the identity check before going live.", 'status');
    }
    const after = await this.prisma.reseller.update({ where: { id }, data: { status: input.status } });
    await this.audit.record({ actorId, action: 'reseller.updated', targetType: 'reseller', targetId: id, before, after });
    if (after.status === 'suspended' && before.status !== 'suspended') {
      await this.inbox.reseller(id, 'account.suspended', {
        subject: `suspended:${after.updatedAt.toISOString()}`,
        title: 'Your account is suspended',
        body: 'Live orders and your store are paused, and your API keys stop working. Contact support to find out why and what to do next.',
        link: '/settings/business',
      });
    }
    return this.resellerDetail(id);
  }

  /**
   * Lifts a suspension (operations, audited with the reason): back to active when the owner's identity is verified or
   * it is a test account, otherwise to pending (they finish the identity check before going live). The team is told.
   */
  async unsuspend(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    if (before.status !== 'suspended') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_suspended', 'This reseller is not suspended.');
    const status: ResellerStatus = before.verifiedAt || before.testAccountAt ? 'active' : 'pending';
    // Claimed on the status, so two admins lifting it at once record it once.
    const claimed = await this.prisma.reseller.updateMany({ where: { id, status: 'suspended' }, data: { status } });
    if (claimed.count === 0) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_suspended', 'This reseller is not suspended.');
    const after = await this.prisma.reseller.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: 'reseller.unsuspended', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    await this.inbox.reseller(id, 'account.reinstated', {
      subject: `reinstated:${after.updatedAt.toISOString()}`,
      title: 'Your account is no longer suspended',
      body: status === 'active' ? 'You can take live orders again, and your store and API keys work again.' : 'Finish the identity check to take live orders again.',
      link: status === 'active' ? '/settings/business' : '/settings/verification',
    });
    return this.resellerDetail(id);
  }

  /**
   * Marks a test account (operations, audited with the reason): it may be activated without the owner's identity check,
   * to try the live flow, and is activated at once when asked. It never moves money out: payouts, the startup allowance
   * and bank account numbers still need the check itself. Every other reseller passes the check before going live.
   */
  async markTestAccount(actorId: string | null, id: string, input: { reason: string; activate?: boolean }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    const activate = input.activate === true && before.status === 'pending';
    const after = await this.prisma.reseller.update({
      where: { id },
      data: { testAccountAt: before.testAccountAt ?? new Date(), testAccountBy: actorId, testAccountReason: input.reason.trim(), status: activate ? 'active' : undefined },
    });
    await this.audit.record({ actorId, action: 'reseller.test_account_marked', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    return this.resellerDetail(id);
  }

  /** No longer a test account (audited). One still unverified and active goes back to pending: it stops selling live. */
  async unmarkTestAccount(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    if (!before.testAccountAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_test_account', 'This reseller is not a test account.');
    const after = await this.prisma.reseller.update({
      where: { id },
      data: { testAccountAt: null, testAccountBy: null, testAccountReason: null, status: !before.verifiedAt && before.status === 'active' ? 'pending' : undefined },
    });
    await this.audit.record({ actorId, action: 'reseller.test_account_unmarked', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    return this.resellerDetail(id);
  }


  /** Sets how many stores the reseller may run (null: everyone's ceiling). Stores already open are never closed. */
  async setStoreLimit(actorId: string | null, id: string, input: { max_stores: number | null; reason: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    const after = await this.prisma.reseller.update({ where: { id }, data: { maxStores: input.max_stores } });
    await this.audit.record({
      actorId,
      action: 'reseller.store_limit_set',
      targetType: 'reseller',
      targetId: id,
      before: { max_stores: before.maxStores },
      after: { max_stores: after.maxStores, reason: input.reason.trim() },
    });
    return this.resellerDetail(id);
  }

  async history(id: string) {
    const entries = await this.audit.list('reseller', id);
    return {
      object: 'list' as const,
      data: entries.map(e => ({ object: 'audit_entry' as const, action: e.action, actor_id: e.actorId, before: e.before, after: e.after, created_at: e.createdAt.toISOString() })),
    };
  }
}
