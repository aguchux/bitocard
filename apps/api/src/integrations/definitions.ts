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
  'STOREFRONT_URL',
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
  'FLUTTERWAVE_SANDBOX',
  'MONNIFY_API_KEY',
  'MONNIFY_SECRET_KEY',
  'MONNIFY_CONTRACT_CODE',
  'MONNIFY_API_URL',
  'MONNIFY_SANDBOX',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SANDBOX',
  'CHECKOUT_SANDBOX',
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
  'VTPASS_SANDBOX',
  'VTPASS_CONTACT_PHONE',
  'DIDWW_API_KEY',
  'DIDWW_API_URL',
  'DIDWW_SANDBOX',
  'DIDWW_COUNTRIES',
  'DIDWW_CALLBACK_URL',
  'DIDWW_SMS_WEBHOOK_TOKEN',
  'DIDWW_SMS_USERNAME',
  'DIDWW_SMS_PASSWORD',
  'DIDWW_SMS_URL',
  'DIDWW_SMS_MAX_PRICE_CENTS',
  'ZENDIT_API_KEY',
  'ZENDIT_API_URL',
  'ZENDIT_SANDBOX',
  'ZENDIT_WEBHOOK_SECRET',
  'PAWAPAY_API_TOKEN',
  'PAWAPAY_API_URL',
  'PAWAPAY_SANDBOX',
  'PAWAPAY_PAYOUT_FEE_PERCENT',
  'PAWAPAY_CALLBACK_TOKEN',
  'DIDIT_API_KEY',
  'DIDIT_WORKFLOW_ID',
  'DIDIT_WEBHOOK_SECRET',
  'SPACES_KEY',
  'SPACES_SECRET',
  'SPACES_BUCKET',
  'SPACES_REGION',
  'SPACES_ENDPOINT',
  'SPACES_PUBLIC_URL',
  'SPACES_ROOT',
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
      field('STOREFRONT_URL', 'Store address', { kind: 'url', help: 'BitoCard\'s store. Bundled brand logos are served from it (/brand-icons/). Default: https://bitocard.com' }),
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
      secret('TERMII_API_KEY', 'API key', { help: 'Termii dashboard > API (sign up at termii.com).' }),
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
    id: 'file_storage',
    name: 'File storage (DigitalOcean Spaces)',
    description:
      'Logos, icons and images uploaded by admins and resellers. Browsers upload straight to the bucket with links signed for 10 minutes. The bucket needs a CORS rule allowing PUT from the admin app and SHQ. Uploads are switched off until the key, secret and bucket are set; image addresses can still be typed in.',
    fields: [
      field('SPACES_KEY', 'Access key', { required: true, help: 'A Spaces access key limited to this bucket (DigitalOcean > Spaces Object Storage > Access Keys).' }),
      secret('SPACES_SECRET', 'Secret key'),
      field('SPACES_BUCKET', 'Bucket', { required: true }),
      field('SPACES_REGION', 'Region', { help: 'For example nyc3 or sfo3. Default: nyc3' }),
      field('SPACES_ENDPOINT', 'API address', { kind: 'url', help: 'Default: https://<region>.digitaloceanspaces.com' }),
      field('SPACES_PUBLIC_URL', 'Public address', { kind: 'url', help: 'The CDN endpoint or custom domain files are served from, for example https://media.bitocard.com. Default: the bucket address.' }),
      field('SPACES_ROOT', 'Top folder', { help: 'Everything is stored under this folder, so environments can share a bucket. Default: bitocard' }),
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
    description: 'Payment pages (card, bank and mobile money) for wallet top-ups and customer checkout where offered in Settings > Markets, reserved accounts, payouts, BVN checks and offered exchange rates.',
    webhookPath: '/v1/webhooks/flutterwave',
    fields: [
      secret('FLUTTERWAVE_SECRET_KEY', 'Secret key'),
      secret('FLUTTERWAVE_WEBHOOK_HASH', 'Webhook secret hash', { help: 'The secret hash set under Webhooks in the Flutterwave dashboard.' }),
      field('FLUTTERWAVE_SANDBOX', 'Sandbox', {
        kind: 'flag',
        help: 'On: test the test secret key (FLWSECK_TEST-…) with Test connection; Flutterwave is not used for live payments. Off: live.',
      }),
    ],
  },
  {
    id: 'monnify',
    name: 'Monnify',
    description: 'Nigerian payment pages (card and bank transfer) for wallet top-ups and customer checkout where offered in Settings > Markets, and reserved accounts after Flutterwave.',
    webhookPath: '/v1/webhooks/monnify',
    fields: [
      secret('MONNIFY_API_KEY', 'API key'),
      secret('MONNIFY_SECRET_KEY', 'Secret key'),
      field('MONNIFY_CONTRACT_CODE', 'Contract code', { required: true }),
      field('MONNIFY_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: Monnify’s sandbox (https://sandbox.monnify.com) with sandbox keys, for Test connection only; Monnify is not used for live payments. Off: live.' }),
      field('MONNIFY_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Card payments (Stripe Checkout) for wallet top-ups and customer checkout, in the markets where an admin offers it (Settings > Markets).',
    webhookPath: '/v1/webhooks/stripe',
    fields: [
      secret('STRIPE_SECRET_KEY', 'Secret key', { help: 'Stripe dashboard > Developers > API keys. A restricted key needs Checkout Sessions and Refunds (write) and Balance (read).' }),
      secret('STRIPE_WEBHOOK_SECRET', 'Webhook signing secret', {
        help: 'Stripe dashboard > Developers > Webhooks: add the endpoint https://api.bitocard.com/v1/webhooks/stripe with checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and checkout.session.expired, then copy its signing secret (whsec_…).',
      }),
      field('STRIPE_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: test the test secret key (sk_test_…) with Test connection; Stripe is not used for live payments. Off: live.' }),
    ],
  },
  {
    id: 'checkout',
    name: 'Customer checkout',
    description: 'Checkout on bitocard.com. The payment methods offered are set per market (Settings > Markets > Payment methods).',
    fields: [
      field('CHECKOUT_SANDBOX', 'Sandbox', {
        kind: 'flag',
        help: 'On: bitocard.com checkout runs in the sandbox, for trying it before launch: simulated payment pages, no real money, SANDBOX- codes. Off: live payments.',
      }),
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
      field('RELOADLY_CLIENT_ID', 'Client ID', { required: true, help: 'Reloadly dashboard > Developers > API settings. Test and live keys differ.' }),
      secret('RELOADLY_CLIENT_SECRET', 'Client secret'),
      field('RELOADLY_SANDBOX', 'Sandbox', {
        kind: 'flag',
        help: 'On: Reloadly’s sandbox with test credentials, for Test connection only; Reloadly is not synced or used for live orders. Off: live.',
      }),
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
      field('VTPASS_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: VTpass’s sandbox (https://sandbox.vtpass.com/api) with sandbox keys, for Test connection only; VTpass is not used for live orders. Off: live.' }),
      field('VTPASS_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
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
      field('DIDWW_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: DIDWW’s sandbox (https://sandbox-api.didww.com/v3) with a sandbox key, for Test connection only; DIDWW is not synced or used for live orders. Off: live.' }),
      field('DIDWW_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
      field('DIDWW_COUNTRIES', 'Number countries', { help: 'ISO codes of the countries whose numbers are synced, separated by commas, for example GB,US.' }),
      field('DIDWW_CALLBACK_URL', 'API public address', { kind: 'url', help: 'Order callbacks go to this address plus /v1/webhooks/didww. Default: https://api.bitocard.com' }),
      secret('DIDWW_SMS_WEBHOOK_TOKEN', 'Incoming SMS token', {
        required: false,
        help: 'At least 16 characters. In DIDWW’s panel, create an HTTP IN SMS trunk posting JSON to <API public address>/v1/webhooks/didww-sms?token=<this token> (body in the API guide), and assign it to each number.',
      }),
      field('DIDWW_SMS_USERNAME', 'Outgoing SMS username', { help: 'DIDWW panel > SMS trunks > your HTTP OUT trunk. Its callback address: <API public address>/v1/webhooks/didww-sms-status?token=<Incoming SMS token>.' }),
      secret('DIDWW_SMS_PASSWORD', 'Outgoing SMS password', { required: false, help: 'The HTTP OUT trunk’s password.' }),
      field('DIDWW_SMS_URL', 'Outgoing SMS address', { kind: 'url', help: 'Default: https://sms-out.didww.com' }),
      field('DIDWW_SMS_MAX_PRICE_CENTS', 'Most an SMS part may cost (US cents)', { kind: 'number', help: 'Held from the wallet before each SMS is sent; the real price is charged once DIDWW reports it. Default: 10.' }),
    ],
  },
  {
    id: 'zendit',
    name: 'Zendit',
    description: 'Gift cards worldwide, and mobile airtime, bundles and data by country. Without an API key it serves only the sandbox, never live orders.',
    webhookPath: '/v1/webhooks/zendit',
    fields: [
      secret('ZENDIT_API_KEY', 'API key', { help: 'Zendit console > Developers > API settings. Test mode and production keys differ.' }),
      field('ZENDIT_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: Zendit’s test mode (https://test-api.zendit.io/v1) with the test key, for Test connection only; Zendit is not synced or used for live orders. Off: live.' }),
      field('ZENDIT_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
      secret('ZENDIT_WEBHOOK_SECRET', 'Webhook secret', {
        required: false,
        help: 'Choose a long random value. In the Zendit console webhook settings, add the header X-Webhook-Token with this secret as its value. Without it, notifications are refused and orders are still checked on schedule.',
      }),
    ],
  },
  {
    id: 'pawapay',
    name: 'pawaPay',
    description:
      'Mobile money top-ups: sends money to customers’ mobile money wallets in every country and provider enabled for payouts on the pawaPay account. Also takes mobile money payments (its payment page) for wallet top-ups and customer checkout where offered in Settings > Markets. Without a token it serves only the sandbox, never live orders.',
    webhookPath: '/v1/webhooks/pawapay?token=<callback token>',
    fields: [
      secret('PAWAPAY_API_TOKEN', 'API token', { help: 'pawaPay dashboard > System configuration > API tokens. Sandbox and production tokens differ.' }),
      field('PAWAPAY_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: pawaPay’s sandbox (https://api.sandbox.pawapay.io) with the sandbox token, for Test connection only; pawaPay is not synced or used for live orders. Off: live.' }),
      field('PAWAPAY_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
      field('PAWAPAY_PAYOUT_FEE_PERCENT', 'Payout fee (%)', {
        required: true,
        help: 'The payout fee in your pawaPay agreement, for example 1.5. BitoCard’s cost is the amount sent plus this fee, so prices never fall below it. Syncing refuses until it is set.',
      }),
      secret('PAWAPAY_CALLBACK_TOKEN', 'Callback token', {
        required: false,
        help: 'Choose a long random value. In the pawaPay dashboard (System configuration > Callback URLs), set the payout callback to https://api.bitocard.com/v1/webhooks/pawapay?token= followed by this value, and the deposit callback to https://api.bitocard.com/v1/webhooks/pawapay-deposits?token= followed by the same value. Without it, callbacks are refused and payouts and payments are still checked on schedule.',
      }),
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
const builtSuppliers = new Set(['reloadly', 'vtpass', 'didww', 'zendit', 'pawapay']);

export const integrationGroups: IntegrationGroup[] = [
  ...platformGroups.map(group => ({ ...group, section: builtSuppliers.has(group.id) ? ('suppliers' as const) : ('platform' as const), adapterReady: true })),
  ...supplierCredentialGroups.map(group => ({
    id: group.code,
    name: group.name,
    description: group.description,
    section: 'suppliers' as const,
    adapterReady: false,
    fields: [
      ...group.fields.map(item => ({ key: supplierCredentialKey(group.code, item.suffix), label: item.label, secret: item.secret, kind: item.kind, required: item.required, help: item.help })),
      {
        key: supplierCredentialKey(group.code, 'SANDBOX'),
        label: 'Sandbox',
        secret: false,
        kind: 'flag' as const,
        required: false,
        help: `On: the credentials saved are ${group.name}’s sandbox ones. Kept for when BitoCard’s adapter is built, which will then use the sandbox address.`,
      },
    ],
  })),
];

export const integrationFields = new Map(integrationGroups.flatMap(group => group.fields.map(item => [item.key, item] as const)));

/** Platform settings: named after environment variables, read through `IntegrationsService.config`. */
export const isPlatformKey = (key: string): key is IntegrationKey => (integrationKeys as readonly string[]).includes(key);
