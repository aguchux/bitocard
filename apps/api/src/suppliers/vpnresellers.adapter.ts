import type { ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { CatalogueItem, FulfilmentRequest, FulfilmentResult, SupplierAdapter, VpnState, VpnSupplier } from './adapter.js';

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
type AccountListReply = { data?: RawAccount[]; meta?: { current_page?: number; last_page?: number; total?: number }; code?: number };

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

/** The one VPN product sold: 30 days of access, never renewed automatically. */
export const vpnSku = 'vpn-30-day';
export const vpnProductKey = 'vpn:WW:bitocard:vpn-access-30d';
export const vpnTermDays = 30;
export const vpnDeviceLimit = 10;

/** A date's UTC calendar day, `YYYY-MM-DD`. */
const dateOf = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);

/**
 * When access bought now ends: the start of the UTC day after 30 full days, so the customer always gets at least the
 * 30 days promised (the supplier takes a calendar date and ends access at its midnight, UTC).
 */
export function vpnExpiry(now = new Date()) {
  const end = new Date(now.getTime() + vpnTermDays * 24 * 60 * 60 * 1000);
  const midnight = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return new Date(midnight === end.getTime() ? midnight : midnight + 24 * 60 * 60 * 1000);
}

/** The calendar date sent to the supplier for an expiry. */
export const vpnExpiryDate = (expiresAt: Date) => dateOf(expiresAt)!;

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
 * VPNresellers API v4.1 (bearer token): one internal product, "VPN access (30 days)", provisioned per order as a
 * supplier account in BitoCard's project with an explicit expiry, and managed after (`vpn`: status, enable, disable,
 * password, expiry). Accounts bill daily while Active, so `VpnService` disables them at expiry and reconciles them.
 * Never named to resellers or customers.
 */
export class VpnresellersAdapter implements SupplierAdapter {
  readonly code = 'vpnresellers';
  readonly syncs: ProductCategory[] = ['vpn'];
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
    const cost = this.monthlyCostUsd();
    if (cost === null) return [];
    const costMinor = BigInt(Math.ceil(cost * 100));
    return [
      {
        sku: vpnSku,
        productKey: vpnProductKey,
        category: 'vpn',
        country: 'WW',
        brand: 'bitocard',
        name: 'VPN access (30 days)',
        faceCurrency: 'USD',
        denominationType: 'fixed',
        fixedValues: [costMinor],
        recipientType: 'none',
        description: 'VPN access for 30 days on supported phones, computers and TV devices. Up to 10 devices. Does not renew automatically.',
        redeemInstructions: 'Open your order, reveal the VPN username and password, install the supported VPN client for your device, then sign in. Access ends on the date shown in your order.',
        costCurrency: 'USD',
        costRatio: '1',
        costFee: 0n,
        meta: { term_days: vpnTermDays, device_limit: vpnDeviceLimit },
      },
    ];
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

  /**
   * Whether a username is already taken, without paging through every account: `check_username` answers 200 when it is
   * free and 422 when it is taken. Anything else is unclear and throws (never read as "free").
   */
  async usernameTaken(username: string) {
    try {
      await this.request(`/accounts/check_username?${new URLSearchParams({ username })}`);
      return false;
    } catch (error) {
      if (error instanceof ProviderError && error.status === 422) return true;
      throw error;
    }
  }

  /**
   * The account with this username, or null when none exists. Free usernames answer at once (`check_username`); a taken
   * one is found by paging through the project's accounts (only on recovery, after an unclear create).
   */
  async findAccountByUsername(username: string) {
    if (!(await this.usernameTaken(username))) return null;
    const { accounts } = await this.listAccounts(undefined, item => item.username === username);
    if (accounts[0]) return accounts[0];
    // Taken but not in our project's list: someone else's account, or the list is behind. Never create over it.
    throw new ProviderError(this.code, 'the username is taken but its account was not found', false);
  }

  /**
   * Accounts in BitoCard's project (for reconciliation), at most 200 pages of 100. With `until`, stops at the first
   * account it matches and returns only that one.
   */
  async listAccounts(status?: 'Active' | 'Disabled', until?: (item: RawAccount) => boolean) {
    const project = this.projectId();
    const path = project === null ? '/accounts' : `/projects/${project}/accounts`;
    const accounts: VpnresellersAccount[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const query = new URLSearchParams({ page: String(page), per_page: '100', ...(status ? { status } : {}) });
      const reply = await this.request<AccountListReply>(`${path}?${query}`);
      for (const item of reply.data ?? []) {
        if (until && !until(item)) continue;
        try {
          accounts.push(account(item));
        } catch {
          // An account without an ID or username cannot be matched; it is skipped, never guessed.
        }
        if (until) return { accounts, complete: true };
      }
      const last = reply.meta?.last_page ?? page;
      if (page >= last || (reply.data ?? []).length === 0) return { accounts, complete: true };
    }
    return { accounts, complete: false };
  }

  /** The prepaid credit left on BitoCard's account, in US dollars (`GET /profile`). */
  async balanceUsd() {
    const reply = await this.request<{ data?: { balance?: string | number } }>('/profile');
    const value = Number(reply.data?.balance);
    if (reply.data?.balance === undefined || !Number.isFinite(value)) throw new ProviderError(this.code, 'balance missing from the profile', false);
    return value;
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

  /**
   * Creates the order's account once, inside BitoCard's project, with the username and password BitoCard prepared and
   * stored before calling (so a retry uses the same ones), then sets and verifies its expiry.
   *
   * - The username is looked up first, so a repeated attempt finds the account instead of creating a second one.
   * - A clear refusal before anything exists fails the order. A timeout or unclear reply leaves it pending: the status
   *   check looks the username up again and never creates blindly.
   * - A 422 on create may be the username already taken by an earlier, unclear create: it is recovered by lookup.
   */
  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const credentials = this.credentials(request);
    const project = this.projectId();
    if (project === null) throw new ProviderError(this.code, 'project ID is not configured', true);
    let found: VpnresellersAccount | null;
    try {
      found = await this.findAccountByUsername(credentials.username);
    } catch (error) {
      return { status: 'pending', detail: `VPN account lookup unclear: ${(error as Error).message}` };
    }
    if (!found) {
      try {
        found = await this.createAccount({
          username: credentials.username,
          password: credentials.password,
          // No end-user details are sent: the supplier's customer record is BitoCard's, named after the account.
          customer: { firstName: 'BitoCard', lastName: credentials.username, email: `vpn+${credentials.username}@bitocard.com`, projectId: project },
        });
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.definite) return { status: 'pending', detail: `VPN account create unclear: ${(error as Error).message}` };
        if (error.status !== 422) throw error;
        try {
          found = await this.findAccountByUsername(credentials.username);
        } catch (lookup) {
          return { status: 'pending', detail: `VPN account create refused; lookup unclear: ${(lookup as Error).message}` };
        }
        if (!found) throw error;
      }
    }
    return this.finish(found, request);
  }

  /** Finds the order's account (by its ID once known, else its username) and finishes setting it up. Never creates. */
  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    const credentials = this.credentials(request);
    let found: VpnresellersAccount | null;
    try {
      found = supplierTransactionId ? await this.getAccount(supplierTransactionId) : await this.findAccountByUsername(credentials.username);
    } catch (error) {
      return { status: 'pending', supplierTransactionId, detail: `VPN account not read: ${(error as Error).message}` };
    }
    if (!found) return { status: 'pending', detail: 'VPN account has not been found; it is left for review, never created again automatically' };
    if (found.username !== credentials.username) return { status: 'pending', supplierTransactionId, detail: 'VPN account username does not match the order' };
    return this.finish(found, request);
  }

  /**
   * Once an account exists every problem stays pending, never failed: failing the order would refund the customer and
   * leave an account billing daily. Completes only when a fresh read shows it Active with exactly the promised expiry
   * (an account with no expiry renews automatically and bills every day).
   */
  private async finish(found: VpnresellersAccount, request: FulfilmentRequest): Promise<FulfilmentResult> {
    const credentials = this.credentials(request);
    const expiresOn = vpnExpiryDate(credentials.expiresAt);
    try {
      let current = found.status === 'disabled' ? await this.enableAccount(found.id) : found;
      if (dateOf(current.expiresAt) !== expiresOn) current = await this.expireAccount(found.id, expiresOn);
      current = await this.getAccount(found.id);
      if (current.status !== 'active' || !current.expiresAt || dateOf(current.expiresAt) !== expiresOn) {
        return { status: 'pending', supplierTransactionId: found.id, detail: 'VPN account exists but its active status or expiry is not confirmed' };
      }
      const expectedCost = this.monthlyCostUsd();
      return {
        status: 'completed',
        supplierTransactionId: found.id,
        deliveries: [
          {
            kind: 'vpn_account',
            code: credentials.password,
            serial: credentials.username,
            details: { expires_at: current.expiresAt.toISOString(), duration: '30 days', devices: 'Up to 10', renewal: 'Does not renew automatically' },
          },
        ],
        vpns: [{ supplierAccountId: found.id, status: 'active', supplierStatus: current.supplierStatus, startsAt: new Date(), expiresAt: current.expiresAt }],
        ...(expectedCost === null ? {} : { reportedCost: { amountMinor: BigInt(Math.ceil(expectedCost * 100)), currency: 'USD' } }),
      };
    } catch (error) {
      return { status: 'pending', supplierTransactionId: found.id, detail: `VPN account exists; setup is not confirmed: ${(error as Error).message}` };
    }
  }

  private credentials(request: FulfilmentRequest) {
    if (request.sku !== vpnSku || Number(request.meta.term_days) !== vpnTermDays) throw new ProviderError(this.code, 'unsupported VPN product', true);
    const credentials = request.vpnCredentials;
    if (!credentials?.username || !credentials.password || Number.isNaN(credentials.expiresAt.getTime())) {
      throw new ProviderError(this.code, 'prepared VPN credentials are missing', true);
    }
    return credentials;
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
