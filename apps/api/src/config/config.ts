import { z } from 'zod';

const list = z
  .string()
  .transform(value => value.split(',').map(item => item.trim()).filter(Boolean));

const flag = z.enum(['on', 'off']).transform(value => value === 'on');

export const configSchema = z.object({
  /**
   * Which deployment this is, wherever it runs: `production` on the DigitalOcean droplet (`deploy/droplet`), set
   * there explicitly. Unset: Vercel's own VERCEL_ENV, else local. Production means secure cookies and no private
   * webhook addresses.
   */
  APP_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  /** Set to 1 by Vercel at build and run time. */
  VERCEL: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  /** Per client address, checked before the caller is identified, so made-up credentials cannot be sent without limit. */
  ADDRESS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1200),
  /**
   * Per client address on sign-in, password and code routes (POST). Kept even while Redis is unreachable (counted in
   * memory per instance), so passwords and codes can never be guessed, nor emails and SMS sent, without limit.
   */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  /**
   * How many proxies in front of the API to trust for the client's address (`X-Forwarded-For`): 1 on Vercel (its edge
   * sets the header) or behind one proxy (the droplet's Caddy, which writes the visitor's address from Cloudflare's
   * CF-Connecting-IP only for requests from Cloudflare's own ranges); 0 when clients connect directly. Never "all": the client writes the
   * left end of the header, so trusting every hop lets anyone choose their own address and dodge per-address limits.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  /**
   * Shared with the storefront's server, which signs each shopper's address with it (`BitoCard-Client`), so signed-out
   * shoppers are rate limited one by one instead of sharing the store server's address. Unset: they share it.
   */
  STORE_SERVER_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  /**
   * Browser origins allowed to call the API with cookies (CORS, and the Origin check that stops cross-site changes).
   * Exact origins only: a wildcard such as `https://*.bitocard.com` would also trust every reseller's hosted store
   * (`<store>.bitocard.com`), so any script on one could act as a signed-in reseller. The storefront calls the API from
   * its server and needs no entry.
   */
  ALLOWED_ORIGINS: list.prefault('https://shq.bitocard.com,https://admin.bitocard.com,https://docs.bitocard.com,https://verify.bitocard.com'),
  /** Cookie domain shared by the BitoCard apps (.bitocard.com in production); unset means host-only cookies. */
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  /** Secure cookies everywhere except plain-HTTP local development and tests. */
  COOKIE_SECURE: flag.optional(),

  // Passwords.
  PASSWORD_BREACH_CHECK: flag.prefault('on'),
  HIBP_API_URL: z.string().url().default('https://api.pwnedpasswords.com'),

  // Email: providers are tried in order; with no API keys, emails are only logged (development and tests).
  EMAIL_FROM: z.string().default('BitoCard <no-reply@bitocard.com>'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_URL: z.string().url().default('https://api.resend.com'),
  /** Domains for reseller stores (Vercel): a token with access to the storefront project's team, the team and the project. */
  VERCEL_API_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_STOREFRONT_PROJECT: z.string().optional(),
  VERCEL_API_URL: z.string().url().default('https://api.vercel.com'),
  /** BitoCard's margin on domains, in percent of Vercel's price (unset: domains cannot be bought, only connected). */
  DOMAIN_MARGIN_PERCENT: z.string().optional(),
  /** Endings resellers can buy, comma separated. */
  DOMAIN_TLDS: z.string().default('com'),
  /** DNS over HTTPS (JSON) used to read a domain's public records before its nameservers move. */
  DOMAIN_DNS_LOOKUP_URL: z.string().url().default('https://cloudflare-dns.com/dns-query'),
  /** Stores' addresses on bitocard.com: a Cloudflare token that edits the zone's DNS, and the zone. */
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  CLOUDFLARE_API_URL: z.string().url().default('https://api.cloudflare.com/client/v4'),
  /** Where each store's CNAME points (Vercel's). */
  STORE_HOST_TARGET: z.string().default('cname.vercel-dns.com'),
  MAILERSEND_API_KEY: z.string().optional(),
  MAILERSEND_API_URL: z.string().url().default('https://api.mailersend.com'),

  // SMS for sign-in codes (Termii). The base URL is account-specific; see the Termii dashboard.
  TERMII_API_KEY: z.string().optional(),
  TERMII_API_URL: z.string().url().default('https://api.ng.termii.com'),
  TERMII_SENDER_ID: z.string().default('BitoCard'),
  AFRICASTALKING_USERNAME: z.string().optional(),
  AFRICASTALKING_API_KEY: z.string().optional(),
  AFRICASTALKING_SENDER_ID: z.string().optional(),
  AFRICASTALKING_API_URL: z.string().url().optional(),

  // Browser push notifications (Web Push, VAPID). Without both keys, push is switched off and only the in-app inbox
  // is used. Generate a key pair with `npm run push:keys -w @bitocard/api`.
  WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().default('mailto:support@bitocard.com'),

  // Sign in with Google (resellers only). Unset client ID means Google sign-in is switched off.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().default('https://api.bitocard.com/v1/auth/google/callback'),
  GOOGLE_AUTH_URL: z.string().url().default('https://accounts.google.com/o/oauth2/v2/auth'),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GOOGLE_JWKS_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/certs'),

  // Admins: allowed email domains, and the 32-byte base64 key that encrypts authenticator secrets.
  ADMIN_EMAIL_DOMAINS: list.prefault('bitocard.com,golojan.co.uk'),
  ENCRYPTION_KEY: z.string().optional(),
  /**
   * The admins' own addresses (comma separated): the only ones the sign-in page sets up as admins (super admins, on
   * their first visit) and the only ones it emails set-password and reset links to. Environment only: an admin's edit
   * can never widen it. Empty: no admin can be set up or reset from the sign-in page.
   */
  ADMIN_SETUP_EMAILS: list.transform(items => items.map(item => item.toLowerCase())).prefault(''),
  /** The admin app (admin.bitocard.com): set-password links point here. Environment only, like the line above. */
  ADMIN_APP_URL: z.string().url().default('https://admin.bitocard.com'),

  /** Where links in emails point (the reseller dashboard). */
  DASHBOARD_URL: z.string().url().default('https://shq.bitocard.com'),
  /** BitoCard's store (bitocard.com); bundled brand icons are served from it at /brand-icons/<slug>.svg. */
  STOREFRONT_URL: z.string().url().default('https://bitocard.com'),
  /** BitoCard Verify, where people complete identity checks in Verify countries. */
  VERIFY_URL: z.string().url().default('https://verify.bitocard.com'),

  // Payments, reserved accounts and payouts. A provider without keys is switched off; the sandbox never calls providers.
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  /** The secret hash set in the Flutterwave dashboard; webhooks must carry it in the verif-hash header. */
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),
  FLUTTERWAVE_API_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  /** on: test keys (FLWSECK_TEST-…) for checks only; never used for live payments. Flutterwave's address is the same. */
  FLUTTERWAVE_SANDBOX: flag.prefault('off'),
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  /** Leave at the default to follow MONNIFY_SANDBOX (src/integrations/endpoints.ts); any other value overrides it. */
  MONNIFY_API_URL: z.string().url().default('https://api.monnify.com'),
  /** on: Monnify's sandbox for checks only; never used for live payments. */
  MONNIFY_SANDBOX: flag.prefault('off'),
  /** Stripe: card payments (Checkout). Test keys (sk_test_…) use the same address; STRIPE_SANDBOX marks them as test keys. */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** The endpoint's signing secret (whsec_…): webhooks are checked against it (Stripe-Signature). */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_URL: z.string().url().default('https://api.stripe.com'),
  /**
   * Stripe product tax code for payments with no code of their own (everything but software). Needed only while Stripe
   * Managed Payments is on for the account, which takes only digital products (software, games, digital media, online
   * services): wallet top-ups, gift cards, airtime, bills and the like are not eligible.
   */
  STRIPE_TAX_CODE: z
    .string()
    .regex(/^txcd_\d{8}$/, 'a Stripe tax code looks like txcd_10000000')
    .optional(),
  /** on: the test secret key (sk_test_…) for checks only; Stripe is never used for live payments. */
  STRIPE_SANDBOX: flag.prefault('off'),
  /** Paystack: payment pages (card, bank, USSD, mobile money). Test keys (sk_test_…) use the same address; PAYSTACK_SANDBOX marks them as test keys. */
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_API_URL: z.string().url().default('https://api.paystack.co'),
  /** on: the test secret key (sk_test_…) for checks only; Paystack is never used for live payments. */
  PAYSTACK_SANDBOX: flag.prefault('off'),
  /** Where the payment page sends the payer back to when the caller gives no return_url. */
  PAYMENT_RETURN_URL: z.string().url().default('https://shq.bitocard.com/wallet'),
  /** on: customer checkout on bitocard.com runs in the sandbox (simulated payment pages and SANDBOX- codes), for testing before launch. */
  CHECKOUT_SANDBOX: flag.prefault('off'),

  // Exchange rates: Open Exchange Rates as the reference, checked against Flutterwave's offered rates.
  OPEN_EXCHANGE_RATES_APP_ID: z.string().optional(),
  OPEN_EXCHANGE_RATES_API_URL: z.string().url().default('https://openexchangerates.org/api'),
  /** Rates older than this are not used for conversions. */
  FX_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(180),

  // Suppliers. A supplier without credentials is used only in the sandbox (test mode), never live.
  RELOADLY_CLIENT_ID: z.string().optional(),
  RELOADLY_CLIENT_SECRET: z.string().optional(),
  /** The webhook signature secret (Reloadly dashboard > Developers > Webhooks); signs X-Reloadly-Signature. */
  RELOADLY_WEBHOOK_SECRET: z.string().optional(),
  /** on: Reloadly's sandbox (test credits) with sandbox credentials, for checks only; never used for live orders or syncs. */
  RELOADLY_SANDBOX: flag.prefault('off'),
  RELOADLY_AUTH_URL: z.string().url().default('https://auth.reloadly.com'),
  /** Override the gift card and top-up API addresses (tests); by default they follow RELOADLY_SANDBOX. */
  RELOADLY_GIFTCARDS_URL: z.string().url().optional(),
  RELOADLY_TOPUPS_URL: z.string().url().optional(),
  VTPASS_API_KEY: z.string().optional(),
  VTPASS_PUBLIC_KEY: z.string().optional(),
  VTPASS_SECRET_KEY: z.string().optional(),
  /** Leave at the default to follow VTPASS_SANDBOX; any other value overrides it. */
  VTPASS_API_URL: z.string().url().default('https://vtpass.com/api'),
  /** on: VTpass's sandbox with sandbox keys, for checks only; never used for live orders or syncs. */
  VTPASS_SANDBOX: flag.prefault('off'),
  /** VTpass needs a phone number on every payment; used when the customer gave none. */
  VTPASS_CONTACT_PHONE: z.string().default('08011111111'),
  /** The commission agreed with VTpass per airtime and data service: `mtn 3; airtel 3.4; mtn-data 3`. */
  VTPASS_COMMISSIONS: z.string().optional(),
  DIDWW_API_KEY: z.string().optional(),
  /** Leave at the default to follow DIDWW_SANDBOX; any other value overrides it. */
  DIDWW_API_URL: z.string().url().default('https://api.didww.com/v3'),
  DIDWW_SANDBOX: flag.prefault('off'),
  /** Countries whose numbers are synced (ISO codes); numbers are sold to resellers in every market. */
  DIDWW_COUNTRIES: list.prefault('GB,US'),
  /** BitoCard's public API address: DIDWW order callbacks go to <this>/v1/webhooks/didww and are signed over it. */
  DIDWW_CALLBACK_URL: z.string().url().default('https://api.bitocard.com'),
  /**
   * Incoming SMS: DIDWW's HTTP IN SMS trunk (set up in DIDWW's panel and assigned to each number) posts to
   * <DIDWW_CALLBACK_URL>/v1/webhooks/didww-sms?token=<this>. Without it, incoming SMS are refused.
   */
  DIDWW_SMS_WEBHOOK_TOKEN: z.string().min(16).optional(),
  /** Outgoing SMS: the HTTP OUT SMS trunk's username and password (DIDWW panel > SMS trunks), separate from the API key. */
  DIDWW_SMS_USERNAME: z.string().optional(),
  DIDWW_SMS_PASSWORD: z.string().optional(),
  DIDWW_SMS_URL: z.string().url().default('https://sms-out.didww.com'),
  /** The most one SMS part may cost, in US cents: held from the wallet before sending (DIDWW prices a message only after it is sent). */
  DIDWW_SMS_MAX_PRICE_CENTS: z.coerce.number().int().positive().default(10),
  ZENDIT_API_KEY: z.string().optional(),
  /** Leave at the default to follow ZENDIT_SANDBOX (test mode, https://test-api.zendit.io/v1); any other value overrides it. */
  ZENDIT_API_URL: z.string().url().default('https://api.zendit.io/v1'),
  ZENDIT_SANDBOX: flag.prefault('off'),
  /** Expected as `X-Webhook-Token: <secret>` on Zendit's webhooks (set in the Zendit console). */
  ZENDIT_WEBHOOK_SECRET: z.string().optional(),
  PAWAPAY_API_TOKEN: z.string().optional(),
  /** Leave at the default to follow PAWAPAY_SANDBOX (https://api.sandbox.pawapay.io); any other value overrides it. */
  PAWAPAY_API_URL: z.string().url().default('https://api.pawapay.io'),
  PAWAPAY_SANDBOX: flag.prefault('off'),
  /** The payout fee agreed with pawaPay, in percent (for example 1.5): BitoCard's cost is the amount plus this. */
  PAWAPAY_PAYOUT_FEE_PERCENT: z.string().optional(),
  /** In the callback address set in the pawaPay dashboard: /v1/webhooks/pawapay?token=<this>. */
  PAWAPAY_CALLBACK_TOKEN: z.string().optional(),
  /** Africa's Talking airtime and data bundles (supplier): its app's username and API key ("sandbox" for its test app). */
  AFRICAS_TALKING_USERNAME: z.string().optional(),
  AFRICAS_TALKING_API_KEY: z.string().optional(),
  AFRICAS_TALKING_SANDBOX: flag.prefault('off'),
  /** Leave at the defaults to follow AFRICAS_TALKING_SANDBOX; any other value overrides them. */
  AFRICAS_TALKING_API_URL: z.string().url().default('https://api.africastalking.com'),
  AFRICAS_TALKING_DATA_URL: z.string().url().default('https://bundles.africastalking.com'),
  /** The airtime discount agreed with Africa's Talking, in percent: BitoCard's cost is the amount less this. */
  AFRICAS_TALKING_AIRTIME_DISCOUNT_PERCENT: z.string().optional(),
  /** Airtime countries (`KE KES 10-10000 safaricom,airtel,telkom; ...`); empty: the published defaults. */
  AFRICAS_TALKING_AIRTIME_COUNTRIES: z.string().optional(),
  /** The Mobile Data product made in its dashboard, and the plans sold (`KE safaricom 1GB Month 299 250; ...`). */
  AFRICAS_TALKING_DATA_PRODUCT: z.string().optional(),
  AFRICAS_TALKING_DATA_PLANS: z.string().optional(),
  /** In the status callback addresses set in its dashboard: /v1/webhooks/africas-talking?token=<this>. */
  AFRICAS_TALKING_CALLBACK_TOKEN: z.string().optional(),
  /** eSIM Access (eSIM data packages): the access code and secret key from its console (Developer). No sandbox exists. */
  /** Remita Vending Bills (RemitaConnect): the account's secret key, sent as the secretKey header. */
  REMITA_SECRET_KEY: z.string().optional(),
  REMITA_SANDBOX: flag.prefault('off'),
  /** Leave at the default to follow REMITA_SANDBOX (the demo gateway); any other value overrides it. */
  REMITA_API_URL: z.string().url().default('https://api-gateway.remita.net'),
  /** The phone number sent with bill and TV payments when the customer gave none (Remita asks for one). */
  REMITA_CONTACT_PHONE: z.string().optional(),
  ESIM_ACCESS_ACCESS_CODE: z.string().optional(),
  ESIM_ACCESS_SECRET_KEY: z.string().optional(),
  ESIM_ACCESS_API_URL: z.string().url().default('https://api.esimaccess.com'),
  /** In the webhook address saved in eSIM Access: /v1/webhooks/esim-access?token=<this>. */
  ESIM_ACCESS_WEBHOOK_TOKEN: z.string().min(16).optional(),
  /** AI providers for support bots on BitoCard's keys (Premium). Prices: "model input output cached" in US dollars per million tokens. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_API_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_PRICES: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_URL: z.string().url().default('https://api.openai.com'),
  OPENAI_PRICES: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_API_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_PRICES: z.string().optional(),
  /** Models a bot may use on BitoCard's keys, as provider:model. */
  AI_BITOCARD_MODELS: z.string().default('anthropic:claude-haiku-5-5, anthropic:claude-sonnet-5-5, openai:gpt-5-mini, deepseek:deepseek-chat'),
  /** Bot replies a month per store on BitoCard's keys (the Premium allowance). */
  AI_MONTHLY_REPLIES: z.coerce.number().int().min(0).max(1_000_000).default(2000),
  /** Engineering escalations: the repository issues go to (owner/name), a fine-grained token with Issues read and write, and the webhook secret. */
  GITHUB_REPO: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),

  // File storage (DigitalOcean Spaces, S3-compatible): logos, icons and images uploaded by admins and resellers.
  // Browsers upload straight to the bucket with signed links; uploads are refused until the key, secret and bucket are set.
  SPACES_KEY: z.string().optional(),
  SPACES_SECRET: z.string().optional(),
  SPACES_BUCKET: z.string().optional(),
  /** The bucket's region, for example nyc3 (keep it in the United States, with the database). */
  SPACES_REGION: z.string().default('nyc3'),
  /** The S3 address; defaults to https://<region>.digitaloceanspaces.com. Tests point it at a local fake. */
  SPACES_ENDPOINT: z.string().url().optional(),
  /** Public address files are served from (the Spaces CDN or a custom domain); defaults to the bucket's own address. */
  SPACES_PUBLIC_URL: z.string().url().optional(),
  /** Top folder for everything this deployment stores, so environments sharing a bucket never mix. */
  SPACES_ROOT: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).default('bitocard'),
  /** BitoCard Verify's identity documents: a private bucket of their own, never the public media bucket. */
  KYC_SPACES_KEY: z.string().optional(),
  KYC_SPACES_SECRET: z.string().optional(),
  KYC_SPACES_BUCKET: z.string().optional(),
  KYC_SPACES_REGION: z.string().default('nyc3'),
  KYC_SPACES_ENDPOINT: z.string().url().optional(),
  KYC_SPACES_ROOT: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).default('bitocard'),

  // Identity checks (Didit): reseller owners everywhere, customers outside Nigeria. Unset API key switches Didit off.
  DIDIT_API_KEY: z.string().optional(),
  /** The Didit workflow (document plus liveness and face match) sessions run. */
  DIDIT_WORKFLOW_ID: z.string().optional(),
  /** The webhook destination's secret_shared_key; signs X-Signature. */
  DIDIT_WEBHOOK_SECRET: z.string().optional(),
  DIDIT_API_URL: z.string().url().default('https://verification.didit.me'),

  /** Vercel Cron sends it as a Bearer token; scheduled jobs refuse requests without it. */
  CRON_SECRET: z.string().optional(),
  /** Where operational alerts go (for example, conversions paused). */
  ALERT_EMAIL: z.string().email().default('alerts@bitocard.com'),

  // Webhooks to resellers.
  /** Local development and tests only: allows http:// and private addresses as webhook endpoints. Refused in production. */
  WEBHOOK_ALLOW_PRIVATE_URLS: flag.prefault('off'),
  /**
   * How deliveries are scheduled: vercel (Vercel Queues pushes each endpoint's work and retries to the API) or database
   * (runs after each change plus the cron). Defaults to vercel on Vercel, database elsewhere.
   */
  WEBHOOK_QUEUE: z.enum(['vercel', 'database']).optional(),
  /** Tests only: the Vercel Queues address and token. On Vercel the region's address and OIDC are used. */
  WEBHOOK_QUEUE_URL: z.string().url().optional(),
  WEBHOOK_QUEUE_TOKEN: z.string().optional(),
  /** GET /v1/events leaves out events newer than this, so a slow transaction cannot be skipped by a reader. */
  EVENTS_SETTLE_SECONDS: z.coerce.number().int().min(0).max(60).default(5),
});

export type AppConfig = z.infer<typeof configSchema> & {
  /** APP_ENV, else Vercel's VERCEL_ENV; undefined when running locally or in tests. */
  appEnv: 'production' | 'preview' | 'development' | undefined;
  cookieSecure: boolean;
  webhookQueue: 'vercel' | 'database';
};

/** Empty strings count as unset, so a blank line in .env never fails validation. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = configSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const config = parsed.data;
  const appEnv = config.APP_ENV ?? config.VERCEL_ENV;
  if (config.WEBHOOK_ALLOW_PRIVATE_URLS && appEnv === 'production') {
    throw new Error('Invalid environment configuration: WEBHOOK_ALLOW_PRIVATE_URLS must be off in production');
  }
  // Session cookies over plain HTTP in production would leak sessions: refuse to start rather than run that way.
  if (config.COOKIE_SECURE === false && appEnv === 'production') {
    throw new Error('Invalid environment configuration: COOKIE_SECURE must be on in production');
  }
  return {
    ...config,
    appEnv,
    cookieSecure: config.COOKIE_SECURE ?? Boolean(appEnv),
    webhookQueue: config.WEBHOOK_QUEUE ?? (config.VERCEL === '1' ? 'vercel' : 'database'),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
