import { ProviderError, providerRequest } from '../payments/provider-error.js';

/** Vercel's REST API for the storefront's domains: buying (Registrar API), serving (project domains) and DNS records. */
export type VercelDomainsConfig = {
  token?: string;
  teamId?: string;
  /** The storefront's Vercel project (its ID or name): every reseller domain is added to it. */
  project?: string;
  baseUrl: string;
};

export type ProjectDomain = { name: string; verified: boolean; verification?: Array<{ type: string; domain: string; value: string; reason: string }> };
export type DomainConfig = { misconfigured: boolean; configuredBy: string | null; recommendedIPv4?: Array<{ rank: number; value: string[] }>; recommendedCNAME?: Array<{ rank: number; value: string }> };
export type DomainInfo = { name: string; serviceType?: string; nameservers?: string[]; intendedNameservers?: string[]; expiresAt?: number | null; verified?: boolean };
export type DnsRecord = { id: string; name: string; type: string; value: string; ttl?: number; mxPriority?: number; comment?: string };
export type RegistrarOrder = { orderId: string; status: string; domains?: Array<{ domainName: string; status: string; error?: unknown }>; error?: unknown };
export type Contact = { firstName: string; lastName: string; email: string; phone: string; address1: string; address2?: string; city: string; state: string; zip: string; country: string; companyName?: string };

/** Vercel's money fields arrive as numbers or strings; both to US cents (rounded up, never under-charging). */
export function usdCents(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.ceil(Math.round(number * 10_000) / 100) : null;
}

export class VercelDomains {
  constructor(private readonly settings: VercelDomainsConfig) {}

  configured() {
    return Boolean(this.settings.token?.trim() && this.settings.project?.trim());
  }

  private url(path: string, query: Record<string, string> = {}) {
    const params = new URLSearchParams({ ...query, ...(this.settings.teamId?.trim() ? { teamId: this.settings.teamId.trim() } : {}) });
    const search = params.toString();
    return `${this.settings.baseUrl.replace(/\/+$/, '')}${path}${search ? `?${search}` : ''}`;
  }

  private request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
    if (!this.configured()) throw new ProviderError('vercel', 'domains are not set up yet (Settings > Integrations > Domains)', true);
    return providerRequest<T>('vercel', this.url(path, init.query), { method: init.method, body: init.body, headers: { authorization: `Bearer ${this.settings.token!.trim()}` } });
  }

  private get project() {
    return encodeURIComponent(this.settings.project!.trim());
  }

  /** Test connection: the storefront project, which proves the token, the team and the project together. */
  async check() {
    const project = await this.request<{ id: string; name: string }>(`/v9/projects/${this.project}`);
    return project.name;
  }

  // Registrar -------------------------------------------------------------------------------------------------------

  async availability(domain: string) {
    const reply = await this.request<{ available: boolean | string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/availability`);
    return reply.available === true || reply.available === 'true';
  }

  /** The price of one year, and of renewing, in US cents. */
  async price(domain: string, years = 1) {
    const reply = await this.request<{ years?: number | string; purchasePrice?: number | string; renewalPrice?: number | string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/price`, { query: { years: String(years) } });
    const purchase = usdCents(reply.purchasePrice);
    const renewal = usdCents(reply.renewalPrice);
    if (!purchase || !renewal) throw new ProviderError('vercel', 'no price for this domain', true);
    return { purchaseCents: purchase, renewalCents: renewal };
  }

  /** Buys at the price shown (Vercel refuses a different one). Auto-renew stays off: BitoCard renews once the reseller has paid. */
  async buy(domain: string, input: { years: number; costCents: number; contact: Contact }) {
    return this.request<{ orderId: string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/buy`, {
      method: 'POST',
      body: { autoRenew: false, years: input.years, expectedPrice: input.costCents / 100, contactInformation: input.contact },
    });
  }

  order(orderId: string) {
    return this.request<RegistrarOrder>(`/v1/registrar/orders/${encodeURIComponent(orderId)}`);
  }

  async renew(domain: string, input: { years: number; costCents: number }) {
    return this.request<{ orderId?: string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/renew`, { method: 'POST', body: { years: input.years, expectedPrice: input.costCents / 100 } });
  }

  async authCode(domain: string) {
    const reply = await this.request<{ authCode?: string; code?: string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/auth-code`);
    const code = reply.authCode ?? reply.code;
    if (!code) throw new ProviderError('vercel', 'no transfer code returned', true);
    return code;
  }

  // Serving the store on it -------------------------------------------------------------------------------------------

  /** Adds the domain to the storefront project (Vercel issues HTTPS once it resolves). Already added is fine. */
  async addToProject(domain: string): Promise<ProjectDomain> {
    try {
      return await this.request<ProjectDomain>(`/v10/projects/${this.project}/domains`, { method: 'POST', body: { name: domain } });
    } catch (error) {
      if (error instanceof ProviderError && error.status === 409) return this.projectDomain(domain);
      if (error instanceof ProviderError && error.status === 400 && /already/i.test(error.message)) return this.projectDomain(domain);
      throw error;
    }
  }

  projectDomain(domain: string) {
    return this.request<ProjectDomain>(`/v9/projects/${this.project}/domains/${encodeURIComponent(domain)}`);
  }

  verifyProjectDomain(domain: string) {
    return this.request<ProjectDomain>(`/v9/projects/${this.project}/domains/${encodeURIComponent(domain)}/verify`, { method: 'POST' });
  }

  async removeFromProject(domain: string) {
    try {
      await this.request(`/v9/projects/${this.project}/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error;
    }
  }

  domainConfig(domain: string) {
    return this.request<DomainConfig>(`/v6/domains/${encodeURIComponent(domain)}/config`, { query: { projectIdOrName: this.settings.project!.trim() } });
  }

  async info(domain: string) {
    const reply = await this.request<{ domain: DomainInfo }>(`/v5/domains/${encodeURIComponent(domain)}`);
    return reply.domain;
  }

  // DNS records (domains on Vercel's nameservers) -----------------------------------------------------------------------

  async records(domain: string): Promise<DnsRecord[]> {
    const reply = await this.request<{ records?: DnsRecord[] }>(`/v4/domains/${encodeURIComponent(domain)}/records`, { query: { limit: '100' } });
    return reply.records ?? [];
  }

  async createRecord(domain: string, record: { name: string; type: string; value: string; ttl?: number; mxPriority?: number; comment?: string }) {
    const reply = await this.request<{ uid?: string; id?: string }>(`/v2/domains/${encodeURIComponent(domain)}/records`, {
      method: 'POST',
      body: { name: record.name, type: record.type, value: record.value, ttl: record.ttl ?? 3600, ...(record.type === 'MX' ? { mxPriority: record.mxPriority ?? 10 } : {}), ...(record.comment ? { comment: record.comment } : {}) },
    });
    return reply.uid ?? reply.id ?? '';
  }

  async deleteRecord(domain: string, recordId: string) {
    try {
      await this.request(`/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error;
    }
  }
}
