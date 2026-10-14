import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto.js';
import { PrismaService } from '../database/prisma.service.js';
import type { IdentityVerification } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';

/** A link into BitoCard Verify works once, for this long. */
export const handoffMs = 30 * 60_000;
/** The app session it becomes lasts this long without use. */
export const sessionIdleMs = 2 * 3600_000;
export const providerName = 'bitocard';

/**
 * Opening BitoCard Verify cases and the links into them, for the identity checks (`IdentityService`) of Verify
 * countries. A link is `<VERIFY_URL>/s#t=<token>`: the token sits in the fragment, so it never reaches a server log or
 * a Referer, works once and expires in 30 minutes. Asking again (the person returns to finish) mints a new one; the
 * case keeps everything already done.
 */
@Injectable()
export class VerifyLinks {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** The case id to use as the identity check's provider reference, before either exists. */
  newCaseId() {
    return randomUUID();
  }

  /** Opens the case behind a new identity check (its id is the check's provider reference) and returns its link. */
  async open(verification: IdentityVerification, input: { kind: 'kyc' | 'kyb'; storeId?: string | null; returnUrl?: string | null }) {
    await this.prisma.kycCase.create({
      data: {
        id: verification.providerReference,
        verificationId: verification.id,
        subject: verification.subject,
        kind: input.kind,
        mode: verification.mode,
        country: verification.country,
        resellerId: verification.resellerId,
        customerReference: verification.customerReference,
        storeId: input.storeId ?? null,
        returnUrl: input.returnUrl ?? null,
        livenessSteps: [],
        resubmitItems: [],
      },
    });
    return this.link(verification.providerReference);
  }

  /** A fresh single-use link into the case. */
  async link(caseId: string) {
    const token = `bkh_${randomToken(32)}`;
    await this.prisma.kycSession.create({ data: { caseId, kind: 'handoff', tokenHash: sha256(token), expiresAt: new Date(Date.now() + handoffMs) } });
    return `${this.integrations.config.VERIFY_URL.replace(/\/+$/, '')}/s#t=${token}`;
  }
}
