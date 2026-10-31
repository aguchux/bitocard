import { ProviderError, providerRequest } from '../payments/provider-error.js';

/** Cloudflare's DNS API for BitoCard's own zone (bitocard.com): each reseller store's `<subdomain>` record. */
export type CloudflareDnsConfig = {
  token?: string;
  /** The zone's ID (Cloudflare > the domain > Overview > API: Zone ID). */
  zoneId?: string;
  baseUrl: string;
};

export type CloudflareRecord = { id: string; type: string; name: string; content: string; proxied?: boolean; comment?: string | null };

type Reply<T> = { success: boolean; result: T; errors?: Array<{ code?: number; message?: string }> };

export class CloudflareDns {
  constructor(private readonly settings: CloudflareDnsConfig) {}

  configured() {
    return Boolean(this.settings.token?.trim() && this.settings.zoneId?.trim());
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
    if (!this.configured()) throw new ProviderError('cloudflare', 'store addresses are not set up yet (Settings > Integrations > Store addresses)', true);
    const search = new URLSearchParams(init.query ?? {}).toString();
    const url = `${this.settings.baseUrl.replace(/\/+$/, '')}/zones/${encodeURIComponent(this.settings.zoneId!.trim())}${path}${search ? `?${search}` : ''}`;
    const reply = await providerRequest<Reply<T>>('cloudflare', url, { method: init.method, body: init.body, headers: { authorization: `Bearer ${this.settings.token!.trim()}` } });
    // Cloudflare answers 200 with `success: false` for some refusals.
    if (!reply?.success) throw new ProviderError('cloudflare', reply?.errors?.map(error => error.message).filter(Boolean).join('; ') || 'request refused', true);
    return reply.result;
  }

  /** Test connection: the zone's name, which proves the token and the zone ID together. */
  async zone() {
    return (await this.request<{ name: string }>('')).name;
  }

  /** Every record at exactly this name, of any type. */
  records(name: string) {
    return this.request<CloudflareRecord[]>('/dns_records', { query: { name, per_page: '100' } });
  }

  async createRecord(record: { type: string; name: string; content: string; comment?: string }) {
    // DNS only (proxied: false): Vercel issues the certificate and serves the store; a proxy would hide its errors.
    const created = await this.request<CloudflareRecord>('/dns_records', { method: 'POST', body: { ...record, proxied: false, ttl: 1 } });
    return created.id;
  }

  async deleteRecord(id: string) {
    try {
      await this.request(`/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error;
    }
  }
}
