import { z } from 'zod';

const list = z
  .string()
  .transform(value => value.split(',').map(item => item.trim()).filter(Boolean));

const flag = z.enum(['on', 'off']).transform(value => value === 'on');

export const configSchema = z.object({
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  /** Set to 1 by Vercel at build and run time. */
  VERCEL: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // Browser access. Origins may use a leading wildcard for subdomains, for example https://*.bitocard.com.
  ALLOWED_ORIGINS: list.prefault('https://bitocard.com,https://*.bitocard.com'),
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
  MAILERSEND_API_KEY: z.string().optional(),
  MAILERSEND_API_URL: z.string().url().default('https://api.mailersend.com'),

  // SMS for sign-in codes (Termii). The base URL is account-specific; see the Termii dashboard.
  TERMII_API_KEY: z.string().optional(),
  TERMII_API_URL: z.string().url().default('https://api.ng.termii.com'),
  TERMII_SENDER_ID: z.string().default('BitoCard'),

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

  /** Where links in emails point (the reseller dashboard). */
  DASHBOARD_URL: z.string().url().default('https://shq.bitocard.com'),

  // Payments, reserved accounts and payouts. A provider without keys is switched off; the sandbox never calls providers.
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  /** The secret hash set in the Flutterwave dashboard; webhooks must carry it in the verif-hash header. */
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),
  FLUTTERWAVE_API_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  MONNIFY_API_URL: z.string().url().default('https://api.monnify.com'),
  /** Where the payment page sends the payer back to when the caller gives no return_url. */
  PAYMENT_RETURN_URL: z.string().url().default('https://shq.bitocard.com/wallet'),

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
  /** on: Reloadly sandbox (test credits, no real cards); off: live. */
  RELOADLY_SANDBOX: flag.prefault('off'),
  RELOADLY_AUTH_URL: z.string().url().default('https://auth.reloadly.com'),
  /** Override the gift card and top-up API addresses (tests); by default they follow RELOADLY_SANDBOX. */
  RELOADLY_GIFTCARDS_URL: z.string().url().optional(),
  RELOADLY_TOPUPS_URL: z.string().url().optional(),
  VTPASS_API_KEY: z.string().optional(),
  VTPASS_PUBLIC_KEY: z.string().optional(),
  VTPASS_SECRET_KEY: z.string().optional(),
  /** https://sandbox.vtpass.com/api for the VTpass sandbox. */
  VTPASS_API_URL: z.string().url().default('https://vtpass.com/api'),
  /** VTpass needs a phone number on every payment; used when the customer gave none. */
  VTPASS_CONTACT_PHONE: z.string().default('08011111111'),
  DIDWW_API_KEY: z.string().optional(),
  /** https://sandbox-api.didww.com/v3 for the DIDWW sandbox. */
  DIDWW_API_URL: z.string().url().default('https://api.didww.com/v3'),
  /** Countries whose numbers are synced (ISO codes); numbers are sold to resellers in every market. */
  DIDWW_COUNTRIES: list.prefault('GB,US'),
  /** BitoCard's public API address: DIDWW order callbacks go to <this>/v1/webhooks/didww and are signed over it. */
  DIDWW_CALLBACK_URL: z.string().url().default('https://api.bitocard.com'),

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

export type AppConfig = z.infer<typeof configSchema> & { cookieSecure: boolean; webhookQueue: 'vercel' | 'database' };

/** Empty strings count as unset, so a blank line in .env never fails validation. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = configSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const config = parsed.data;
  if (config.WEBHOOK_ALLOW_PRIVATE_URLS && config.VERCEL_ENV === 'production') {
    throw new Error('Invalid environment configuration: WEBHOOK_ALLOW_PRIVATE_URLS must be off in production');
  }
  return {
    ...config,
    cookieSecure: config.COOKIE_SECURE ?? Boolean(config.VERCEL_ENV),
    webhookQueue: config.WEBHOOK_QUEUE ?? (config.VERCEL === '1' ? 'vercel' : 'database'),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
