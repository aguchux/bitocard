import type { AppConfig } from '../config/config.js';
import type { Environment } from '../integrations/endpoints.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';

export type ConnectableKind = 'supplier' | 'payment_gateway';

export type ConnectableField = {
  /** The credential's name in the request body (`client_secret`). */
  key: string;
  label: string;
  /** Write-only: encrypted at rest and never returned (only the last four characters). */
  secret: boolean;
  required: boolean;
  help?: string;
};

/** The provider addresses checks use, already resolved for live or sandbox (`urlsFor`; tests point them at fakes). */
type Urls = Pick<AppConfig, 'RELOADLY_AUTH_URL' | 'RELOADLY_TOPUPS_URL' | 'VTPASS_API_URL' | 'DIDWW_API_URL' | 'ZENDIT_API_URL' | 'PAWAPAY_API_URL' | 'FLUTTERWAVE_API_URL' | 'MONNIFY_API_URL'>;

export type ConnectableIntegration = {
  /** Matches the platform integration group's id, so admins find both in one place. */
  id: string;
  kind: ConnectableKind;
  name: string;
  description: string;
  fields: ConnectableField[];
  /**
   * Suppliers that notify order updates: each live connection gets its own address (`/v1/webhooks/<id>/<connection>`).
   * `manual`: the reseller enters it in the supplier's dashboard and saves the signature secret (`secretField`);
   * `automatic`: BitoCard gives it to the supplier on every order. Without it, own orders rely on scheduled checks.
   */
  notifications?: { setup: 'manual'; secretField: string } | { setup: 'automatic' };
  /**
   * A harmless call proving the credentials work (a token, a balance), at the live or sandbox addresses given. Throws a
   * ProviderError: `definite` when the provider refused the credentials, otherwise it could not be reached.
   */
  check: (values: Record<string, string>, urls: Urls, environment: Environment) => Promise<void>;
  /** BitoCard's own credentials for it from the integration settings, in these fields' names (admins' Test connection). */
  fromSettings: (config: AppConfig) => Record<string, string | undefined>;
};

const field = (key: string, label: string, options: Partial<ConnectableField> = {}): ConnectableField => ({ key, label, secret: false, required: true, ...options });
const secret = (key: string, label: string, options: Partial<ConnectableField> = {}) => field(key, label, { secret: true, ...options });

/** A provider that answered but said no: a refusal of the credentials. */
const refused = (provider: string) => new ProviderError(provider, 'credentials refused', true);

/**
 * Integrations with a built BitoCard adapter that resellers can connect their own accounts to: each needs its fields
 * (what the provider issues), a check, and how BitoCard's own settings map onto the fields. Admins switch on reseller
 * access per integration, then offer it per country. The same checks test BitoCard's own credentials (live or sandbox).
 */
export const connectableIntegrations: ConnectableIntegration[] = [
  {
    id: 'reloadly',
    kind: 'supplier',
    name: 'Reloadly',
    description: 'Gift cards, airtime and data from your own Reloadly account and prices.',
    fields: [
      field('client_id', 'Client ID', { help: 'Reloadly dashboard > Developers > API settings.' }),
      secret('client_secret', 'Client secret'),
      secret('webhook_secret', 'Webhook signature secret', { required: false, help: 'From Reloadly’s Developers > Webhooks, once BitoCard gives you a webhook address.' }),
    ],
    notifications: { setup: 'manual', secretField: 'webhook_secret' },
    check: async (values, urls) => {
      const token = await providerRequest<{ access_token?: string }>('reloadly', `${urls.RELOADLY_AUTH_URL}/oauth/token`, {
        method: 'POST',
        body: { client_id: values.client_id, client_secret: values.client_secret, grant_type: 'client_credentials', audience: urls.RELOADLY_TOPUPS_URL ?? 'https://topups.reloadly.com' },
      });
      if (!token?.access_token) throw refused('reloadly');
    },
    fromSettings: config => ({ client_id: config.RELOADLY_CLIENT_ID, client_secret: config.RELOADLY_CLIENT_SECRET }),
  },
  {
    id: 'vtpass',
    kind: 'supplier',
    name: 'VTpass',
    description: 'Nigerian pay-TV, electricity, airtime and data from your own VTpass account.',
    fields: [secret('api_key', 'API key'), secret('public_key', 'Public key'), secret('secret_key', 'Secret key')],
    check: async (values, urls) => {
      const balance = await providerRequest<{ code?: number | string }>('vtpass', `${urls.VTPASS_API_URL}/balance`, {
        headers: { 'api-key': values.api_key, 'public-key': values.public_key },
      });
      if (String(balance?.code) !== '1') throw refused('vtpass');
    },
    fromSettings: config => ({ api_key: config.VTPASS_API_KEY, public_key: config.VTPASS_PUBLIC_KEY, secret_key: config.VTPASS_SECRET_KEY }),
  },
  {
    id: 'didww',
    kind: 'supplier',
    name: 'DIDWW',
    description: 'Virtual phone numbers from your own DIDWW account.',
    fields: [secret('api_key', 'API key')],
    notifications: { setup: 'automatic' },
    check: async (values, urls) => {
      await providerRequest('didww', `${urls.DIDWW_API_URL}/balance`, {
        headers: { 'api-key': values.api_key, accept: 'application/vnd.api+json', 'x-didww-api-version': '2022-05-10' },
      });
    },
    fromSettings: config => ({ api_key: config.DIDWW_API_KEY }),
  },
  {
    id: 'zendit',
    kind: 'supplier',
    name: 'Zendit',
    description: 'Gift cards, airtime, bundles and data from your own Zendit account and prices.',
    fields: [secret('api_key', 'API key', { help: 'Zendit console > Developers > API settings. Test mode and production keys differ.' })],
    check: async (values, urls) => {
      await providerRequest('zendit', `${urls.ZENDIT_API_URL}/balance`, { headers: { authorization: `Bearer ${values.api_key}` } });
    },
    fromSettings: config => ({ api_key: config.ZENDIT_API_KEY }),
  },
  {
    id: 'pawapay',
    kind: 'supplier',
    name: 'pawaPay',
    description: 'Mobile money top-ups paid from your own pawaPay wallets.',
    fields: [
      secret('api_token', 'API token', { help: 'pawaPay dashboard > System configuration > API tokens. Sandbox and production tokens differ.' }),
      field('payout_fee_percent', 'Payout fee (%)', { help: 'The payout fee in your pawaPay agreement, for example 1.5: your cost is the amount plus this fee.' }),
    ],
    check: async (values, urls) => {
      await providerRequest('pawapay', `${urls.PAWAPAY_API_URL}/v2/active-conf?operationType=PAYOUT`, { headers: { authorization: `Bearer ${(values.api_token ?? '').trim().replace(/^bearer\s+/i, '')}` } });
    },
    fromSettings: config => ({ api_token: config.PAWAPAY_API_TOKEN, payout_fee_percent: config.PAWAPAY_PAYOUT_FEE_PERCENT }),
  },
  {
    id: 'flutterwave',
    kind: 'payment_gateway',
    name: 'Flutterwave',
    description: 'Card, bank transfer and mobile money checkout, paid into your own Flutterwave account.',
    fields: [secret('secret_key', 'Secret key'), secret('webhook_hash', 'Webhook secret hash', { required: false, help: 'From Flutterwave’s Settings > Webhooks.' })],
    check: async (values, urls, environment) => {
      // Flutterwave decides test or live by the key itself (FLWSECK_TEST-… for test), at the same address.
      if (/^FLWSECK_TEST/i.test(values.secret_key ?? '') !== (environment === 'sandbox')) {
        throw new ProviderError('flutterwave', environment === 'sandbox' ? 'a live key was given for the sandbox' : 'a test key was given for live', true);
      }
      const result = await providerRequest<{ status?: string }>('flutterwave', `${urls.FLUTTERWAVE_API_URL}/balances`, { headers: { authorization: `Bearer ${values.secret_key}` } });
      if (result?.status !== 'success') throw refused('flutterwave');
    },
    fromSettings: config => ({ secret_key: config.FLUTTERWAVE_SECRET_KEY }),
  },
  {
    id: 'monnify',
    kind: 'payment_gateway',
    name: 'Monnify',
    description: 'Nigerian card and bank transfer checkout, paid into your own Monnify account.',
    fields: [field('api_key', 'API key'), secret('secret_key', 'Secret key'), field('contract_code', 'Contract code')],
    check: async (values, urls) => {
      const basic = Buffer.from(`${values.api_key}:${values.secret_key}`).toString('base64');
      const login = await providerRequest<{ requestSuccessful?: boolean }>('monnify', `${urls.MONNIFY_API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { authorization: `Basic ${basic}` },
      });
      if (!login?.requestSuccessful) throw refused('monnify');
    },
    fromSettings: config => ({ api_key: config.MONNIFY_API_KEY, secret_key: config.MONNIFY_SECRET_KEY, contract_code: config.MONNIFY_CONTRACT_CODE }),
  },
];

export const connectable = (id: string) => connectableIntegrations.find(item => item.id === id);
