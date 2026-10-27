import { Encryption } from '../common/encryption.js';
import { AllowanceService } from '../ledger/allowance.service.js';
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { IdentityVerification, LedgerMode, VerificationStatus } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { resellerVerificationEmail } from '../notifications/templates.js';
import { PaymentProviders } from '../payments/payment-providers.js';
import { resellerNotVerified, testModeOnly } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventsService } from '../webhooks/events.service.js';
import { DiditProvider } from './didit.provider.js';
import { type CheckResult, namesMatch } from './providers.js';
import { InboxService } from '../notifications/inbox.service.js';
import { africanCountries } from '../kyc/catalogue.js';
import { providerName as verifyProvider, VerifyLinks } from '../kyc/links.js';

/** Statuses a provider (or an admin, for in_review) can still change. */
const openStatuses: VerificationStatus[] = ['in_progress', 'in_review'];
/** An unfinished session is offered again for this long, then a new one is started. */
const reuseSessionMs = 24 * 3600 * 1000;
/** Checks nobody finished are closed after this. */
const expireAfterMs = 7 * 24 * 3600 * 1000;


const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such verification.');
const consentRequired = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'consent_required', 'The person must agree to the identity check (including the face check) first.', 'consent');
const unavailable = (what: string) => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', `${what} is not available right now.`);

/** Reason codes shown to resellers; admins see the provider's own reason. */
const publicReason = (record: IdentityVerification) => {
  if (record.status === 'expired') return 'expired';
  if (record.status !== 'declined') return null;
  if (record.reason === 'name_mismatch' || record.reason === 'bvn_consent_declined') return record.reason;
  return 'not_verified';
};

export function presentCustomerVerification(record: IdentityVerification) {
  return {
    object: 'customer_verification' as const,
    id: record.id,
    mode: record.mode,
    customer_reference: record.customerReference,
    status: record.status,
    method: record.method,
    country: record.country,
    /** Send the customer here to complete the check; null once finished (and in test mode). */
    url: record.status === 'in_progress' ? record.url : null,
    verified_name: record.status === 'approved' ? record.verifiedName : null,
    reason: publicReason(record),
    created_at: record.createdAt.toISOString(),
    decided_at: record.decidedAt?.toISOString() ?? null,
  };
}

function presentResellerVerification(
  record: IdentityVerification | null,
  reseller: { status: string; verifiedAt: Date | null; businessType?: string | null; kybVerifiedAt?: Date | null },
  provider: 'bitocard' | 'didit',
) {
  return {
    object: 'reseller_verification' as const,
    /** Who checks: BitoCard Verify (African countries: the business's KYB) or Didit. */
    provider,
    kind: provider === 'bitocard' ? ('kyb' as const) : ('kyc' as const),
    business_type: reseller.businessType ?? null,
    kyb_verified: Boolean(reseller.kybVerifiedAt),
    reseller_status: reseller.status,
    verified: reseller.verifiedAt !== null,
    verified_at: reseller.verifiedAt?.toISOString() ?? null,
    status: record?.status ?? 'not_started',
    url: record?.status === 'in_progress' ? record.url : null,
    reason: record ? publicReason(record) : null,
    started_at: record?.createdAt.toISOString() ?? null,
  };
}

/** The owner's BVN check for reserved accounts. The BVN itself is never returned. */
function presentBvnCheck(record: IdentityVerification | null, reseller: { bvnVerifiedAt: Date | null }) {
  return {
    object: 'bvn_check' as const,
    verified: reseller.bvnVerifiedAt !== null,
    verified_at: reseller.bvnVerifiedAt?.toISOString() ?? null,
    status: record?.status ?? 'not_started',
    /** Flutterwave's consent page, while the check is in progress. */
    url: record?.status === 'in_progress' ? record.url : null,
    reason: record ? publicReason(record) : null,
    started_at: record?.createdAt.toISOString() ?? null,
  };
}

const fullName = (result: CheckResult) => [result.firstName, result.lastName].filter(Boolean).join(' ').trim() || null;

/**
 * Identity checks. Reseller owners are checked with Didit (document, liveness and face match) before going live;
 * customers with BVN consent in Nigeria and Didit elsewhere, keyed by the reseller's own customer reference. Results
 * are re-read from the provider, applied once, and only the outcome and verified name are kept.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger('Identity');
  private readonly diditClient: () => DiditProvider | null;

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly settings: SettingsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly allowance: AllowanceService,
    private readonly inbox: InboxService,
    private readonly verify: VerifyLinks,
  ) {
    this.diditClient = integrations.derive(config =>
      config.DIDIT_API_KEY && config.DIDIT_WORKFLOW_ID ? new DiditProvider(config.DIDIT_API_KEY, config.DIDIT_WORKFLOW_ID, config.DIDIT_API_URL, config.DIDIT_WEBHOOK_SECRET) : null,
    );
  }

  /** Didit with the current admin settings; null until its API key and workflow are set. */
  get didit(): DiditProvider | null {
    return this.diditClient();
  }

  private providerFailure(error: unknown, what: string) {
    if (error instanceof ProviderError && error.definite) {
      return new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'verification_refused', `The ${what} could not be started. Check the details and try again.`);
    }
    this.logger.warn({ err: error }, 'Identity provider failed');
    return new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The identity check could not be started. Try again shortly.');
  }

  /** Who checks identities in a country: the market's choice, else BitoCard Verify across Africa and Didit elsewhere. */
  async providerFor(country: string | null | undefined): Promise<'bitocard' | 'didit'> {
    const code = (country ?? '').toUpperCase();
    const market = code ? await this.prisma.country.findUnique({ where: { code }, select: { identityProvider: true } }) : null;
    if (market) return market.identityProvider === 'bitocard' ? 'bitocard' : 'didit';
    return africanCountries.has(code) ? 'bitocard' : 'didit';
  }

  /**
   * A BitoCard Verify link works once and for 30 minutes, so reads never hand out the stored one (it is almost always
   * spent): the applicant continues by starting the check again, which opens a fresh link into the same case.
   */
  private withoutSpentLink<T extends IdentityVerification | null>(record: T): T {
    return record && record.provider === verifyProvider ? { ...record, url: null } : record;
  }

  /** An open BitoCard Verify check gets a fresh single-use link (the last one may have been used or expired). */
  private async freshLink(record: IdentityVerification) {
    if (record.provider !== verifyProvider || record.status !== 'in_progress') return record;
    const url = await this.verify.link(record.providerReference);
    return this.prisma.identityVerification.update({ where: { id: record.id }, data: { url } });
  }

  // -- Resellers -------------------------------------------------------------------------------------------------

  async resellerVerification(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const record = await this.prisma.identityVerification.findFirst({ where: { resellerId, subject: 'reseller', method: 'document' }, orderBy: { createdAt: 'desc' } });
    return presentResellerVerification(this.withoutSpentLink(record), reseller, await this.providerFor(reseller.country));
  }

  /** The business owner's check. Returns the Didit page to send them to; an unfinished session is reused for a day. */
  async startResellerVerification(resellerId: string, userId: string, consent: boolean) {
    if (!consent) throw consentRequired();
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (reseller.verifiedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_verified', 'Your identity is already verified.');
    const latest = await this.prisma.identityVerification.findFirst({ where: { resellerId, subject: 'reseller', method: 'document' }, orderBy: { createdAt: 'desc' } });
    if (latest?.status === 'in_review') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_in_review', 'Your check is being reviewed. We will email you the outcome.');
    const provider = await this.providerFor(reseller.country);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (provider === 'bitocard') {
      // BitoCard Verify: the business's KYB (an unregistered business is the owner's own check). An open case continues.
      if (latest?.status === 'in_progress' && latest.provider === verifyProvider) return presentResellerVerification(await this.freshLink(latest), reseller, provider);
      const caseId = this.verify.newCaseId();
      const created = await this.prisma.identityVerification.create({
        data: {
          subject: 'reseller',
          resellerId,
          mode: 'live',
          method: 'document',
          provider: verifyProvider,
          providerReference: caseId,
          country: reseller.country ?? 'NG',
          consentAt: new Date(),
          expectedName: user.name,
          requestedById: userId,
        },
      });
      const url = await this.verify.open(created, { kind: 'kyb', returnUrl: `${this.config.DASHBOARD_URL}/verification` });
      return presentResellerVerification(await this.prisma.identityVerification.update({ where: { id: created.id }, data: { url } }), reseller, provider);
    }
    if (latest?.status === 'in_progress' && latest.url && latest.createdAt.getTime() > Date.now() - reuseSessionMs) return presentResellerVerification(latest, reseller, provider);
    if (!this.didit) throw unavailable('Identity verification');

    let session: { providerReference: string; url: string };
    try {
      session = await this.didit.createSession({ reference: `reseller:${resellerId}`, callbackUrl: `${this.config.DASHBOARD_URL}/verification`, email: user.email ?? undefined });
    } catch (error) {
      throw this.providerFailure(error, 'identity check');
    }
    const record = await this.prisma.identityVerification.create({
      data: {
        subject: 'reseller',
        resellerId,
        mode: 'live',
        method: 'document',
        provider: this.didit.name,
        providerReference: session.providerReference,
        url: session.url,
        country: reseller.country ?? 'NG',
        consentAt: new Date(),
        expectedName: user.name,
        requestedById: userId,
      },
    });
    return presentResellerVerification(record, reseller, provider);
  }

  // -- Reseller owner's BVN (reserved accounts in Nigeria) ---------------------------------------------------------

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(key);
  }

  private latestBvnCheck(resellerId: string) {
    return this.prisma.identityVerification.findFirst({ where: { resellerId, subject: 'reseller', method: 'bvn' }, orderBy: { createdAt: 'desc' } });
  }

  /** The owner's BVN check; an open one is re-read from Flutterwave first (they return from the consent page to SHQ). */
  async resellerBvnCheck(resellerId: string) {
    let record = await this.latestBvnCheck(resellerId);
    if (record && openStatuses.includes(record.status)) record = await this.refresh(record).catch(() => record!);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    return presentBvnCheck(record, reseller);
  }

  /**
   * Starts the owner's BVN check (Nigeria, live): Flutterwave's consent page, then the BVN record's name must match the
   * owner's verified name. The BVN is kept encrypted only until the reseller's reserved accounts are opened (the bank
   * needs it), then erased; it is erased at once if the check fails or expires.
   */
  async startResellerBvnCheck(resellerId: string, bvn: string, consent: boolean) {
    if (!consent) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'consent_required', 'The owner must agree to the BVN check first.', 'consent');
    }
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (reseller.country !== 'NG') throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'bvn_not_needed', 'Only Nigerian businesses need a BVN check.');
    if (!reseller.verifiedAt || !reseller.verifiedName) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', 'Pass the identity check first: the BVN must match the verified owner.');
    }
    if (reseller.bvnVerifiedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_verified', 'Your BVN is already verified.');
    const latest = await this.latestBvnCheck(resellerId);
    if (latest?.status === 'in_progress' && latest.url && latest.createdAt.getTime() > Date.now() - reuseSessionMs) return presentBvnCheck(latest, reseller);
    const flutterwave = this.providers.flutterwave;
    if (!flutterwave) throw unavailable('BVN verification');
    const [firstName, ...rest] = reseller.verifiedName.trim().split(/\s+/);
    let session: { providerReference: string; url: string };
    try {
      session = await flutterwave.startBvnConsent({ bvn, firstName, lastName: rest.join(' ') || firstName, redirectUrl: `${this.config.DASHBOARD_URL}/wallet/reserved-accounts` });
    } catch (error) {
      throw this.providerFailure(error, 'BVN check');
    }
    // A newer check replaces the older one: nothing from it is needed any more.
    await this.prisma.identityVerification.updateMany({ where: { resellerId, subject: 'reseller', method: 'bvn', secretEncrypted: { not: null } }, data: { secretEncrypted: null } });
    const record = await this.prisma.identityVerification.create({
      data: {
        subject: 'reseller',
        resellerId,
        mode: 'live',
        method: 'bvn',
        provider: flutterwave.name,
        providerReference: session.providerReference,
        url: session.url,
        country: 'NG',
        consentAt: new Date(),
        expectedName: reseller.verifiedName,
        secretEncrypted: this.encryption().encrypt(bvn),
      },
    });
    return presentBvnCheck(record, reseller);
  }

  // -- Customers -------------------------------------------------------------------------------------------------

  private latestCustomer(resellerId: string, mode: LedgerMode, reference: string) {
    return this.prisma.identityVerification.findFirst({ where: { resellerId, mode, subject: 'customer', customerReference: reference }, orderBy: { createdAt: 'desc' } });
  }

  async customerVerification(resellerId: string, mode: LedgerMode, reference: string) {
    const record = await this.latestCustomer(resellerId, mode, reference);
    if (!record) throw notFound();
    return presentCustomerVerification(this.withoutSpentLink(record));
  }

  /** True when BitoCard has verified this customer of the reseller (for hosted storefront gating). */
  async isCustomerVerified(resellerId: string, mode: LedgerMode, reference: string) {
    return (await this.latestCustomer(resellerId, mode, reference))?.status === 'approved';
  }

  /**
   * The country of the document an approved check verified (else the check's own country: a BVN is Nigerian), or
   * null without an approved check.
   */
  async customerDocumentCountry(resellerId: string, mode: LedgerMode, reference: string) {
    const record = await this.latestCustomer(resellerId, mode, reference);
    return record?.status === 'approved' ? (record.documentCountry ?? record.country) : null;
  }

  /** The name an approved check verified for the customer (to match their bank account), or null. */
  async customerVerifiedName(resellerId: string, mode: LedgerMode, reference: string) {
    const record = await this.latestCustomer(resellerId, mode, reference);
    return record?.status === 'approved' ? record.verifiedName : null;
  }

  /**
   * Starts a customer's check: BVN consent in Nigeria (the BVN is passed to the provider and never stored), Didit
   * elsewhere. An approved or unfinished check for the same customer is returned instead of starting another.
   * In test mode nothing is sent to providers; finish the check with the simulate endpoint.
   */
  async startCustomerVerification(
    resellerId: string,
    mode: LedgerMode,
    reference: string,
    input: { country: string; first_name: string; last_name: string; bvn?: string; redirect_url: string; consent: boolean },
    options: { storeId?: string | null } = {},
  ) {
    if (!input.consent) throw consentRequired();
    const country = input.country.toUpperCase();
    const viaVerify = (await this.providerFor(country)) === 'bitocard';
    // BitoCard Verify checks everyone in its countries with an ID document and liveness; the BVN is only for reserved accounts.
    const method = !viaVerify && country === 'NG' ? 'bvn' : 'document';
    if (method === 'bvn' && !/^\d{11}$/.test(input.bvn ?? '')) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Nigerian customers are checked with their 11-digit BVN.', 'bvn');
    }
    const latest = await this.latestCustomer(resellerId, mode, reference);
    if (latest?.status === 'approved' || latest?.status === 'in_review') return presentCustomerVerification(latest);
    if (latest?.status === 'in_progress' && latest.provider === verifyProvider) return presentCustomerVerification(await this.freshLink(latest));
    if (latest?.status === 'in_progress' && latest.createdAt.getTime() > Date.now() - reuseSessionMs) return presentCustomerVerification(latest);
    if (mode === 'live') {
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
      if (reseller.status !== 'active') throw resellerNotVerified();
    }
    if (mode === 'live' && viaVerify) {
      const caseId = this.verify.newCaseId();
      const created = await this.prisma.identityVerification.create({
        data: {
          subject: 'customer',
          resellerId,
          mode,
          customerReference: reference,
          method: 'document',
          provider: verifyProvider,
          providerReference: caseId,
          country,
          consentAt: new Date(),
          expectedName: `${input.first_name} ${input.last_name}`,
        },
      });
      const url = await this.verify.open(created, { kind: 'kyc', storeId: options.storeId ?? null, returnUrl: input.redirect_url });
      return presentCustomerVerification(await this.prisma.identityVerification.update({ where: { id: created.id }, data: { url } }));
    }

    const expectedName = `${input.first_name} ${input.last_name}`;
    let provider = 'sandbox';
    let session: { providerReference: string; url: string | null } = { providerReference: `sbx_${randomUUID()}`, url: null };
    if (mode === 'live') {
      try {
        if (method === 'bvn') {
          const bvn = this.providers.flutterwave;
          if (!bvn) throw unavailable('BVN verification');
          provider = bvn.name;
          session = await bvn.startBvnConsent({ bvn: input.bvn!, firstName: input.first_name, lastName: input.last_name, redirectUrl: input.redirect_url });
        } else {
          if (!this.didit) throw unavailable('Identity verification');
          provider = this.didit.name;
          session = await this.didit.createSession({ reference: `customer:${resellerId}`, callbackUrl: input.redirect_url, firstName: input.first_name, lastName: input.last_name, country });
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw this.providerFailure(error, method === 'bvn' ? 'BVN check' : 'identity check');
      }
    }
    const record = await this.prisma.identityVerification.create({
      data: {
        subject: 'customer',
        resellerId,
        mode,
        customerReference: reference,
        method,
        provider,
        providerReference: session.providerReference,
        url: session.url,
        country,
        consentAt: new Date(),
        expectedName,
      },
    });
    return presentCustomerVerification(record);
  }

  async simulateCustomer(resellerId: string, mode: LedgerMode, reference: string, outcome: 'approved' | 'declined') {
    if (mode !== 'test') throw testModeOnly();
    const record = await this.latestCustomer(resellerId, 'test', reference);
    if (!record) throw notFound();
    const [firstName, ...rest] = (record.expectedName ?? 'Test Customer').split(' ');
    await this.apply(record, outcome === 'approved' ? { status: 'approved', firstName, lastName: rest.join(' ') } : { status: 'declined', reason: 'Simulated decline' });
    return presentCustomerVerification(await this.prisma.identityVerification.findUniqueOrThrow({ where: { id: record.id } }));
  }

  // -- Results ---------------------------------------------------------------------------------------------------

  /** Re-reads a check from its provider and applies the outcome. */
  async refresh(record: IdentityVerification) {
    if (!openStatuses.includes(record.status) || record.provider === 'sandbox') return record;
    let result: CheckResult;
    if (record.provider === 'didit' && this.didit) result = await this.didit.result(record.providerReference);
    else if (record.provider === 'flutterwave' && this.providers.flutterwave) result = await this.providers.flutterwave.bvnResult(record.providerReference);
    else return record;
    await this.apply(record, result);
    return this.prisma.identityVerification.findUniqueOrThrow({ where: { id: record.id } });
  }

  /** A provider notification: find the check and re-read it (the notification body is never trusted). */
  async refreshByReference(provider: string, providerReference: string) {
    const record = await this.prisma.identityVerification.findUnique({ where: { provider_providerReference: { provider, providerReference } } });
    if (!record) {
      this.logger.warn({ provider, providerReference }, 'Notification for an unknown identity check');
      return { handled: false };
    }
    return { handled: true, status: (await this.refresh(record)).status };
  }

  /**
   * Applies an outcome once. BVN checks are approved only when the name on the BVN record matches the customer's
   * name. An approved reseller owner makes the reseller verified, and active unless manual approval is switched on.
   */
  async apply(record: IdentityVerification, result: CheckResult, actorId: string | null = null, options: { trusted?: boolean } = {}) {
    const now = new Date();
    if (result.status === 'in_progress' || (result.status === 'in_review' && record.status === 'in_review')) {
      await this.prisma.identityVerification.update({ where: { id: record.id }, data: { lastCheckedAt: now } });
      return;
    }
    let status = result.status;
    let reason = result.reason ?? null;
    const verifiedName = fullName(result);
    if (status === 'approved' && record.method === 'bvn' && !options.trusted && !(record.expectedName && verifiedName && namesMatch(record.expectedName, verifiedName))) {
      status = 'declined';
      reason = 'name_mismatch';
    }
    const ownerBvn = record.subject === 'reseller' && record.method === 'bvn';
    const ownerDocument = record.subject === 'reseller' && record.method === 'document';
    const autoApprove = ownerDocument && status === 'approved' && !(await this.settings.isOn('manual_reseller_approval', record.resellerId));
    const changed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.identityVerification.updateMany({
        where: { id: record.id, status: { in: openStatuses } },
        data: {
          status,
          reason,
          verifiedName: status === 'approved' ? verifiedName : null,
          documentCountry: result.documentCountry ?? null,
          decidedAt: status === 'in_review' ? null : now,
          decidedById: actorId,
          lastCheckedAt: now,
          // A BVN is kept only while it can still open reserved accounts.
          ...(status === 'approved' || status === 'in_review' ? {} : { secretEncrypted: null }),
        },
      });
      if (claimed.count === 0) return false;
      if (ownerBvn && status === 'approved') await tx.reseller.update({ where: { id: record.resellerId }, data: { bvnVerifiedAt: now } });
      if (ownerDocument && status === 'approved') {
        await tx.reseller.update({ where: { id: record.resellerId }, data: { verifiedAt: now, verifiedName } });
        if (autoApprove) await tx.reseller.updateMany({ where: { id: record.resellerId, status: 'pending' }, data: { status: 'active' } });
      }
      if (record.subject === 'customer' && (status === 'approved' || status === 'declined')) {
        const updated = await tx.identityVerification.findUniqueOrThrow({ where: { id: record.id } });
        await this.events.record(tx, {
          resellerId: record.resellerId,
          mode: record.mode,
          type: status === 'approved' ? 'customer_verification.approved' : 'customer_verification.declined',
          object: presentCustomerVerification(updated),
        });
      }
      return true;
    });
    if (!changed) return;
    this.events.committed();
    if (ownerDocument && status === 'approved') await this.allowance.grantIfEligible(record.resellerId).catch(error => this.logger.error({ err: error }, 'Could not grant the startup allowance'));
    if (actorId !== null || record.subject === 'reseller') {
      await this.audit.record({ actorId, action: `verification.${status}`, targetType: 'reseller', targetId: record.resellerId, before: { verification_id: record.id, status: record.status }, after: { status, reason } });
    }
    if (record.subject === 'reseller') {
      const what = ownerBvn ? 'BVN check' : 'identity check';
      const outcomes: Record<string, { title: string; body: string }> = {
        approved: { title: `Your ${what} was approved`, body: ownerBvn ? 'You can open your reserved bank accounts now.' : autoApprove ? 'Your account is live.' : 'BitoCard will activate your account shortly.' },
        declined: { title: `Your ${what} was declined`, body: reason === 'name_mismatch' ? 'The name on the record did not match your verified name.' : 'Start a new check from the verification page.' },
        in_review: { title: `Your ${what} is being reviewed`, body: 'BitoCard is reviewing it; we will tell you the outcome.' },
        expired: { title: `Your ${what} expired`, body: 'It was not finished in time. Start a new one when you are ready.' },
      };
      const outcome = outcomes[status];
      if (outcome) {
        await this.inbox.reseller(record.resellerId, 'verification.updated', {
          subject: `${record.id}:${status}`,
          ...outcome,
          link: ownerBvn ? '/wallet/reserved-accounts' : '/verification',
          mode: record.mode,
        });
      }
    }
    if (status === 'in_review' && record.mode === 'live') {
      await this.inbox.admins('admin.verification.review', {
        subject: record.id,
        title: `${record.subject === 'reseller' ? 'Reseller' : 'Customer'} identity check to review`,
        body: 'The provider could not decide this check on its own. Review it.',
        link: '/verifications',
      });
    }
    if (ownerDocument && (status === 'approved' || status === 'declined')) {
      const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId: record.resellerId, role: 'owner' }, include: { user: true } });
      if (owner?.user.email) {
        await this.email
          .send(resellerVerificationEmail(owner.user.email, status, autoApprove, `${this.config.DASHBOARD_URL}/verification`))
          .catch(error => this.logger.warn({ err: error }, 'Could not send the email'));
      }
    }
  }

  /** Re-reads unfinished live checks the providers have not told us about, and closes those nobody finished. Run on a schedule. */
  async checkOpen(now = new Date()) {
    const records = await this.prisma.identityVerification.findMany({
      where: {
        status: { in: openStatuses },
        provider: { not: 'sandbox' },
        createdAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }],
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    const outcome = { checked: 0, decided: 0, expired: 0 };
    for (const record of records) {
      try {
        const after = await this.refresh(record);
        outcome.checked += 1;
        if (!openStatuses.includes(after.status)) outcome.decided += 1;
        else if (after.status === 'in_progress' && record.createdAt.getTime() < now.getTime() - expireAfterMs) {
          await this.apply(after, { status: 'expired' });
          outcome.expired += 1;
        }
      } catch (error) {
        this.logger.warn({ err: error, verificationId: record.id }, 'Identity check refresh failed; will retry');
      }
    }
    // A verified BVN not used to open reserved accounts within the check's lifetime is erased.
    await this.prisma.identityVerification.updateMany({
      where: { secretEncrypted: { not: null }, createdAt: { lt: new Date(now.getTime() - expireAfterMs) } },
      data: { secretEncrypted: null },
    });
    const sandbox = await this.prisma.identityVerification.updateMany({
      where: { provider: 'sandbox', status: 'in_progress', createdAt: { lt: new Date(now.getTime() - expireAfterMs) } },
      data: { status: 'expired', decidedAt: now },
    });
    outcome.expired += sandbox.count;
    return outcome;
  }

  // -- Admin -----------------------------------------------------------------------------------------------------

  private presentAdmin(record: IdentityVerification & { reseller?: { name: string } }) {
    return {
      object: 'verification' as const,
      id: record.id,
      subject: record.subject,
      reseller_id: record.resellerId,
      reseller_name: record.reseller?.name ?? null,
      mode: record.mode,
      customer_reference: record.customerReference,
      method: record.method,
      provider: record.provider,
      provider_reference: record.providerReference,
      status: record.status,
      country: record.country,
      expected_name: record.expectedName,
      verified_name: record.verifiedName,
      document_country: record.documentCountry,
      reason: record.reason,
      consent_at: record.consentAt.toISOString(),
      decided_by_id: record.decidedById,
      decided_at: record.decidedAt?.toISOString() ?? null,
      created_at: record.createdAt.toISOString(),
    };
  }

  async adminList(filter: { status?: VerificationStatus; subject?: 'reseller' | 'customer'; reseller_id?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 50;
    const records = await this.prisma.identityVerification.findMany({
      where: { status: filter.status, subject: filter.subject, resellerId: filter.reseller_id },
      include: { reseller: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: records.slice(0, limit).map(record => this.presentAdmin(record)), has_more: records.length > limit };
  }

  async adminGet(id: string) {
    const record = await this.prisma.identityVerification.findUnique({ where: { id }, include: { reseller: { select: { name: true } } } });
    if (!record) throw notFound();
    return this.presentAdmin(record);
  }

  /** An admin's decision on a check the provider sent for review, after looking at it in the provider's console. */
  async decide(actorId: string | null, id: string, input: { decision: 'approved' | 'declined'; reason: string; verified_name?: string }) {
    const record = await this.prisma.identityVerification.findUnique({ where: { id } });
    if (!record) throw notFound();
    if (record.status !== 'in_review') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_not_in_review', 'Only checks waiting for review can be decided.');
    if (record.provider === verifyProvider) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'use_verify_review', 'Decide BitoCard Verify checks from their case, with its documents.');
    }
    const name = input.verified_name ?? record.expectedName ?? '';
    const [firstName, ...rest] = name.split(' ');
    await this.apply(
      record,
      input.decision === 'approved' ? { status: 'approved', firstName, lastName: rest.join(' ') } : { status: 'declined', reason: input.reason },
      actorId,
      // An admin's approval stands on its own; the BVN name rule applies only to provider results.
      { trusted: true },
    );
    await this.prisma.identityVerification.update({ where: { id }, data: { reason: input.reason } });
    return this.adminGet(id);
  }
}
