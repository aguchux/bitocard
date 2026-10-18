import { ProviderError, providerRequest } from '../payments/provider-error.js';

/** One DNS record Resend needs on the sending domain (its name is relative to the domain: `resend._domainkey`). */
export type SendingRecord = { record: string; name: string; type: string; value: string; priority?: number; status?: string };
export type SendingDomain = { id: string; name: string; status: string; records: SendingRecord[] };

/**
 * Resend's domains API: a reseller's domain verified for sending (DKIM and SPF on its `send` subdomain), so the store's
 * order emails come from `orders@<their domain>`. Statuses: not_started, pending, verified, failed, temporary_failure.
 */
export class ResendDomains {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    return providerRequest<T>('resend', `${this.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${this.apiKey}` } });
  }

  async create(name: string): Promise<SendingDomain> {
    const domain = await this.request<SendingDomain>('/domains', { method: 'POST', body: { name } });
    if (!domain?.id) throw new ProviderError('resend', 'no domain returned', true);
    return { ...domain, records: domain.records ?? [] };
  }

  async get(id: string): Promise<SendingDomain> {
    const domain = await this.request<SendingDomain>(`/domains/${encodeURIComponent(id)}`);
    return { ...domain, records: domain.records ?? [] };
  }

  async verify(id: string) {
    await this.request(`/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' });
  }
}
