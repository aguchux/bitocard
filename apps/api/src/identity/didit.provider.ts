import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from '../payments/provider-error';
import type { CheckResult, CheckStatus, DocumentCheckProvider } from './providers';

type DiditSession = { session_id: string; url: string; status: string };
type DiditDecision = {
  session_id: string;
  status: string;
  id_verifications?: Array<{ first_name?: string | null; last_name?: string | null; issuing_state?: string | null; status?: string }> | null;
  reviews?: Array<{ comment?: string | null }> | null;
};

const statuses: Record<string, CheckStatus> = {
  Approved: 'approved',
  Declined: 'declined',
  'In Review': 'in_review',
  Expired: 'expired',
  Abandoned: 'expired',
  'Kyc Expired': 'expired',
};

/** ISO 3166-1 alpha-3 to alpha-2 for the pilot and nearby countries Didit reports; anything else is left out. */
const alpha2: Record<string, string> = { NGA: 'NG', GHA: 'GH', KEN: 'KE', GBR: 'GB', USA: 'US', ZAF: 'ZA', CMR: 'CM', BEN: 'BJ', TGO: 'TG', UGA: 'UG', TZA: 'TZ', RWA: 'RW' };

const signatureToleranceSeconds = 300;

/** Didit v3 sessions: ID document, liveness and face match on Didit's hosted page. */
export class DiditProvider implements DocumentCheckProvider {
  readonly name = 'didit';

  constructor(
    private readonly apiKey: string,
    private readonly workflowId: string,
    private readonly baseUrl: string,
    private readonly webhookSecret?: string,
  ) {}

  private call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    return providerRequest<T>(this.name, `${this.baseUrl}${path}`, { ...init, headers: { 'x-api-key': this.apiKey } });
  }

  async createSession(input: { reference: string; callbackUrl: string; email?: string; firstName?: string; lastName?: string; country?: string }) {
    const session = await this.call<DiditSession>('/v3/session/', {
      method: 'POST',
      body: {
        workflow_id: this.workflowId,
        vendor_data: input.reference,
        callback: input.callbackUrl,
        ...(input.email ? { contact_details: { email: input.email } } : {}),
        ...(input.firstName || input.lastName ? { expected_details: { first_name: input.firstName, last_name: input.lastName } } : {}),
      },
    });
    if (!session?.session_id || !session.url) throw new ProviderError(this.name, 'no session returned', false);
    return { providerReference: session.session_id, url: session.url };
  }

  async result(sessionId: string): Promise<CheckResult> {
    const decision = await this.call<DiditDecision>(`/v3/session/${encodeURIComponent(sessionId)}/decision/`);
    const status = statuses[decision.status] ?? 'in_progress';
    const document = decision.id_verifications?.find(item => item.first_name || item.last_name);
    return {
      status,
      firstName: document?.first_name ?? undefined,
      lastName: document?.last_name ?? undefined,
      documentCountry: document?.issuing_state ? (alpha2[document.issuing_state] ?? (document.issuing_state.length === 2 ? document.issuing_state : undefined)) : undefined,
      reason: status === 'declined' || status === 'in_review' ? (decision.reviews?.find(review => review.comment)?.comment ?? decision.status) : undefined,
    };
  }

  /** X-Signature: HMAC-SHA256 (hex) of the raw body with the webhook secret; X-Timestamp within 5 minutes. */
  webhookTrusted(rawBody: Buffer | undefined, signature: string | undefined, timestamp: string | undefined, now = Math.floor(Date.now() / 1000)) {
    if (!this.webhookSecret || !rawBody || !signature || !timestamp) return false;
    const sent = Number(timestamp);
    if (!Number.isInteger(sent) || Math.abs(now - sent) > signatureToleranceSeconds) return false;
    const expected = Buffer.from(createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
