import type { ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { CatalogueItem, SupplierAdapter, VpnState, VpnSupplier } from './adapter.js';

type AccountReply = { data?: RawAccount | null; code?: number; message?: string };
type RawAccount = {
  id?: number | string;
  username?: string;
  status?: string;
  expired_at?: string | null;
  created?: string;
  updated?: string;
  // The API also returns WireGuard keys. Deliberately omit them from BitoCard's normalised account.
};

export type VpnresellersAccount = {
  id: string;
  username: string;
  status: 'active' | 'disabled' | 'unknown';
  supplierStatus: string | null;
  expiresAt: Date | null;
};

export type CreateVpnresellersAccount = {
  username: string;
  password: string;
  customer?: { customerId: number } | { firstName: string; lastName: string; email: string; projectId: number };
};

const accountPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

function date(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function vpnresellersStatus(value: string | null | undefined): VpnresellersAccount['status'] {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'active':
      return 'active';
    case 'disabled':
    case 'inactive':
      return 'disabled';
    default:
      return 'unknown';
  }
}

function account(value: RawAccount | null | undefined): VpnresellersAccount {
  const id = value?.id === undefined || value?.id === null ? '' : String(value.id);
  const username = value?.username?.trim() ?? '';
  if (!id || !username) throw new ProviderError('vpnresellers', 'account response is missing its ID or username', false);
  return {
    id,
    username,
    status: vpnresellersStatus(value?.status),
    supplierStatus: value?.status?.trim() || null,
    expiresAt: date(value?.expired_at),
  };
}

/**
 * VPNresellers API v4.1 transport and account lifecycle.
 *
 * This stage intentionally syncs no products and implements no `placeOrder`: VPN cannot be sold until BitoCard has
 * lifecycle persistence, pre-call encrypted credential storage, ambiguous-create reconciliation and expiry automation.
 */
export class VpnresellersAdapter implements SupplierAdapter {
  readonly code = 'vpnresellers';
  readonly syncs: ProductCategory[] = [];
  readonly vpn: VpnSupplier = {
    status: async id => this.state(await this.getAccount(id)),
    enable: async id => this.state(await this.enableAccount(id)),
    disable: async id => this.state(await this.disableAccount(id)),
    changePassword: async (id, password) => this.state(await this.changePassword(id, password)),
    expire: async (id, expiresOn) => this.state(await this.expireAccount(id, expiresOn)),
  };

  constructor(private readonly config: { apiToken?: string; projectId?: string; monthlyCostUsd?: string; baseUrl?: string }) {}

  configured() {
    return Boolean(this.config.apiToken?.trim() && this.projectId() !== null && this.monthlyCostUsd() !== null);
  }

  async catalogue(): Promise<CatalogueItem[]> {
    return [];
  }

  projectId() {
    const value = Number(this.config.projectId);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  /** Expected monthly cost only. The order will snapshot a whole-term estimate and reconciliation records actual cost. */
  monthlyCostUsd() {
    const value = Number(this.config.monthlyCostUsd);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async createAccount(input: CreateVpnresellersAccount) {
    const customer = input.customer
      ? 'customerId' in input.customer
        ? { customer_id: input.customer.customerId }
        : {
            first_name: input.customer.firstName,
            last_name: input.customer.lastName,
            email: input.customer.email,
            project_id: input.customer.projectId,
          }
      : undefined;
    const reply = await this.request<AccountReply>('/accounts', { method: 'POST', body: { username: input.username, password: input.password, ...(customer ? { customer } : {}) } });
    return account(reply.data);
  }

  async getAccount(accountId: string) {
    const reply = await this.request<AccountReply>(accountPath(accountId));
    return account(reply.data);
  }

  async enableAccount(accountId: string) {
    const reply = await this.request<AccountReply>(`${accountPath(accountId)}/enable`, { method: 'PUT' });
    return account(reply.data);
  }

  async disableAccount(accountId: string) {
    const reply = await this.request<AccountReply>(`${accountPath(accountId)}/disable`, { method: 'PUT' });
    return account(reply.data);
  }

  async changePassword(accountId: string, password: string) {
    const reply = await this.request<AccountReply>(`${accountPath(accountId)}/change_password`, { method: 'PUT', body: { password } });
    return account(reply.data);
  }

  /** VPNresellers accepts a calendar date. BitoCard must verify the returned expiry before completing fulfilment. */
  async expireAccount(accountId: string, expiresOn: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error('expiresOn must use YYYY-MM-DD');
    const reply = await this.request<AccountReply>(`${accountPath(accountId)}/expire`, { method: 'PUT', body: { expire_at: expiresOn } });
    return account(reply.data);
  }

  private state(value: VpnresellersAccount): VpnState {
    return {
      supplierAccountId: value.id,
      status: value.status,
      supplierStatus: value.supplierStatus,
      expiresAt: value.expiresAt,
    };
  }

  private request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = this.config.apiToken?.trim();
    if (!token) throw new ProviderError(this.code, 'not configured', true);
    const baseUrl = (this.config.baseUrl?.trim() || 'https://api.vpnresellers.com/v4_1').replace(/\/+$/, '');
    return providerRequest<T>(this.code, `${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}` },
    });
  }
}
