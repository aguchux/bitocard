import type { AppConfig } from '../config/config.js';
import type { Platform } from '../generated/prisma/client.js';
import type { Product } from '../products/product.js';
import { chainProviders, walletKeyFields } from '../crypto/chains/providers.js';
import { screeners } from '../crypto/custody/screening.js';
import { signerFields } from '../crypto/custody/signer.js';
import { priceFields } from '../crypto/price-feed.js';
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
  /** The environment variable it replaces (platform settings), or the supplier credential's name (`NEXWAY_SECRET_KEY`). */
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
  /** Platform services, suppliers from the registry, or blockchain providers and BitoCard's wallet keys. */
  section: 'platform' | 'suppliers' | 'blockchain';
  /** False while the supplier's adapter is a stub: its credentials are stored for later and nothing uses them yet. */
  adapterReady: boolean;
  /**
   * The products that use it, each with its own values, set in its own admin (docs/CRYPTO_SPINOFF_PLAN.md, step 2
   * item 8): BitoCard's alone (payments, suppliers, domains, its store addresses and links), Afrippa's alone (every
   * crypto setting), or both (email, SMS, Google, AI, files, push, GitHub), never sharing a value.
   */
  platforms: Platform[];
};

const integrationKeyList = [
  'DASHBOARD_URL',
  'PAYMENT_RETURN_URL',
  'STOREFRONT_URL',
  'VERIFY_URL',
  'SHOP_URL',
  'AFRIPPA_URL',
  'AFRIPPA_VERIFY_URL',
  'ALERT_EMAIL',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'MAILERSEND_API_KEY',
  'TERMII_API_KEY',
  'TERMII_API_URL',
  'TERMII_SENDER_ID',
  'AFRICASTALKING_USERNAME',
  'AFRICASTALKING_API_KEY',
  'AFRICASTALKING_SENDER_ID',
  'AFRICASTALKING_API_URL',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'FACEBOOK_REDIRECT_URI',
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
  'STRIPE_TAX_CODE',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_SANDBOX',
  'CHECKOUT_SANDBOX',
  'PAYMENT_TIMEOUT_MINUTES',
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
  'VTPASS_COMMISSIONS',
  'ZENDIT_API_KEY',
  'ZENDIT_API_URL',
  'ZENDIT_SANDBOX',
  'ZENDIT_WEBHOOK_SECRET',
  'PAWAPAY_API_TOKEN',
  'PAWAPAY_API_URL',
  'PAWAPAY_SANDBOX',
  'PAWAPAY_PAYOUT_FEE_PERCENT',
  'PAWAPAY_CALLBACK_TOKEN',
  'VERCEL_API_TOKEN',
  'VERCEL_TEAM_ID',
  'VERCEL_STOREFRONT_PROJECT',
  'VERCEL_API_URL',
  'DOMAIN_MARGIN_PERCENT',
  'DOMAIN_TLDS',
  'DOMAIN_DNS_LOOKUP_URL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_API_URL',
  'STORE_HOST_TARGET',
  'AFRICAS_TALKING_USERNAME',
  'AFRICAS_TALKING_API_KEY',
  'AFRICAS_TALKING_SANDBOX',
  'AFRICAS_TALKING_API_URL',
  'AFRICAS_TALKING_DATA_URL',
  'AFRICAS_TALKING_AIRTIME_DISCOUNT_PERCENT',
  'AFRICAS_TALKING_AIRTIME_COUNTRIES',
  'AFRICAS_TALKING_DATA_PRODUCT',
  'AFRICAS_TALKING_DATA_PLANS',
  'AFRICAS_TALKING_CALLBACK_TOKEN',
  'REMITA_SECRET_KEY',
  'REMITA_SANDBOX',
  'REMITA_API_URL',
  'REMITA_CONTACT_PHONE',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_API_URL',
  'ANTHROPIC_PRICES',
  'OPENAI_API_KEY',
  'OPENAI_API_URL',
  'OPENAI_PRICES',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_API_URL',
  'DEEPSEEK_PRICES',
  'AI_BITOCARD_MODELS',
  'AI_MONTHLY_REPLIES',
  'GITHUB_REPO',
  'GITHUB_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_API_URL',
  'CLOUDFLARE_TURN_KEY_ID',
  'CLOUDFLARE_TURN_API_TOKEN',
  'CLOUDFLARE_TURN_API_URL',
  'APP_IOS_MIN_VERSION',
  'APP_IOS_LATEST_VERSION',
  'APP_IOS_STORE_URL',
  'APP_ANDROID_MIN_VERSION',
  'APP_ANDROID_LATEST_VERSION',
  'APP_ANDROID_STORE_URL',
  'GOOGLE_APP_CLIENT_IDS',
  'APPLE_BUNDLE_IDS',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'APPLE_AUTH_URL',
  'FCM_SERVICE_ACCOUNT',
  'FCM_API_URL',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_PRIVATE_KEY',
  'APNS_TOPIC',
  'APNS_SANDBOX',
  'APNS_API_URL',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_NUMBER',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_API_URL',
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
  'KYC_SPACES_KEY',
  'KYC_SPACES_SECRET',
  'KYC_SPACES_BUCKET',
  'KYC_SPACES_REGION',
  'KYC_SPACES_ENDPOINT',
  'KYC_SPACES_ROOT',
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

const platformGroups: Array<Omit<IntegrationGroup, 'section' | 'adapterReady' | 'platforms'>> = [
  {
    id: 'general',
    name: 'Links and alerts',
    description: 'Where emails and payment pages send people back to, and where operational alerts go.',
    fields: [
      field('DASHBOARD_URL', 'Reseller dashboard address', { kind: 'url', help: 'Links in emails point here.' }),
      field('STOREFRONT_URL', 'Store address', { kind: 'url', help: 'BitoCard\'s store. Bundled brand logos are served from it (/brand-icons/). Default: https://bitocard.com' }),
      field('VERIFY_URL', 'BitoCard Verify address', { kind: 'url', help: 'Where people complete identity checks in Verify countries. Default: https://verify.bitocard.com' }),
      field('SHOP_URL', 'BitoCard Shop address', { kind: 'url', help: 'The classifieds marketplace. Customers signed in on bitocard.com are signed in there with one click. Default: https://shop.bitocard.com' }),
      field('AFRIPPA_URL', 'Afrippa address', { kind: 'url', help: 'Afrippa, the P2P crypto market that left BitoCard: where its emails and links point. Default: https://afrippa.com' }),
      field('AFRIPPA_VERIFY_URL', 'Afrippa identity checks address', { kind: 'url', help: 'Where Afrippa’s traders complete their identity checks (Verify in Afrippa’s name). Default: https://verify.afrippa.com' }),
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
    name: 'SMS verification (Termii)',
    description: 'Select Termii for a country in Markets after connecting this integration.',
    fields: [
      secret('TERMII_API_KEY', 'API key', { help: 'Termii dashboard > API (sign up at termii.com).' }),
      field('TERMII_API_URL', 'API address', { kind: 'url', help: 'Account-specific; shown in the Termii dashboard.' }),
      field('TERMII_SENDER_ID', 'Sender ID'),
    ],
  },
  {
    id: 'sms_africas_talking',
    name: 'SMS verification (Africa’s Talking)',
    description: 'Select Africa’s Talking for a country in Markets after connecting this integration.',
    fields: [
      field('AFRICASTALKING_USERNAME', 'Username', { required: true, help: 'Your app’s username in the Africa’s Talking dashboard (sandbox for its test account).' }),
      secret('AFRICASTALKING_API_KEY', 'API key'),
      field('AFRICASTALKING_SENDER_ID', 'Sender ID', { required: false, help: 'An approved alphanumeric sender ID or short code; leave empty for the shared one.' }),
      field('AFRICASTALKING_API_URL', 'API address', { kind: 'url', required: false, help: 'Leave empty: the live address, or the sandbox one for the username sandbox.' }),
    ],
  },
  {
    id: 'web_push',
    name: 'Browser push',
    description:
      'Push notifications to the browsers people turn them on in (SHQ and the admin app). Switched off until both keys are set; generate a pair with npm run push:keys -w @udozo/api. Changing the keys stops pushes to every registered browser until it is turned on again.',
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
    id: 'kyc_storage',
    name: 'Private files (DigitalOcean Spaces)',
    description:
      'BitoCard Verify’s ID photos, selfies, liveness frames and business documents, and the photos and PDFs people send in support chats. Use a private bucket of its own (never the public media bucket), in the US with the database. Files are encrypted by the API before they are stored and only ever read back through the API. Verify and chat cannot take files until the key, secret and bucket are set.',
    fields: [
      field('KYC_SPACES_KEY', 'Access key', { required: true, help: 'A Spaces access key limited to this private bucket (DigitalOcean > Spaces Object Storage > Access Keys).' }),
      secret('KYC_SPACES_SECRET', 'Secret key'),
      field('KYC_SPACES_BUCKET', 'Bucket', { required: true, help: 'A private bucket used for nothing else: no public files, no CDN, no CORS rule.' }),
      field('KYC_SPACES_REGION', 'Region', { help: 'Default: nyc3 (keep it in the US with the database).' }),
      field('KYC_SPACES_ENDPOINT', 'API address', { kind: 'url', help: 'Default: https://<region>.digitaloceanspaces.com' }),
      field('KYC_SPACES_ROOT', 'Top folder', { help: 'Default: bitocard' }),
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
      field('GOOGLE_APP_CLIENT_IDS', 'App client IDs', { help: 'Udozo’s app: its Android and iOS OAuth client IDs, separated by commas. Native sign-in accepts tokens for them and for the client ID above.' }),
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook sign-in',
    description:
      'Continue with Facebook for udozo.com’s customers and Seller HQ (never admins). Switched off until the app ID and secret are set. In the Meta app, add Facebook Login with the valid OAuth redirect addresses https://api.udozo.com/v1/auth/facebook/callback (Seller HQ) and https://udozo.com/auth/facebook/callback (udozo.com), asking only for email and public_profile.',
    fields: [
      field('FACEBOOK_APP_ID', 'App ID', { required: true, help: 'Meta for Developers > your app > App settings > Basic.' }),
      secret('FACEBOOK_APP_SECRET', 'App secret', { help: 'On the same page: App secret, Show.' }),
      field('FACEBOOK_REDIRECT_URI', 'Seller HQ redirect URI', { kind: 'url', help: 'Must be one of Facebook Login’s valid OAuth redirect URIs: https://api.udozo.com/v1/auth/facebook/callback' }),
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
      field('STRIPE_TAX_CODE', 'Default product tax code', {
        help: 'Rarely needed: BitoCard opts every payment out of Stripe Managed Payments, which otherwise refuses payments without a tax code. Software checkouts always send txcd_10202000 (downloadable software). This code is sent for everything else: wallet top-ups, gift cards, airtime and other products. Managed Payments only takes digital products (software, games, digital media, online services), so for those other payments the right fix is to turn Managed Payments off in Stripe, not to give them a digital-services code. Leave empty to send none.',
      }),
    ],
  },
  {
    id: 'paystack',
    name: 'Paystack',
    description: 'Payment pages (card, bank transfer, USSD and mobile money where local) for wallet top-ups and customer checkout in Nigeria, Ghana, Kenya and South Africa, where an admin offers it (Settings > Markets). A Paystack account takes its own country’s currency: offer it only in that market.',
    webhookPath: '/v1/webhooks/paystack',
    fields: [
      secret('PAYSTACK_SECRET_KEY', 'Secret key', {
        help: 'Paystack dashboard > Settings > API Keys & Webhooks. Also set the Live Webhook URL there to https://api.bitocard.com/v1/webhooks/paystack: Paystack signs its notifications with this key.',
      }),
      field('PAYSTACK_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: test the test secret key (sk_test_…) with Test connection; Paystack is not used for live payments. Off: live.' }),
    ],
  },
  {
    id: 'checkout',
    name: 'Customer checkout',
    description: 'Checkout on bitocard.com, and how long any payment page (customers’ and resellers’ top-ups and checkouts) may stay unpaid. The payment methods offered are set per market (Settings > Markets > Payment methods).',
    fields: [
      field('CHECKOUT_SANDBOX', 'Sandbox', {
        kind: 'flag',
        help: 'On: bitocard.com checkout runs in the sandbox, for trying it before launch: simulated payment pages, no real money, SANDBOX- codes. Off: live payments.',
      }),
      field('PAYMENT_TIMEOUT_MINUTES', 'Unpaid payment timeout (minutes)', {
        kind: 'number',
        help: 'A wallet top-up or checkout not paid within this time is closed as not completed, and its waiting notice goes away. 10 to 1440 (a day, the default). Stripe’s payment page expires with it (at least 30 minutes, Stripe’s minimum). Money paid after it closes is refunded, never credited, so allow time for bank transfers and USSD.',
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
    description: 'Nigerian pay-TV, electricity, airtime and data, paid from BitoCard’s VTpass wallet in naira. Without credentials it serves only the sandbox, never live orders.',
    fields: [
      secret('VTPASS_API_KEY', 'API key'),
      secret('VTPASS_PUBLIC_KEY', 'Public key'),
      secret('VTPASS_SECRET_KEY', 'Secret key'),
      field('VTPASS_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: VTpass’s sandbox (https://sandbox.vtpass.com/api) with sandbox keys, for Test connection only; VTpass is not used for live orders. Off: live.' }),
      field('VTPASS_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch. Set only to use another address.' }),
      field('VTPASS_CONTACT_PHONE', 'Fallback phone number', { help: 'VTpass needs a phone number on every payment; used when the customer gave none.' }),
      field('VTPASS_COMMISSIONS', 'Airtime and data commissions (%)', {
        required: false,
        help: 'The commission on your VTpass account per service (VTpass dashboard > Commissions), one per line or separated by semicolons: mtn 3; airtel 3.4; glo 4; etisalat 4; mtn-data 3; airtel-data 3; glo-data 4; glo-sme-data 4; etisalat-data 4 (etisalat is 9mobile). BitoCard’s cost is the amount less it; what each sale reports is kept for reconciliation. Services without one are not synced; syncing airtime and data refuses until one is set.',
      }),
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
    id: 'africas_talking',
    name: 'Africa’s Talking',
    description:
      'Mobile airtime (any amount, every network in its countries) and data bundles (the plans set below), paid from BitoCard’s Africa’s Talking wallet. Without the username and API key it serves only the sandbox, never live orders.',
    webhookPath: '/v1/webhooks/africas-talking?token=<callback token>',
    fields: [
      field('AFRICAS_TALKING_USERNAME', 'Username', { required: true, help: 'Your app’s username (Africa’s Talking dashboard > your team > the app). Its sandbox app’s username is always sandbox.' }),
      secret('AFRICAS_TALKING_API_KEY', 'API key', { help: 'The app’s Settings > API Key. Sandbox and live apps have different keys.' }),
      field('AFRICAS_TALKING_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: Africa’s Talking’s sandbox (api.sandbox.africastalking.com, username sandbox), for Test connection only; it is not synced or used for live orders. Off: live.' }),
      field('AFRICAS_TALKING_AIRTIME_DISCOUNT_PERCENT', 'Airtime discounts (%)', {
        required: true,
        help: 'The airtime discounts on your Africa’s Talking pricing schedule, one per line or separated by semicolons: a network in a country (NG mtn 1.8; NG airtel 2; NG glo 3; NG t2 3), a whole country (KE 4) or one number for everything else (3). The most specific wins and a network with none is not synced. The schedule raises the rates with monthly volume: set the tier your account is on and change them when it moves up. BitoCard’s cost is the amount less the discount; the discount each send reports is kept for reconciliation, so a different one is flagged. Syncing airtime refuses until one is set.',
      }),
      field('AFRICAS_TALKING_AIRTIME_COUNTRIES', 'Airtime countries', {
        required: false,
        help: 'Leave empty for the countries Africa’s Talking lists airtime as live in (KE, UG, TZ, NG, GH, ZA; every one is stocked whichever market is synced, each country’s only for its own resellers and customers, never cross-border). Otherwise one per line or separated by semicolons: country, currency, smallest-largest amount, networks, for example KE KES 10-10000 safaricom,airtel,telkom.',
      }),
      field('AFRICAS_TALKING_DATA_PRODUCT', 'Mobile Data product', { required: false, help: 'The product name created in the dashboard (Mobile Data > Products). Data bundles are synced only once it is set.' }),
      field('AFRICAS_TALKING_DATA_PLANS', 'Data plans', {
        required: false,
        help: 'Africa’s Talking publishes no plan list. One per line or separated by semicolons: country, network, size, validity (Day, Week, BiWeek, Month or Quarterly), the price customers know it by, BitoCard’s cost, for example KE safaricom 1GB Month 299 250.',
      }),
      field('AFRICAS_TALKING_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch.' }),
      field('AFRICAS_TALKING_DATA_URL', 'Mobile Data address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch.' }),
      secret('AFRICAS_TALKING_CALLBACK_TOKEN', 'Callback token', {
        required: false,
        help: 'Choose a long random value. In the dashboard set the airtime status callback (Airtime > Callback URLs) and the Mobile Data status callback to https://api.bitocard.com/v1/webhooks/africas-talking?token= followed by this value. Without it, callbacks are refused and orders are still checked on schedule.',
      }),
    ],
  },
  {
    id: 'remita',
    name: 'Remita',
    description:
      'Remita Vending Bills: electricity tokens, cable TV, airtime, data and internet subscriptions, paid from BitoCard’s Remita balance, with meter, smartcard and account checks. Without the secret key it serves only the sandbox, never live orders. Remita sends no order updates: orders are checked on schedule.',
    fields: [
      secret('REMITA_SECRET_KEY', 'Secret key', { help: 'RemitaConnect (connect.remita.net) > API keys: the Secret Key. Test and production keys differ; production also needs Vending subscribed and approved, and BitoCard’s server IP addresses whitelisted by Remita.' }),
      field('REMITA_SANDBOX', 'Sandbox', { kind: 'flag', help: 'On: Remita’s demo gateway (api-demo.systemspecsng.com) with the test key, for Test connection only; Remita is not synced or used for live orders. Off: live (api-gateway.remita.net).' }),
      field('REMITA_CONTACT_PHONE', 'Contact phone', { required: false, help: 'Sent with electricity and TV payments when the customer gave no phone number, for example 08011111111.' }),
      field('REMITA_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default: the address follows the Sandbox switch.' }),
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Claude models for support bots that run on BitoCard’s keys (stores on Premium). Stores using their own Anthropic key never use this one. Test connection lists the models the key can use.',
    fields: [
      secret('ANTHROPIC_API_KEY', 'API key', { help: 'Anthropic Console > Settings > API keys.' }),
      field('ANTHROPIC_PRICES', 'Prices', { required: false, help: 'For usage costs: one model per line or separated by semicolons, with its input, output and cached-input price in US dollars per million tokens, for example claude-haiku-5-5 1 5 0.1. Without a price, usage is counted but costs show as 0.' }),
      field('ANTHROPIC_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default (https://api.anthropic.com).' }),
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI models for support bots that run on BitoCard’s keys (stores on Premium). Stores using their own OpenAI key never use this one. Test connection lists the models the key can use.',
    fields: [
      secret('OPENAI_API_KEY', 'API key', { help: 'OpenAI Platform > API keys (a project key).' }),
      field('OPENAI_PRICES', 'Prices', { required: false, help: 'For usage costs: model, input, output and cached-input price in US dollars per million tokens, one per line or separated by semicolons.' }),
      field('OPENAI_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default (https://api.openai.com).' }),
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek models for support bots that run on BitoCard’s keys (stores on Premium). DeepSeek processes data in China: take advice before offering it on BitoCard’s keys. Test connection lists the models the key can use.',
    fields: [
      secret('DEEPSEEK_API_KEY', 'API key', { help: 'DeepSeek Platform > API keys.' }),
      field('DEEPSEEK_PRICES', 'Prices', { required: false, help: 'For usage costs: model, input, output and cached-input price in US dollars per million tokens, one per line or separated by semicolons.' }),
      field('DEEPSEEK_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default (https://api.deepseek.com).' }),
    ],
  },
  {
    id: 'support_ai',
    name: 'Support assistant',
    description: 'How support bots run on BitoCard’s keys: the models stores on Premium may choose, and how many bot replies each store gets a month. Past the allowance, chats go to people until the month resets or the store adds its own key.',
    fields: [
      field('AI_BITOCARD_MODELS', 'Models on BitoCard’s keys', { help: 'provider:model, separated by commas, for example anthropic:claude-haiku-5-5, openai:gpt-5-mini, deepseek:deepseek-chat. Cheaper models keep the allowance affordable.' }),
      field('AI_MONTHLY_REPLIES', 'Bot replies a month per store', { kind: 'number', help: 'The Premium allowance on BitoCard’s keys. Default: 2000. Stores on their own keys have no BitoCard limit.' }),
    ],
  },
  {
    id: 'github',
    name: 'Engineering (GitHub)',
    description: 'Where support tickets escalated to engineering become issues, with no personal data. When an issue is closed, its ticket comes back to BitoCard to confirm the fix. Test connection reads the repository.',
    webhookPath: '/v1/webhooks/github',
    fields: [
      field('GITHUB_REPO', 'Repository', { required: true, help: 'owner/name, for example golojan/bitocard.' }),
      secret('GITHUB_TOKEN', 'Access token', { help: 'GitHub > Settings > Developer settings > Fine-grained tokens: only this repository, Issues read and write.' }),
      secret('GITHUB_WEBHOOK_SECRET', 'Webhook secret', { required: false, help: 'In the repository: Settings > Webhooks > Add webhook, payload URL https://api.bitocard.com/v1/webhooks/github, content type application/json, this secret, the Issues event. Without it, closed issues are not reported back.' }),
      field('GITHUB_API_URL', 'API address override', { kind: 'url', help: 'Leave as the default (https://api.github.com).' }),
    ],
  },
  {
    id: 'domains',
    name: 'Domains (Vercel)',
    description:
      'Resellers buy .com domains for their stores (Vercel’s registrar, paid from their wallet at Vercel’s price plus the margin below) or connect domains they own; the storefront serves each store on its domain with HTTPS, and domains on Vercel’s DNS are edited in SHQ. Also switch on Custom domains in Feature switches.',
    fields: [
      secret('VERCEL_API_TOKEN', 'API token', { help: 'Vercel > Account settings > Tokens: a token scoped to the team that owns the storefront project. It buys and renews domains on the team’s card.' }),
      field('VERCEL_TEAM_ID', 'Team ID', { required: false, help: 'Vercel > Team settings > General: the Team ID (team_…). Leave empty for a personal account.' }),
      field('VERCEL_STOREFRONT_PROJECT', 'Storefront project', { required: true, help: 'The storefront’s Vercel project ID (prj_…) or name: reseller domains are added to it.' }),
      field('DOMAIN_MARGIN_PERCENT', 'Margin (%)', {
        required: true,
        help: 'BitoCard’s margin on domain registrations and renewals, in percent of Vercel’s price, for example 20 (0 for none). Shown to resellers in the price. Until it is set, domains can only be connected, not bought.',
      }),
      field('DOMAIN_TLDS', 'Endings sold', { required: false, help: 'Comma separated, for example com. Vercel cannot register country endings such as .ng or .co.uk (resellers can still connect those).' }),
      field('VERCEL_API_URL', 'API address', { kind: 'url', required: false, help: 'Default: https://api.vercel.com' }),
      field('DOMAIN_DNS_LOOKUP_URL', 'DNS lookup address', { kind: 'url', required: false, help: 'DNS over HTTPS (JSON) used to read a domain’s records before its nameservers move. Default: https://cloudflare-dns.com/dns-query' }),
    ],
  },
  {
    id: 'store_hosts',
    name: 'Store addresses (Cloudflare)',
    description:
      'Each reseller store’s address, <subdomain>.bitocard.com (<subdomain>.udozo.com on Udozo), set up when it is created or renamed: a DNS-only CNAME in the site’s Cloudflare zone pointing to Vercel, and the address on the storefront project (with the Vercel settings in Domains), which issues its HTTPS. Stores waiting for these settings are set up by the domains job.',
    fields: [
      secret('CLOUDFLARE_API_TOKEN', 'API token', { help: 'Cloudflare > My Profile > API Tokens > Create Token, “Edit zone DNS” template, limited to the bitocard.com zone (udozo.com on Udozo) (Zone: DNS: Edit, and Zone: Zone: Read).' }),
      field('CLOUDFLARE_ZONE_ID', 'Zone ID', { required: true, help: 'Cloudflare > bitocard.com (udozo.com on Udozo) > Overview, API section: the Zone ID.' }),
      field('STORE_HOST_TARGET', 'Record target', { required: false, help: 'Where each store’s CNAME points. Default: cname.vercel-dns.com' }),
      field('CLOUDFLARE_API_URL', 'API address', { kind: 'url', required: false, help: 'Default: https://api.cloudflare.com/client/v4' }),
    ],
  },
  {
    id: 'calls',
    name: 'Calls (Cloudflare TURN)',
    description:
      'Browser calls between buyers and sellers on udozo.com, relayed through Cloudflare’s TURN service so neither side ever sees the other’s phone number or internet address. Calls are not recorded. Call seller is offered only once the key and token are set. Test connection makes a short-lived credential.',
    fields: [
      field('CLOUDFLARE_TURN_KEY_ID', 'TURN key ID', { required: true, help: 'Cloudflare dashboard > Realtime > TURN Server > Create TURN key: its Turn Token ID.' }),
      secret('CLOUDFLARE_TURN_API_TOKEN', 'TURN key API token', { help: 'Shown once when the TURN key is created (the key’s API token, not an account API token).' }),
      field('CLOUDFLARE_TURN_API_URL', 'API address', { kind: 'url', required: false, help: 'Default: https://rtc.live.cloudflare.com' }),
    ],
  },
  {
    id: 'mobile_app',
    name: 'Mobile app',
    description:
      'Udozo’s iPhone and Android app asks GET /v1/app/config when it opens. Below the lowest version it shows Update the app and nothing else; below the newest it offers the update. Leave a version empty to ask nobody. The store pages are where Update opens.',
    fields: [
      field('APP_IOS_MIN_VERSION', 'iPhone: lowest version allowed', { required: false, help: 'Three numbers, for example 1.0.0. Raise it only when older apps can no longer work, as everyone below it is stopped.' }),
      field('APP_IOS_LATEST_VERSION', 'iPhone: newest version', { required: false, help: 'The version live on the App Store. Older apps offer the update without stopping.' }),
      field('APP_IOS_STORE_URL', 'App Store page', { kind: 'url', required: false, help: 'App Store Connect > your app > App Information: the App Store link.' }),
      field('APP_ANDROID_MIN_VERSION', 'Android: lowest version allowed', { required: false, help: 'Three numbers, for example 1.0.0.' }),
      field('APP_ANDROID_LATEST_VERSION', 'Android: newest version', { required: false, help: 'The version live on Google Play.' }),
      field('APP_ANDROID_STORE_URL', 'Google Play page', { kind: 'url', required: false, help: 'https://play.google.com/store/apps/details?id= and the app’s package name.' }),
    ],
  },
  {
    id: 'apple_sign_in',
    name: 'Sign in with Apple',
    description:
      'Sign in with Apple in Udozo’s iPhone app (App Store rules require it beside Google and Facebook). The app sends Apple’s identity token; the API checks it with Apple’s published keys. The team, key and private key let the API revoke the app’s access when someone deletes their account, as Apple requires.',
    fields: [
      field('APPLE_BUNDLE_IDS', 'Bundle IDs', { required: true, help: 'The app’s bundle ID, for example com.udozo.app (several separated by commas).' }),
      field('APPLE_TEAM_ID', 'Team ID', { help: 'Apple Developer > Membership details: ten letters and digits.' }),
      field('APPLE_KEY_ID', 'Key ID', { help: 'Certificates, Identifiers and Profiles > Keys: a key with Sign in with Apple enabled.' }),
      secret('APPLE_PRIVATE_KEY', 'Private key (.p8)', { required: false, help: 'The whole file, from -----BEGIN PRIVATE KEY----- to the end.' }),
      field('APPLE_AUTH_URL', 'Apple’s address', { kind: 'url', help: 'Default: https://appleid.apple.com' }),
    ],
  },
  {
    id: 'phone_push',
    name: 'Phone push (FCM and APNs)',
    description:
      'Notifications and incoming calls on Udozo’s app: Firebase Cloud Messaging for Android and Apple Push Notification service for iPhones. Each is switched off until its keys are set. Calls ring a closed app through these too (VoIP pushes on iPhones).',
    fields: [
      secret('FCM_SERVICE_ACCOUNT', 'Firebase service account (JSON)', {
        required: false,
        help: 'Firebase console > Project settings > Service accounts > Generate new private key: paste the whole JSON file.',
      }),
      field('FCM_API_URL', 'FCM address', { kind: 'url', help: 'Default: https://fcm.googleapis.com' }),
      field('APNS_KEY_ID', 'APNs key ID', { help: 'Certificates, Identifiers and Profiles > Keys: a key with Apple Push Notifications service enabled.' }),
      field('APNS_TEAM_ID', 'Team ID', { help: 'Apple Developer > Membership details.' }),
      secret('APNS_PRIVATE_KEY', 'APNs private key (.p8)', { required: false, help: 'The whole file, from -----BEGIN PRIVATE KEY----- to the end.' }),
      field('APNS_TOPIC', 'Bundle ID', { help: 'The app’s bundle ID, for example com.udozo.app.' }),
      field('APNS_SANDBOX', 'Development builds', { kind: 'flag', help: 'On: APNs’ development service (builds made for development). Off: production (TestFlight and the App Store).' }),
      field('APNS_API_URL', 'APNs address', { kind: 'url', help: 'Leave empty: chosen by Development builds.' }),
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp (Meta Cloud API)',
    description:
      'Udozo on WhatsApp: buyers and sellers find listings, chat (relayed through Udozo’s number, so neither sees the other’s), post ads and make requests from WhatsApp, and get notices there. Needs the whatsapp_channel switch on for the market. Test connection reads the number’s name and quality rating.',
    webhookPath: '/v1/webhooks/whatsapp',
    fields: [
      field('WHATSAPP_PHONE_NUMBER_ID', 'Phone number ID', { required: true, help: 'Meta for Developers > your app > WhatsApp > API Setup: the Phone number ID (not the number itself).' }),
      field('WHATSAPP_BUSINESS_ACCOUNT_ID', 'WhatsApp Business account ID', { required: true, help: 'The same page: the WhatsApp Business Account ID, used to list and submit message templates.' }),
      field('WHATSAPP_NUMBER', 'Udozo’s WhatsApp number', { required: true, help: 'The number itself in international form, for example +2348012345678: shown on udozo.com and used in wa.me links.' }),
      secret('WHATSAPP_ACCESS_TOKEN', 'System user access token', { help: 'Business settings > Users > System users: a permanent token with whatsapp_business_messaging and whatsapp_business_management.' }),
      secret('WHATSAPP_APP_SECRET', 'App secret', { help: 'Meta for Developers > your app > App settings > Basic: the App secret. Checks every webhook’s X-Hub-Signature-256.' }),
      secret('WHATSAPP_VERIFY_TOKEN', 'Webhook verify token', { help: 'Any long random text: type the same in the app’s WhatsApp > Configuration > Webhook, then subscribe to messages.' }),
      field('WHATSAPP_API_URL', 'Graph API address', { kind: 'url', required: false, help: 'Default: https://graph.facebook.com/v23.0' }),
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
const builtSuppliers = new Set(['reloadly', 'vtpass', 'zendit', 'pawapay', 'africas_talking', 'remita']);
/** Credential groups whose adapter transport is implemented. They stay unavailable until their Supplier row and markets are enabled. */
const builtCredentialSuppliers = new Set(['vpnresellers']);

const groupsWithoutPlatforms: Array<Omit<IntegrationGroup, 'platforms'>> = [
  ...platformGroups.map(group => ({ ...group, section: builtSuppliers.has(group.id) ? ('suppliers' as const) : ('platform' as const), adapterReady: true })),
  ...supplierCredentialGroups.map(group => ({
    id: group.code,
    name: group.name,
    description: group.description,
    section: 'suppliers' as const,
    adapterReady: builtCredentialSuppliers.has(group.code),
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
  {
    id: 'crypto_keys',
    name: 'Wallet keys',
    description:
      'BitoCard’s account public keys (xpubs) for crypto deposits: each customer’s own deposit address is derived from them. Public keys only: they make addresses but can never spend. The private keys stay in the key vault.',
    section: 'blockchain' as const,
    adapterReady: true,
    fields: walletKeyFields,
  },
  ...chainProviders.map(provider => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    section: 'blockchain' as const,
    adapterReady: true,
    webhookPath: provider.verify ? `/v1/afrippa/webhooks/chain/${provider.id}?chain=<CHAIN>` : undefined,
    fields: provider.fields,
  })),
  {
    id: 'crypto_signer',
    name: 'Crypto signer',
    description:
      'BitoCard’s signer service, the only thing that can send customers’ crypto: it runs off Vercel in front of the key vault and sends each withdrawal the API asks for, once. The API never holds a private key.',
    section: 'blockchain' as const,
    adapterReady: true,
    fields: signerFields,
  },
  ...screeners.map(item => ({ id: item.id, name: item.name, description: item.description, section: 'blockchain' as const, adapterReady: true, fields: item.fields })),
  {
    id: 'crypto_prices',
    name: 'CoinGecko prices',
    description:
      'US dollar market prices of every coin: the base of every instant-exchange price (BitoCard and resellers add only their markup) and the size of Spin and win’s BNB rewards. Optionally checked against Coinbase, pausing a coin whose prices disagree.',
    section: 'blockchain' as const,
    adapterReady: true,
    fields: priceFields,
  },
];

/** Services both products use, each with its own account: Afrippa's are set in Afrippa's admin, BitoCard's in BitoCard's. */
const sharedGroupIds = new Set(['email', 'sms', 'sms_africas_talking', 'web_push', 'file_storage', 'kyc_storage', 'google', 'anthropic', 'openai', 'deepseek', 'github']);

/** Crypto is Afrippa's alone (BitoCard keeps no crypto setting); the shared services are both's; the rest BitoCard's. */
function platformsOf(group: Omit<IntegrationGroup, 'platforms'>): Platform[] {
  if (group.section === 'blockchain') return ['afrippa'];
  return sharedGroupIds.has(group.id) ? ['bitocard', 'afrippa'] : ['bitocard'];
}

export const integrationGroups: IntegrationGroup[] = groupsWithoutPlatforms.map(group => ({ ...group, platforms: platformsOf(group) }));

/** The integration groups a product's admin sees and sets. */
export const groupsFor = (platform: Platform) => integrationGroups.filter(group => group.platforms.includes(platform));

/**
 * Udozo's integration groups: the platform services, and pawaPay for mobile money payments and payouts. Never BitoCard's
 * product suppliers or Afrippa's addresses. Its AI (Anthropic, OpenAI and DeepSeek) runs Udozo's assistants, never stores'
 * support bots, so those groups say so, and the Support assistant group keeps only the models offered.
 */
const notUdozoFields: ReadonlySet<string> = new Set(['AFRIPPA_URL', 'AFRIPPA_VERIFY_URL', 'AI_MONTHLY_REPLIES']);

/** Udozo's own words for its AI groups. */
const udozoAiGroups: Record<string, Pick<IntegrationGroup, 'description'> & { name?: string; fieldHelp?: Record<string, { label?: string; help: string }> }> = {
  anthropic: { description: 'Claude models for Udozo’s assistants (Anjio and any others). Test connection lists the models the key can use.' },
  openai: { description: 'OpenAI models for Udozo’s assistants. Test connection lists the models the key can use.' },
  deepseek: {
    description: 'DeepSeek models for Udozo’s assistants. DeepSeek reads text only, so an assistant that helps sellers from their photos needs Claude or OpenAI. DeepSeek processes data in China. Test connection lists the models the key can use.',
  },
  support_ai: {
    name: 'Assistant models',
    description: 'The models Udozo’s assistants may run on. Only models of a provider whose API key is set are offered.',
    fieldHelp: {
      AI_BITOCARD_MODELS: { label: 'Models offered', help: 'provider:model, separated by commas, for example anthropic:claude-haiku-5-5, openai:gpt-5-mini, deepseek:deepseek-chat.' },
    },
  },
};

/** The groups a product's admin sees and sets: Udozo's instance (APP_PRODUCT) narrows BitoCard's platform groups to its own. */
export const groupsForProduct = (platform: Platform, product: Product) => {
  const groups = groupsFor(platform);
  if (product !== 'udozo') return groups;
  return groups
    .filter(group => group.section !== 'suppliers' || group.id === 'pawapay')
    // pawaPay is a payment provider on Udozo (mobile money in and out), never a product supplier.
    .map(group => {
      const words = udozoAiGroups[group.id];
      const fields = group.fields.filter(item => !notUdozoFields.has(item.key)).map(item => ({ ...item, ...words?.fieldHelp?.[item.key] }));
      return { ...group, ...(words ? { name: words.name ?? group.name, description: words.description } : {}), section: group.id === 'pawapay' ? ('platform' as const) : group.section, fields };
    });
};

/** Settings only Afrippa uses (its crypto): read from Afrippa's values whoever reads them. */
export const afrippaOnlyKeys: ReadonlySet<string> = new Set(integrationGroups.filter(group => group.platforms.length === 1 && group.platforms[0] === 'afrippa').flatMap(group => group.fields.map(item => item.key)));

/** Settings both products use, each with its own value. */
export const sharedKeys: ReadonlySet<string> = new Set(integrationGroups.filter(group => group.platforms.length > 1).flatMap(group => group.fields.map(item => item.key)));

/** The product whose value of a setting a reader gets when it does not say: Afrippa's for its crypto, else BitoCard's. */
export const ownerOf = (key: string): Platform => (afrippaOnlyKeys.has(key) ? 'afrippa' : 'bitocard');

export const integrationFields = new Map(integrationGroups.flatMap(group => group.fields.map(item => [item.key, item] as const)));

/** Platform settings: named after environment variables, read through `IntegrationsService.config`. */
export const isPlatformKey = (key: string): key is IntegrationKey => (integrationKeys as readonly string[]).includes(key);
