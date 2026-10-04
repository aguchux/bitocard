import type { AppConfig } from '../config/config.js';
import { supplierCredentialGroups, supplierCredentialKey } from './supplier-credentials.js';

/**
 * Settings an admin sets in the admin app (Settings > Integrations) instead of the environment, so the API can start
 * with only its required environment (database, encryption key, cron secret and the like) and services are connected
 * as BitoCard subscribes to them. Each field is named after the environment variable it replaces: an admin value wins,
 * the environment is the fallback (local development and tests), then the default in `config.ts`.
 *
 * Keep out of here anything the API needs before it can reach the database, or that protects admin access itself
 * (ALLOWED_ORIGINS, cookie settings, ADMIN_EMAIL_DOMAINS, ENCRYPTION_KEY, CRON_SECRET): a mistaken admin edit must
 * never be able to lock admins out or widen who can sign in.
 */
export type IntegrationKind = 'text' | 'url' | 'email' | 'number' | 'flag';

export type IntegrationField = {
  /** The environment variable it replaces (platform settings), or the supplier credential's name (`TELNYX_API_KEY`). */
  key: string;
  label: string;
  /** Write-only: encrypted at rest and never returned (the API shows only the last four characters). */
  secret: boolean;
  kind: IntegrationKind;
  /** Needed for the integration to work; it shows as not connected until every required field has a value. */
  required: boolean;
  help?: string;
};

export type IntegrationGroup = {
  id: string;
  name: string;
  description: string;
  fields: IntegrationField[];
  webhookPath?: string;
  /** Platform services, or suppliers from the registry. */
  section: 'platform' | 'suppliers';
  /** False while the supplier's adapter is a stub: its credentials are stored for later and nothing uses them yet. */
  adapterReady: boolean;
};

const integrationKeyList = [
  'DASHBOARD_URL',
  'PAYMENT_RETURN_URL',
  'ALERT_EMAIL',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'MAILERSEND_API_KEY',
  'TERMII_API_KEY',
  'TERMII_API_URL',
  'TERMII_SENDER_ID',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'FLUTTERWAVE_SECRET_KEY',
  'FLUTTERWAVE_WEBHOOK_HASH',
  'MONNIFY_API_KEY',
  'MONNIFY_SECRET_KEY',
  'MONNIFY_CONTRACT_CODE',
  'MONNIFY_API_URL',
  'OPEN_EXCHANGE_RATES_APP_ID',
  'FX_MAX_AGE_MINUTES',
  'RELOADLY_CLIENT_ID',
  'RELOADLY_CLIENT_SECRET',
  'RELOADLY_SANDBOX',
  'RELOADLY_WEBHOOK_SECRET',
  'VTPASS_API_KEY',
  'VTPASS_PUBLIC_KEY',
  'VTPASS_SECRET_KEY',
  'VTPASS_API_URL',
  'VTPASS_CONTACT_PHONE',
  'DIDWW_API_KEY',
  'DIDWW_API_URL',
  'DIDWW_COUNTRIES',
  'DIDWW_CALLBACK_URL',
  'DIDIT_API_KEY',
  'DIDIT_WORKFLOW_ID',
  'DIDIT_WEBHOOK_SECRET',
] as const satisfies ReadonlyArray<keyof AppConfig>;

export type IntegrationKey = (typeof integrationKeyList)[number];
export const integrationKeys: readonly IntegrationKey[] = integrationKeyList;

/** The settings services read: the same names and types as AppConfig, with admin values applied. */
export type IntegrationConfig = Pick<AppConfig, IntegrationKey>;

const field = (key: string, label: string, options: Partial<Omit<IntegrationField, 'key' | 'label'>> = {}): IntegrationField => ({
  key,
  label,
  secret: false,
  kind: 'text',
  required: false,
  ...options,
});
const secret = (key: string, label: string, options: Partial<Omit<IntegrationField, 'key' | 'label'>> = {}) => field(key, label, { secret: true, required: true, ...options });

const platformGroups: Array<Omit<IntegrationGroup, 'section' | 'adapterReady'>> = [
  {
    id: 'general',
    name: 'Links and alerts',
    description: 'Where emails and payment pages send people back to, and where operational alerts go.',
    fields: [
      field('DASHBOARD_URL', 'Reseller dashboard address', { kind: 'url', help: 'Links in emails point here.' }),
      field('PAYMENT_RETURN_URL', 'Payment return address', { kind: 'url', help: 'Where a payment page returns the payer when the caller gives none.' }),
      field('ALERT_EMAIL', 'Alerts email', { kind: 'email', help: 'Operational alerts, for example conversions paused.' }),
    ],
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Sign-in codes, receipts and notices. Resend is tried first, then MailerSend. With neither, emails are only logged.',
    fields: [
      secret('RESEND_API_KEY', 'Resend API key', { required: false }),
      secret('MAILERSEND_API_KEY', 'MailerSend API key', { required: false }),
      field('EMAIL_FROM', 'Sender', { help: 'For example: BitoCard <no-reply@bitocard.com>. The domain must be verified with the email providers.' }),
    ],
  },
  {
    id: 'sms',
    name: 'SMS (Termii)',
    description: 'Mobile number verification and sign-in codes. Without a key, texts are only logged.',
    fields: [
      secret('TERMII_API_KEY', 'API key'),
      field('TERMII_API_URL', 'API address', { kind: 'url', help: 'Account-specific; shown in the Termii dashboard.' }),
      field('TERMII_SENDER_ID', 'Sender ID'),
    ],
  },
  {
    id: 'web_push',
    name: 'Browser push',
    description:
      'Push notifications to the browsers people turn them on in (SHQ and the admin app). Switched off until both keys are set; generate a pair with npm run push:keys -w @bitocard/api. Changing the keys stops pushes to every registered browser until it is turned on again.',
    fields: [
      field('WEB_PUSH_PUBLIC_KEY', 'Public key (VAPID)', { required: true, help: 'The browser uses it to subscribe.' }),
      secret('WEB_PUSH_PRIVATE_KEY', 'Private key (VAPID)'),
      field('WEB_PUSH_SUBJECT', 'Contact', { help: 'A mailto: or https: address push services can contact. Default: mailto:support@bitocard.com' }),
    ],
  },
  {
    id: 'google',
    name: 'Google sign-in',
    description: 'Sign in with Google for resellers (never admins). Switched off until the client ID and secret are set.',
    fields: [
      field('GOOGLE_CLIENT_ID', 'Client ID', { required: true }),
      secret('GOOGLE_CLIENT_SECRET', 'Client secret'),
      field('GOOGLE_REDIRECT_URI', 'Redirect URI', { kind: 'url', help: 'Must match the Google Cloud console: https://api.bitocard.com/v1/auth/google/callback' }),
    ],
  },
  {
    id: 'flutterwave',
    name: 'Flutterwave',
    description: 'Card and bank top-ups, reserved accounts, payouts, BVN checks and offered exchange rates.',
    webhookPath: '/v1/webhooks/flutterwave',
    fields: [
      secret('FLUTTERWAVE_SECRET_KEY', 'Secret key'),
      secret('FLUTTERWAVE_WEBHOOK_HASH', 'Webhook secret hash', { help: 'The secret hash set under Webhooks in the Flutterwave dashboard.' }),
    ],
  },
  {
    id: 'monnify',
    name: 'Monnify',
    description: 'Nigerian reserved accounts, after Flutterwave.',
    webhookPath: '/v1/webhooks/monnify',
    fields: [
      secret('MONNIFY_API_KEY', 'API key'),
      secret('MONNIFY_SECRET_KEY', 'Secret key'),
      field('MONNIFY_CONTRACT_CODE', 'Contract code', { required: true }),
      field('MONNIFY_API_URL', 'API address', { kind: 'url', help: 'Sandbox: https://sandbox.monnify.com' }),
    ],
  },
  {
    id: 'exchange_rates',
    name: 'Exchange rates (Open Exchange Rates)',
    description: 'Reference rates, checked against Flutterwave’s offered rates.',
    fields: [
      secret('OPEN_EXCHANGE_RATES_APP_ID', 'App ID'),
      field('FX_MAX_AGE_MINUTES', 'Maximum rate age (minutes)', { kind: 'number', help: 'Older rates are not used; conversions pause until rates refresh.' }),
    ],
  },
  {
    id: 'reloadly',
    name: 'Reloadly',
    description: 'Gift cards, airtime and data. Without credentials it serves only the sandbox, never live orders.',
    webhookPath: '/v1/webhooks/reloadly',
    fields: [
      field('RELOADLY_CLIENT_ID', 'Client ID', { required: true }),
      secret('RELOADLY_CLIENT_SECRET', 'Client secret'),
      field('RELOADLY_SANDBOX', 'Use Reloadly’s sandbox', { kind: 'flag', help: 'On: Reloadly test credits, no real cards. Off: live.' }),
      secret('RELOADLY_WEBHOOK_SECRET', 'Webhook signature secret', {
        required: false,
        help: 'Developers > Webhooks in the Reloadly dashboard. Subscribe to the gift card and airtime transaction status events. Without it, notifications are refused and orders are still checked on schedule.',
      }),
    ],
  },
  {
    id: 'vtpass',
    name: 'VTpass',
    description: 'Nigerian pay-TV and electricity. Without credentials it serves only the sandbox, never live orders.',
    fields: [
      secret('VTPASS_API_KEY', 'API key'),
      secret('VTPASS_PUBLIC_KEY', 'Public key'),
      secret('VTPASS_SECRET_KEY', 'Secret key'),
      field('VTPASS_API_URL', 'API address', { kind: 'url', help: 'Sandbox: https://sandbox.vtpass.com/api' }),
      field('VTPASS_CONTACT_PHONE', 'Fallback phone number', { help: 'VTpass needs a phone number on every payment; used when the customer gave none.' }),
    ],
  },
  {
    id: 'didww',
    name: 'DIDWW',
    description: 'Virtual phone numbers (voice and SMS). Without an API key it serves only the sandbox, never live orders.',
    webhookPath: '/v1/webhooks/didww',
    fields: [
      secret('DIDWW_API_KEY', 'API key', { help: 'DIDWW dashboard > API. Also verifies DIDWW’s order callbacks.' }),
      field('DIDWW_API_URL', 'API address', { kind: 'url', help: 'Sandbox: https://sandbox-api.didww.com/v3' }),
      field('DIDWW_COUNTRIES', 'Number countries', { help: 'ISO codes of the countries whose numbers are synced, separated by commas, for example GB,US.' }),
      field('DIDWW_CALLBACK_URL', 'API public address', { kind: 'url', help: 'Order callbacks go to this address plus /v1/webhooks/didww. Default: https://api.bitocard.com' }),
    ],
  },
  {
    id: 'didit',
    name: 'Didit identity checks',
    description: 'Reseller owners everywhere, and customers outside Nigeria. Switched off until the API key and workflow are set.',
    webhookPath: '/v1/webhooks/didit',
    fields: [
      secret('DIDIT_API_KEY', 'API key'),
      field('DIDIT_WORKFLOW_ID', 'Workflow ID', { required: true, help: 'The workflow with document, liveness and face match.' }),
      secret('DIDIT_WEBHOOK_SECRET', 'Webhook secret', { help: 'The webhook destination’s secret_shared_key (Didit console > API & Webhooks).' }),
    ],
  },
];

/** Suppliers with a built adapter, whose groups live with the platform settings above. */
const builtSuppliers = new Set(['reloadly', 'vtpass', 'didww']);

export const integrationGroups: IntegrationGroup[] = [
  ...platformGroups.map(group => ({ ...group, section: builtSuppliers.has(group.id) ? ('suppliers' as const) : ('platform' as const), adapterReady: true })),
  ...supplierCredentialGroups.map(group => ({
    id: group.code,
    name: group.name,
    description: group.description,
    section: 'suppliers' as const,
    adapterReady: false,
    fields: group.fields.map(item => ({ key: supplierCredentialKey(group.code, item.suffix), label: item.label, secret: item.secret, kind: item.kind, required: item.required, help: item.help })),
  })),
];

export const integrationFields = new Map(integrationGroups.flatMap(group => group.fields.map(item => [item.key, item] as const)));

/** Platform settings: named after environment variables, read through `IntegrationsService.config`. */
export const isPlatformKey = (key: string): key is IntegrationKey => (integrationKeys as readonly string[]).includes(key);
