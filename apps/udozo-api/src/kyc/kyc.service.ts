import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type KycCase, type KycDocument, type Platform, Prisma } from '../generated/prisma/client.js';
import { afrippaOperatorId } from '../afrippa/ids.js';
import { IdentityService } from '../identity/identity.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { verifyOutcomeEmail } from '../notifications/templates.js';
import { EventsService } from '../webhooks/events.service.js';
import { presentCustomerVerification } from '../identity/identity.service.js';
import { businessDocuments, type DeclineReason, declineReasons, framesPerStep, idTypeFor, idTypesFor, type LivenessStep, livenessStepCount, livenessSteps } from './catalogue.js';
import { checkDocument } from './files.js';
import { kycPlatform, sessionIdleMs } from './links.js';
import { KycStorage } from './storage.js';

/** Documents of declined cases are deleted after this; approved cases keep theirs for record keeping (to confirm with lawyers). */
const declinedRetentionMs = 90 * 24 * 3600_000;
const approvedRetentionMs = 5 * 365 * 24 * 3600_000;
/** Drafts nobody touched for this long lose their uploads. */
const abandonedMs = 7 * 24 * 3600_000;

/** A reseller reviewer acts for one account; `*` (document links, which cannot name it) means the case's own, if the person belongs to it. */
export type Reviewer = { realm: 'admin'; userId: string | null; platform?: Platform } | { realm: 'reseller'; userId: string; resellerId: string };

/** Which product's cases a reviewer sees: BitoCard's admins and resellers BitoCard's, Afrippa's admins Afrippa's. */
const reviewerPlatform = (reviewer: Reviewer): Platform => (reviewer.realm === 'admin' ? (reviewer.platform ?? 'bitocard') : 'bitocard');
/** The cases of a product, by their account: Afrippa's are under its operator account. */
const platformWhere = (platform: Platform): Prisma.KycCaseWhereInput => (platform === 'afrippa' ? { resellerId: afrippaOperatorId } : { resellerId: { not: afrippaOperatorId } });
type CaseWithDocs = KycCase & { documents: KycDocument[] };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such identity check.');
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const locked = () => conflict('case_locked', 'This part of your check cannot be changed now.');

const businessKinds = Object.keys(businessDocuments) as Array<keyof typeof businessDocuments>;
const livenessKind = /^liveness_(\d)_(\d)$/;

const sha256Bytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The item a document kind belongs to (what a reviewer can ask to have sent again). */
const itemOf = (kind: string) => (livenessKind.test(kind) ? 'liveness' : kind);

/**
 * BitoCard Verify (verify.bitocard.com): own KYC and KYB with human review, for every African country.
 *
 * - **Applicants** reach their case through a single-use link (`VerifyLinks`) exchanged for a 2-hour app session, then
 *   consent, give their (business and) identity details, upload their ID, a selfie and liveness frames for two random
 *   steps, and submit. Files are checked from their bytes, stripped of metadata and stored encrypted (`KycStorage`).
 * - **Reviewers** decide by looking at the documents: BitoCard admins (admin app) for every case, and a registered,
 *   KYB-verified, active reseller for its own customers (`reviewer: reseller`, fixed at submission), whose decision is
 *   final. Unregistered resellers never see their customers' documents.
 * - **Decisions** are applied to the identity check behind the case (`IdentityService.apply`), so every gate (checkout,
 *   payouts, crypto, the reseller's status) reads the check as it always has. Approving a reseller's KYB also records
 *   its business type and, for a registered business, its registered details.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger('Verify');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KycStorage,
    private readonly identity: IdentityService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly email: EmailService,
    private readonly events: EventsService,
  ) {}

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(key);
  }

  /** A case's documents live in its product's own private bucket. */
  private storageFor(c: KycCase) {
    return this.storage.forPlatform(kycPlatform(c.resellerId));
  }

  /** The same ID on any case: an HMAC of the country, ID type and number (letters and digits only, upper case). */
  fingerprint(country: string, type: string, number: string) {
    const key = this.integrations.env.ENCRYPTION_KEY ?? '';
    return createHmac('sha256', Buffer.from(key, 'base64')).update(`${country}:${type}:${number.toUpperCase().replace(/[^A-Z0-9]/g, '')}`).digest('hex');
  }

  // -- Sessions --------------------------------------------------------------------------------------------------

  /** A link's token for an app session (once): the case it opens and a new session token for the app's cookie. */
  async exchange(token: string, platform: Platform = 'bitocard') {
    const now = new Date();
    const found = await this.prisma.kycSession.findUnique({ where: { tokenHash: sha256(token) }, include: { case: { select: { resellerId: true } } } });
    // A link opens only on its own product's Verify.
    const link = found && kycPlatform(found.case.resellerId) === platform ? found : null;
    const claimed = link?.kind === 'handoff' ? await this.prisma.kycSession.updateMany({ where: { id: link.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } }) : null;
    if (!link || !claimed?.count) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'kyc_link_invalid', 'This link has expired or was already used. Start your check again from where you came from.');
    const session = `bks_${randomToken(32)}`;
    const expiresAt = new Date(now.getTime() + sessionIdleMs);
    await this.prisma.kycSession.create({ data: { caseId: link.caseId, kind: 'session', tokenHash: sha256(session), expiresAt } });
    return { object: 'kyc_session' as const, session: { token: session, expires_at: expiresAt.toISOString() }, case: await this.applicantCase(link.caseId) };
  }

  /** The case and session behind an app session token, its idle time renewed; null when unknown or expired. */
  async resolve(token: string, platform: Platform = 'bitocard') {
    const now = new Date();
    const session = await this.prisma.kycSession.findUnique({ where: { tokenHash: sha256(token) }, include: { case: { select: { resellerId: true } } } });
    if (!session || session.kind !== 'session' || session.expiresAt <= now || kycPlatform(session.case.resellerId) !== platform) return null;
    // Renewed at most once a minute, not on every request.
    if (session.expiresAt.getTime() - now.getTime() < sessionIdleMs - 60_000) {
      await this.prisma.kycSession.update({ where: { id: session.id }, data: { expiresAt: new Date(now.getTime() + sessionIdleMs) } });
    }
    return { sessionId: session.id, caseId: session.caseId };
  }

  // -- Applicants ------------------------------------------------------------------------------------------------

  private async load(caseId: string) {
    const found = await this.prisma.kycCase.findUnique({ where: { id: caseId }, include: { documents: true } });
    if (!found) throw notFound();
    return found;
  }

  /** Everything the case needs before it can be submitted. */
  required(c: KycCase) {
    const items: string[] = ['consent'];
    if (c.kind === 'kyb') items.push('business');
    if (c.kind === 'kyb' && c.businessType === 'registered') items.push(...businessKinds);
    items.push('identity', 'id_front');
    if (c.idType && idTypeFor(c.country, c.idType)?.back) items.push('id_back');
    items.push('selfie', 'liveness');
    return items;
  }

  missing(c: CaseWithDocs) {
    const has = new Set(c.documents.map(document => document.kind));
    const livenessDone = c.livenessSteps.length > 0 && c.livenessSteps.every((_step, index) => Array.from({ length: framesPerStep }, (_x, frame) => has.has(`liveness_${index}_${frame}`)).every(Boolean));
    return this.required(c).filter(item => {
      if (item === 'consent') return !c.consentAt;
      if (item === 'business') return !c.businessType || (c.businessType === 'registered' && !(c.registeredName && c.registrationNumber && c.businessAddress));
      if (item === 'identity') return !(c.idType && c.idNumberEncrypted && c.fullName && c.dateOfBirth);
      if (item === 'liveness') return !livenessDone;
      return !has.has(item);
    });
  }

  /** Who the applicant is checking for: the store (its customers), else the reseller (API customers), else BitoCard. */
  private async brand(c: KycCase) {
    if (kycPlatform(c.resellerId) === 'afrippa') return { name: 'Afrippa', logo_url: null };
    if (c.subject === 'customer' && c.storeId) {
      const store = await this.prisma.store.findUnique({ where: { id: c.storeId }, select: { name: true, logoUrl: true, reseller: { select: { house: true } } } });
      if (store && !store.reseller.house) return { name: store.name, logo_url: store.logoUrl };
    }
    if (c.subject === 'customer') {
      const reseller = await this.prisma.reseller.findUnique({ where: { id: c.resellerId }, select: { name: true, house: true } });
      if (reseller && !reseller.house) return { name: reseller.name, logo_url: null };
    }
    return { name: 'BitoCard', logo_url: null };
  }

  private countryName(code: string) {
    try {
      return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  private idNumber(c: KycCase) {
    return c.idNumberEncrypted ? this.encryption().decrypt(c.idNumberEncrypted) : null;
  }

  private async presentApplicant(c: CaseWithDocs) {
    const number = this.idNumber(c);
    return {
      object: 'kyc_case' as const,
      id: c.id,
      kind: c.kind as 'kyc' | 'kyb',
      subject: c.subject,
      mode: c.mode,
      country: c.country,
      country_name: this.countryName(c.country),
      brand: await this.brand(c),
      status: c.status,
      consented: Boolean(c.consentAt),
      business_type: c.businessType,
      business: c.kind === 'kyb' && c.businessType === 'registered' ? { registered_name: c.registeredName, registration_number: c.registrationNumber, business_address: c.businessAddress } : null,
      identity: c.idType ? { id_type: c.idType, id_number_hint: number ? `••••${number.slice(-4)}` : null, full_name: c.fullName, date_of_birth: c.dateOfBirth } : null,
      id_types: idTypesFor(c.country),
      documents: c.documents.map(document => ({ kind: document.kind, content_type: document.contentType, size: document.size, uploaded_at: document.createdAt.toISOString() })),
      liveness: c.livenessSteps.length ? { steps: c.livenessSteps.map(code => ({ code, label: livenessSteps[code as LivenessStep] ?? code })), frames_per_step: framesPerStep } : null,
      required: this.required(c),
      missing: this.missing(c),
      resubmit_items: c.status === 'resubmit' ? c.resubmitItems : [],
      reason: c.status === 'declined' ? c.reason : null,
      reason_text: c.status === 'declined' && c.reason ? (declineReasons[c.reason as DeclineReason] ?? null) : null,
      note: c.status === 'declined' || c.status === 'resubmit' ? c.note : null,
      return_url: c.returnUrl,
      submitted_at: c.submittedAt?.toISOString() ?? null,
      decided_at: c.decidedAt?.toISOString() ?? null,
    };
  }

  async applicantCase(caseId: string) {
    return this.presentApplicant(await this.load(caseId));
  }

  /** The case if the applicant may change `item` now: anything while a draft, only what was asked for when resubmitting. */
  private async editable(caseId: string, item: string) {
    const c = await this.load(caseId);
    if (c.status === 'draft') return c;
    if (c.status === 'resubmit' && c.resubmitItems.includes(item)) return c;
    throw locked();
  }

  async consent(caseId: string, consent: boolean) {
    if (!consent) throw invalid('consent_required', 'Agree to the identity check, including the face check, to continue.', 'consent');
    const c = await this.load(caseId);
    if (c.status !== 'draft' && c.status !== 'resubmit') throw locked();
    if (!c.consentAt) await this.prisma.kycCase.update({ where: { id: c.id }, data: { consentAt: new Date() } });
    return this.applicantCase(caseId);
  }

  async business(caseId: string, input: { business_type: 'unregistered' | 'registered'; registered_name?: string; registration_number?: string; business_address?: string }) {
    const c = await this.editable(caseId, 'business');
    if (c.kind !== 'kyb') throw invalid('parameter_invalid', 'Only a business check has business details.', 'business_type');
    const registered = input.business_type === 'registered';
    if (registered) {
      for (const [field, value] of [['registered_name', input.registered_name], ['registration_number', input.registration_number], ['business_address', input.business_address]] as const) {
        if (!value?.trim()) throw invalid('parameter_missing', 'A registered business gives its registered name, registration number and address.', field);
      }
    }
    await this.prisma.kycCase.update({
      where: { id: c.id },
      data: {
        businessType: input.business_type,
        registeredName: registered ? input.registered_name!.trim() : null,
        registrationNumber: registered ? input.registration_number!.trim().toUpperCase() : null,
        businessAddress: registered ? input.business_address!.trim() : null,
      },
    });
    // An unregistered business needs no business documents: any uploaded are removed.
    if (!registered) await this.removeDocuments(c, c.documents.filter(document => (businessKinds as string[]).includes(document.kind)));
    return this.applicantCase(caseId);
  }

  async identityDetails(caseId: string, input: { id_type: string; id_number: string; full_name: string; date_of_birth: string }) {
    const c = await this.editable(caseId, 'identity');
    const type = idTypeFor(c.country, input.id_type);
    if (!type) throw invalid('parameter_invalid', 'Choose one of the ID documents listed.', 'id_type');
    const number = input.id_number.trim();
    if (!/^[A-Za-z0-9 /-]{4,30}$/.test(number)) throw invalid('parameter_invalid', 'Enter the number on your document as shown.', 'id_number');
    const born = new Date(`${input.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(born.getTime()) || born.toISOString().slice(0, 10) !== input.date_of_birth) throw invalid('parameter_invalid', 'Enter your date of birth.', 'date_of_birth');
    const adult = new Date(born);
    adult.setUTCFullYear(adult.getUTCFullYear() + 18);
    if (adult > new Date()) throw invalid('underage', 'You must be at least 18 to be verified.', 'date_of_birth');
    await this.prisma.kycCase.update({
      where: { id: c.id },
      data: { idType: type.code, idNumberEncrypted: this.encryption().encrypt(number), idFingerprint: this.fingerprint(c.country, type.code, number), fullName: input.full_name.trim(), dateOfBirth: input.date_of_birth },
    });
    // A type without a back side no longer needs the one uploaded for another type.
    if (!type.back) await this.removeDocuments(c, c.documents.filter(document => document.kind === 'id_back'));
    return this.applicantCase(caseId);
  }

  /** Two random liveness steps, issued once (again only when a reviewer asks for liveness to be redone). */
  async liveness(caseId: string) {
    const c = await this.editable(caseId, 'liveness');
    if (c.livenessSteps.length === 0) {
      const pool = Object.keys(livenessSteps);
      const steps: string[] = [];
      while (steps.length < livenessStepCount) {
        const pick = pool[randomInt(pool.length)];
        if (!steps.includes(pick)) steps.push(pick);
      }
      await this.prisma.kycCase.update({ where: { id: c.id }, data: { livenessSteps: steps } });
    }
    return this.applicantCase(caseId);
  }

  async upload(caseId: string, kind: string, file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file) throw invalid('parameter_missing', 'Attach the file.', 'file');
    const c = await this.editable(caseId, itemOf(kind));
    const frame = livenessKind.exec(kind);
    const business = (businessKinds as string[]).includes(kind);
    const allowed =
      kind === 'id_front' ||
      kind === 'selfie' ||
      (kind === 'id_back' && Boolean(c.idType && idTypeFor(c.country, c.idType)?.back)) ||
      (business && c.kind === 'kyb' && c.businessType === 'registered') ||
      (frame !== null && Number(frame[1]) < c.livenessSteps.length && Number(frame[2]) < framesPerStep);
    if (!allowed) throw invalid('document_kind_invalid', 'This document is not part of your check.', 'kind');
    const checked = checkDocument(file.buffer, file.mimetype, business);
    if ('problem' in checked) throw invalid(checked.problem.includes('4 MB') ? 'file_too_large' : 'file_type_invalid', checked.problem, 'file');
    // Liveness frames and the selfie come from the camera as JPEG; a PNG there is a file someone picked.
    if ((frame || kind === 'selfie') && checked.contentType !== 'image/jpeg') throw invalid('file_type_invalid', 'Take this photo with your camera.', 'file');
    const storage = this.storageFor(c);
    const key = storage.key(c.id, randomUUID());
    await storage.put(key, checked.bytes);
    const previous = c.documents.find(document => document.kind === kind);
    await this.prisma.kycDocument.upsert({
      where: { caseId_kind: { caseId: c.id, kind } },
      create: { caseId: c.id, kind, objectKey: key, contentType: checked.contentType, size: checked.bytes.length, sha256: sha256Bytes(checked.bytes) },
      update: { objectKey: key, contentType: checked.contentType, size: checked.bytes.length, sha256: sha256Bytes(checked.bytes), createdAt: new Date() },
    });
    if (previous) await storage.remove(previous.objectKey).catch(error => this.logger.warn({ err: error, caseId: c.id }, 'Could not delete a replaced document'));
    await this.prisma.kycCase.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    return this.applicantCase(caseId);
  }

  private async removeDocuments(c: KycCase, documents: KycDocument[]) {
    if (!documents.length) return;
    await this.prisma.kycDocument.deleteMany({ where: { id: { in: documents.map(document => document.id) } } });
    const storage = this.storageFor(c);
    for (const document of documents) await storage.remove(document.objectKey).catch(error => this.logger.warn({ err: error, caseId: c.id }, 'Could not delete a document'));
  }

  /** Who reviews a case: a registered, KYB-verified, active reseller for its own customers; BitoCard otherwise. */
  private async reviewerFor(c: KycCase): Promise<'admin' | 'reseller'> {
    if (c.subject !== 'customer' || kycPlatform(c.resellerId) === 'afrippa') return 'admin';
    const seller = await this.prisma.reseller.findUnique({ where: { id: c.resellerId }, select: { businessType: true, kybVerifiedAt: true, status: true, house: true } });
    return seller && !seller.house && seller.businessType === 'registered' && seller.kybVerifiedAt && seller.status === 'active' ? 'reseller' : 'admin';
  }

  async submit(caseId: string) {
    const c = await this.load(caseId);
    if (c.status !== 'draft' && c.status !== 'resubmit') throw conflict('case_locked', 'This check was already submitted.');
    const missing = this.missing(c);
    if (missing.length) throw invalid('case_incomplete', `Some parts of your check are missing: ${missing.join(', ')}.`);
    const reviewer = await this.reviewerFor(c);
    const claimed = await this.prisma.kycCase.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'submitted', reviewer, submittedAt: new Date(), resubmitItems: [] } });
    if (!claimed.count) throw conflict('case_locked', 'This check was already submitted.');
    await this.prisma.identityVerification.updateMany({ where: { id: c.verificationId, status: 'in_progress' }, data: { status: 'in_review', lastCheckedAt: new Date() } });
    const who = c.subject === 'reseller' ? 'reseller business' : 'customer';
    if (reviewer === 'reseller') {
      await this.inbox.reseller(c.resellerId, 'kyc.customer_submitted', {
        subject: `${c.id}:${c.submittedAt?.getTime() ?? 0}`,
        title: 'A customer’s identity check to review',
        body: 'Review their documents on BitoCard Verify.',
        link: '/store/customers',
        mode: c.mode,
      });
    } else if (kycPlatform(c.resellerId) === 'afrippa') {
      await this.inbox.afrippaAdmins('admin.afrippa.kyc_submitted', {
        subject: `${c.id}:${Date.now()}`,
        title: 'A trader’s identity check to review',
        body: `${this.countryName(c.country)}. Review the documents and decide.`,
        link: `/verifications/${c.id}`,
        mode: c.mode,
      });
    } else {
      await this.inbox.admins('admin.kyc.submitted', {
        subject: `${c.id}:${Date.now()}`,
        title: `BitoCard Verify: a ${who}'s ${c.kind.toUpperCase()} to review`,
        body: `${this.countryName(c.country)}. Review the documents and decide.`,
        link: `/verifications/verify/${c.id}`,
        mode: c.mode,
      });
    }
    return this.applicantCase(caseId);
  }

  // -- Reviewers -------------------------------------------------------------------------------------------------

  /** Whether a reseller (and this member's role) may review its customers' checks, and why not. */
  async eligibility(resellerId: string, role: string | null) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const reason = reseller.house
      ? 'not_registered'
      : reseller.businessType !== 'registered'
        ? 'not_registered'
        : !reseller.kybVerifiedAt
          ? 'kyb_not_verified'
          : reseller.status !== 'active'
            ? 'not_active'
            : role !== 'owner' && role !== 'admin'
              ? 'role'
              : null;
    return { object: 'kyc_review_eligibility' as const, eligible: reason === null, reason, reseller: { id: reseller.id, name: reseller.name } };
  }

  private async requireEligible(resellerId: string, role: string | null) {
    const result = await this.eligibility(resellerId, role);
    if (!result.eligible) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'permission_error',
        'kyb_reviewer_required',
        'Only a registered business whose KYB is verified can review its customers’ identity checks; BitoCard reviews them otherwise.',
      );
    }
  }

  /** The case if this reviewer may see it: admins any; an eligible reseller only its own customers' cases routed to it. */
  private async reviewable(id: string, reviewer: Reviewer) {
    const c = await this.prisma.kycCase.findUnique({ where: { id }, include: { documents: { orderBy: { kind: 'asc' } } } });
    if (!c) throw notFound();
    // Each product's reviewers see only its own cases.
    if (kycPlatform(c.resellerId) !== reviewerPlatform(reviewer)) throw notFound();
    if (reviewer.realm === 'reseller') {
      const member = await this.prisma.resellerMember.findFirst({ where: { resellerId: c.resellerId, userId: reviewer.userId } });
      if (!member || c.subject !== 'customer' || c.reviewer !== 'reseller' || (reviewer.resellerId !== '*' && c.resellerId !== reviewer.resellerId)) throw notFound();
      await this.requireEligible(c.resellerId, member.role);
    }
    return c;
  }

  private async presentReview(c: CaseWithDocs, reviewer: Reviewer) {
    const platform = kycPlatform(c.resellerId);
    const base = reviewer.realm === 'reseller' ? `/v1/kyc/reviews/${c.id}` : platform === 'afrippa' ? `/v1/afrippa/admin/kyc/cases/${c.id}` : `/v1/admin/kyc/cases/${c.id}`;
    const [reseller, store, customer, duplicates, decider] = await Promise.all([
      this.prisma.reseller.findUniqueOrThrow({ where: { id: c.resellerId }, select: { id: true, name: true, house: true } }),
      c.storeId ? this.prisma.store.findUnique({ where: { id: c.storeId }, select: { id: true, name: true, subdomain: true } }) : null,
      c.subject === 'customer' && c.storeId && c.customerReference ? this.prisma.customer.findUnique({ where: { id: c.customerReference }, select: { id: true, name: true, email: true } }).catch(() => null) : null,
      c.idFingerprint ? this.prisma.kycCase.findMany({ where: { idFingerprint: c.idFingerprint, id: { not: c.id }, ...platformWhere(platform) }, select: { id: true, status: true, createdAt: true, resellerId: true }, take: 10 }) : [],
      c.decidedById ? this.prisma.user.findUnique({ where: { id: c.decidedById }, select: { name: true } }) : null,
    ]);
    const owner = c.subject === 'reseller' ? await this.prisma.resellerMember.findFirst({ where: { resellerId: c.resellerId, role: 'owner' }, include: { user: { select: { name: true, email: true } } } }) : null;
    const verification = await this.prisma.identityVerification.findUnique({ where: { id: c.verificationId }, select: { expectedName: true } });
    const type = c.idType ? idTypeFor(c.country, c.idType) : null;
    return {
      object: 'kyc_review' as const,
      id: c.id,
      kind: c.kind,
      subject: c.subject,
      mode: c.mode,
      country: c.country,
      country_name: this.countryName(c.country),
      status: c.status,
      reviewer: c.reviewer,
      applicant:
        c.subject === 'reseller'
          ? { type: 'reseller' as const, id: reseller.id, name: owner?.user.name ?? reseller.name, email: owner?.user.email ?? null, business_name: reseller.name }
          : { type: 'customer' as const, id: customer?.id ?? c.customerReference, name: customer?.name ?? verification?.expectedName ?? null, email: customer?.email ?? null, business_name: null },
      store: platform === 'afrippa' ? null : store && !reseller.house ? store : store ? { ...store, name: 'bitocard.com' } : null,
      reseller: { id: reseller.id, name: platform === 'afrippa' ? 'Afrippa' : reseller.house ? 'BitoCard' : reseller.name },
      business_type: c.businessType,
      business: c.businessType === 'registered' ? { registered_name: c.registeredName, registration_number: c.registrationNumber, business_address: c.businessAddress } : null,
      identity: c.idType ? { id_type: c.idType, id_type_label: type?.label ?? c.idType, id_number: this.idNumber(c), full_name: c.fullName, date_of_birth: c.dateOfBirth } : null,
      documents: c.documents.map(document => ({ id: document.id, kind: document.kind, content_type: document.contentType, size: document.size, uploaded_at: document.createdAt.toISOString(), url: `${base}/documents/${document.id}` })),
      liveness: c.livenessSteps.length ? { steps: c.livenessSteps.map(code => ({ code, label: livenessSteps[code as LivenessStep] ?? code })) } : null,
      // Another reseller's cases are only counted for a reseller reviewer, never shown.
      duplicates: duplicates
        .filter(item => reviewer.realm === 'admin' || item.resellerId === c.resellerId)
        .map(item => ({ case_id: item.id, status: item.status, created_at: item.createdAt.toISOString(), same: 'id_number' as const })),
      duplicates_elsewhere: reviewer.realm === 'reseller' ? duplicates.filter(item => item.resellerId !== c.resellerId).length : null,
      required: this.required(c),
      resubmit_items: c.resubmitItems,
      reason: c.reason,
      note: c.note,
      verified_name: c.verifiedName,
      submitted_at: c.submittedAt?.toISOString() ?? null,
      decided_at: c.decidedAt?.toISOString() ?? null,
      decided_by: c.decidedRealm ? { realm: c.decidedRealm, name: c.decidedRealm === 'admin' ? (platform === 'afrippa' ? 'Afrippa' : 'BitoCard') : (decider?.name ?? null) } : null,
      purged: c.purgedAt !== null,
    };
  }

  async list(reviewer: Reviewer, filter: { status?: string; subject?: string; kind?: string; reviewer?: string; country?: string; reseller_id?: string; customer_id?: string; limit?: number; starting_after?: string }) {
    if (reviewer.realm === 'reseller') {
      const member = await this.prisma.resellerMember.findFirst({ where: { resellerId: reviewer.resellerId, userId: reviewer.userId } });
      await this.requireEligible(reviewer.resellerId, member?.role ?? null);
    }
    const limit = filter.limit ?? 50;
    const where: Prisma.KycCaseWhereInput =
      reviewer.realm === 'reseller'
        ? { resellerId: reviewer.resellerId, subject: 'customer', reviewer: 'reseller', ...(filter.customer_id ? { customerReference: filter.customer_id } : {}) }
        : {
            ...(filter.subject ? { subject: filter.subject as 'reseller' | 'customer' } : {}),
            ...(filter.kind ? { kind: filter.kind } : {}),
            ...(filter.reviewer ? { reviewer: filter.reviewer } : {}),
            ...(filter.country ? { country: filter.country.toUpperCase() } : {}),
            ...(filter.reseller_id ? { resellerId: filter.reseller_id } : {}),
            ...(filter.customer_id ? { customerReference: filter.customer_id } : {}),
          };
    const status = filter.status ?? 'submitted';
    const rows = await this.prisma.kycCase.findMany({
      // Each product's admins list only its own cases (a reseller's filter cannot reach the other's).
      where: { AND: [where, platformWhere(reviewerPlatform(reviewer))], ...(status === 'all' ? { status: { not: 'draft' } } : { status: status as KycCase['status'] }) },
      include: { documents: { orderBy: { kind: 'asc' } } },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: await Promise.all(rows.slice(0, limit).map(row => this.presentReview(row, reviewer))), has_more: rows.length > limit };
  }

  async detail(id: string, reviewer: Reviewer) {
    return this.presentReview(await this.reviewable(id, reviewer), reviewer);
  }

  /** One document, opened, for a reviewer: every view is audited. */
  async document(id: string, documentId: string, reviewer: Reviewer) {
    const c = await this.reviewable(id, reviewer);
    const document = c.documents.find(item => item.id === documentId);
    if (!document) throw notFound();
    const bytes = await this.storageFor(c).get(document.objectKey);
    if (!bytes) throw new ApiError(HttpStatus.GONE, 'not_found_error', 'document_deleted', 'This document was deleted under the retention rules.');
    await this.audit.record({
      actorId: reviewer.userId,
      action: 'kyc.document_viewed',
      targetType: 'kyc_case',
      targetId: c.id,
      before: null,
      after: { document: document.kind, realm: reviewer.realm },
      platform: kycPlatform(c.resellerId),
    });
    return { contentType: document.contentType, bytes, name: `${document.kind}.${document.contentType === 'application/pdf' ? 'pdf' : document.contentType === 'image/png' ? 'png' : 'jpg'}` };
  }

  /** Where the applicant continues: the store's verification page, SHQ, or (resellers' own systems) nowhere we know. */
  private continueUrl(c: KycCase) {
    if (c.subject === 'reseller') return `${this.integrations.config.DASHBOARD_URL}/verification`;
    return c.storeId ? c.returnUrl : null;
  }

  private async applicantEmail(c: KycCase) {
    if (c.subject === 'reseller') {
      const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId: c.resellerId, role: 'owner' }, include: { user: { select: { email: true } } } });
      return owner?.user.email ?? null;
    }
    if (!c.storeId || !c.customerReference) return null;
    return (await this.prisma.customer.findUnique({ where: { id: c.customerReference }, select: { email: true } }).catch(() => null))?.email ?? null;
  }

  private async tell(c: KycCase, outcome: 'approved' | 'declined' | 'resubmit', reason: string | null, note: string | null) {
    const to = await this.applicantEmail(c);
    if (!to) return;
    const brand = (await this.brand(c)).name;
    if (kycPlatform(c.resellerId) === 'afrippa') {
      // From Afrippa's own email account, never BitoCard's.
      const message = verifyOutcomeEmail(to, { brand, outcome, reason: reason ? (declineReasons[reason as DeclineReason] ?? null) : null, note, link: this.continueUrl(c) });
      await this.email.sendFor('afrippa', message).catch(error => this.logger.warn({ err: error, caseId: c.id }, 'Could not email the outcome'));
      return;
    }
    await this.email
      .send(verifyOutcomeEmail(to, { brand, outcome, reason: reason ? (declineReasons[reason as DeclineReason] ?? null) : null, note, link: this.continueUrl(c) }), c.storeId ? { resellerId: c.resellerId, name: brand } : undefined)
      .catch(error => this.logger.warn({ err: error, caseId: c.id }, 'Could not email the outcome'));
  }

  private async claim(c: KycCase, from: KycCase['status'][], data: Prisma.KycCaseUpdateManyMutationInput) {
    const claimed = await this.prisma.kycCase.updateMany({ where: { id: c.id, status: { in: from } }, data });
    if (!claimed.count) throw conflict('case_not_reviewable', 'This check is not waiting for a decision.');
  }

  async approve(id: string, reviewer: Reviewer, input: { verified_name: string; note?: string }) {
    const c = await this.reviewable(id, reviewer);
    const now = new Date();
    const name = input.verified_name.trim();
    await this.claim(c, ['submitted'], { status: 'approved', verifiedName: name, note: input.note ?? null, reason: null, decidedById: reviewer.userId, decidedRealm: reviewer.realm, decidedAt: now, purgeAfter: new Date(now.getTime() + approvedRetentionMs) });
    if (c.subject === 'reseller') {
      // The business's KYB: its type, and a registered business's details as checked.
      await this.prisma.reseller.update({
        where: { id: c.resellerId },
        data:
          c.businessType === 'registered'
            ? { businessType: 'registered', registeredName: c.registeredName, registrationNumber: c.registrationNumber, businessAddress: c.businessAddress, kybVerifiedAt: now }
            : { businessType: 'unregistered', registeredName: null, registrationNumber: null, businessAddress: null, kybVerifiedAt: null },
      });
    }
    const [firstName, ...rest] = name.split(/\s+/);
    const verification = await this.prisma.identityVerification.findUniqueOrThrow({ where: { id: c.verificationId } });
    await this.identity.apply(verification, { status: 'approved', firstName, lastName: rest.join(' '), documentCountry: c.country }, reviewer.userId, { trusted: true });
    await this.audit.record({ actorId: reviewer.userId, action: 'kyc.approved', targetType: 'kyc_case', targetId: c.id, before: { status: c.status }, after: { status: 'approved', realm: reviewer.realm }, platform: kycPlatform(c.resellerId) });
    await this.tell(c, 'approved', null, null);
    return this.detail(id, reviewer);
  }

  async decline(id: string, reviewer: Reviewer, input: { reason: string; note?: string }) {
    if (!(input.reason in declineReasons)) throw invalid('parameter_invalid', 'Choose a reason from the list.', 'reason');
    const c = await this.reviewable(id, reviewer);
    const now = new Date();
    // An admin may also overturn a customer check that was approved (by a reseller or an admin).
    const revoking = reviewer.realm === 'admin' && c.status === 'approved' && c.subject === 'customer';
    await this.claim(c, revoking ? ['approved'] : ['submitted'], { status: 'declined', reason: input.reason, note: input.note ?? null, decidedById: reviewer.userId, decidedRealm: reviewer.realm, decidedAt: now, purgeAfter: new Date(now.getTime() + declinedRetentionMs) });
    const verification = await this.prisma.identityVerification.findUniqueOrThrow({ where: { id: c.verificationId } });
    if (revoking) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.identityVerification.updateMany({ where: { id: verification.id, status: 'approved' }, data: { status: 'declined', reason: input.reason, decidedAt: now, decidedById: reviewer.userId } });
        if (!changed.count) return;
        const updated = await tx.identityVerification.findUniqueOrThrow({ where: { id: verification.id } });
        await this.events.record(tx, { resellerId: verification.resellerId, mode: verification.mode, type: 'customer_verification.declined', object: presentCustomerVerification(updated) });
      });
      this.events.committed();
    } else {
      await this.identity.apply(verification, { status: 'declined', reason: input.reason }, reviewer.userId, { trusted: true });
    }
    await this.audit.record({ actorId: reviewer.userId, action: revoking ? 'kyc.revoked' : 'kyc.declined', targetType: 'kyc_case', targetId: c.id, before: { status: c.status }, after: { status: 'declined', reason: input.reason, realm: reviewer.realm }, platform: kycPlatform(c.resellerId) });
    await this.tell(c, 'declined', input.reason, input.note ?? null);
    return this.detail(id, reviewer);
  }

  /** Asks the applicant to send some items again: those are cleared, everything else is kept. */
  async resubmit(id: string, reviewer: Reviewer, input: { items: string[]; note: string }) {
    const c = await this.reviewable(id, reviewer);
    const required = this.required(c);
    const items = [...new Set(input.items)];
    if (!items.length || items.some(item => !required.includes(item) || item === 'consent')) throw invalid('parameter_invalid', `Choose what to send again from: ${required.filter(item => item !== 'consent').join(', ')}.`, 'items');
    await this.claim(c, ['submitted'], { status: 'resubmit', resubmitItems: items, note: input.note, decidedById: reviewer.userId, decidedRealm: reviewer.realm, decidedAt: new Date() });
    await this.removeDocuments(c, c.documents.filter(document => items.includes(itemOf(document.kind))));
    await this.prisma.kycCase.update({
      where: { id: c.id },
      data: {
        ...(items.includes('identity') ? { idType: null, idNumberEncrypted: null, idFingerprint: null, fullName: null, dateOfBirth: null } : {}),
        ...(items.includes('business') ? { businessType: null, registeredName: null, registrationNumber: null, businessAddress: null } : {}),
        ...(items.includes('liveness') ? { livenessSteps: [] } : {}),
      },
    });
    // The check is open again for the applicant.
    await this.prisma.identityVerification.updateMany({ where: { id: c.verificationId, status: 'in_review' }, data: { status: 'in_progress', createdAt: new Date() } });
    await this.audit.record({ actorId: reviewer.userId, action: 'kyc.resubmit_requested', targetType: 'kyc_case', targetId: c.id, before: { status: c.status }, after: { status: 'resubmit', items, realm: reviewer.realm }, platform: kycPlatform(c.resellerId) });
    await this.tell(c, 'resubmit', null, input.note);
    return this.detail(id, reviewer);
  }

  // -- Retention -------------------------------------------------------------------------------------------------

  /** Deletes the documents of cases past their retention, and of drafts left for a week; old links and sessions go. */
  async job(now = new Date()) {
    const abandoned = await this.prisma.kycCase.updateMany({
      where: { status: { in: ['draft', 'resubmit'] }, purgeAfter: null, updatedAt: { lt: new Date(now.getTime() - abandonedMs) } },
      data: { purgeAfter: now },
    });
    const due = await this.prisma.kycCase.findMany({ where: { purgeAfter: { lte: now }, purgedAt: null }, include: { documents: true }, take: 50 });
    let deleted = 0;
    for (const c of due) {
      try {
        await this.removeDocuments(c, c.documents);
        deleted += c.documents.length;
        await this.prisma.kycCase.update({ where: { id: c.id }, data: { purgedAt: now } });
      } catch (error) {
        this.logger.warn({ err: error, caseId: c.id }, 'Could not delete a case’s documents; will retry');
      }
    }
    const sessions = await this.prisma.kycSession.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
    return { abandoned: abandoned.count, purged: due.length, documents: deleted, sessions: sessions.count };
  }
}

