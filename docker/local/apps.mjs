// The local copy of BitoCard and Udozo (docs/LOCAL_TESTING.md): every app, its port and its settings, in one place.
// The Dockerfile writes each Next.js app's NEXT_PUBLIC_* values before building (they are baked into the browser
// code), and run.mjs starts every process with its `env`. Everything runs in one container, so `localhost` reaches the
// APIs both from the browser (through the published ports) and from the apps' own servers.

const bitocardApi = 'http://localhost:3001';
const udozoApi = 'http://localhost:3010';
const site = port => `http://localhost:${port}`;

/** Secrets and database addresses come from .env.docker (see docker/local/local.env.example). */
const secrets = env => ({
  bitocard: {
    DATABASE_URL: 'postgresql://local:local@postgres:5432/bitocard',
    ENCRYPTION_KEY: env.BITOCARD_ENCRYPTION_KEY,
    CRON_SECRET: env.LOCAL_CRON_SECRET,
    STORE_SERVER_SECRET: env.BITOCARD_STORE_SERVER_SECRET,
    UPSTASH_REDIS_REST_URL: 'http://redis-http:80',
    UPSTASH_REDIS_REST_TOKEN: 'local_token',
  },
  udozo: {
    DATABASE_URL: 'postgresql://local:local@postgres:5432/udozo',
    ENCRYPTION_KEY: env.UDOZO_ENCRYPTION_KEY,
    CRON_SECRET: env.LOCAL_CRON_SECRET,
    STORE_SERVER_SECRET: env.UDOZO_STORE_SERVER_SECRET,
    UPSTASH_REDIS_REST_URL: 'http://redis-http-udozo:80',
    UPSTASH_REDIS_REST_TOKEN: 'local_token',
  },
});

/** Every process, in start order (the APIs first). `public` is baked into a Next.js app at build time. */
export function localApps(env = process.env) {
  const s = secrets(env);
  const local = {
    // Plain http on localhost, no proxy in front, and outgoing calls in sandbox where a setting exists.
    COOKIE_SECURE: 'off',
    TRUST_PROXY: '0',
    CHECKOUT_SANDBOX: 'on',
    LOG_LEVEL: 'info',
  };
  return [
    {
      name: 'bitocard-api', dir: 'apps/api', port: 3001, kind: 'api',
      env: {
        ...local, ...s.bitocard, PORT: '3001',
        ALLOWED_ORIGINS: [3000, 3002, 3003, 3004, 3005, 3006].map(site).join(','),
        ADMIN_APP_URL: site(3003),
        STOREFRONT_URL: site(3000), DASHBOARD_URL: site(3004), VERIFY_URL: site(3006),
        API_PUBLIC_URL: bitocardApi, PAYMENT_RETURN_URL: `${site(3004)}/wallet`,
        GOOGLE_REDIRECT_URI: `${bitocardApi}/v1/auth/google/callback`,
      },
    },
    {
      name: 'udozo-api', dir: 'apps/udozo-api', port: 3010, kind: 'api',
      env: {
        ...local, ...s.udozo, PORT: '3010', APP_PRODUCT: 'udozo',
        ALLOWED_ORIGINS: [3007, 3011, 3012, 3013, 3014].map(site).join(','),
        ADMIN_APP_URL: site(3012),
        STOREFRONT_URL: site(3007), SHOP_URL: site(3007), DASHBOARD_URL: site(3011),
        CONNECT_URL: site(3013), POS_URL: site(3014),
        API_PUBLIC_URL: udozoApi, PAYMENT_RETURN_URL: `${site(3011)}/wallet`,
        GOOGLE_REDIRECT_URI: `${udozoApi}/v1/auth/google/callback`,
        FACEBOOK_REDIRECT_URI: `${udozoApi}/v1/auth/facebook/callback`,
      },
    },
    // BitoCard
    { name: 'storefront', dir: 'apps/storefront', port: 3000, public: { NEXT_PUBLIC_API_URL: bitocardApi }, env: { API_URL: bitocardApi, STORE_SERVER_SECRET: s.bitocard.STORE_SERVER_SECRET, LEGALS_URL: site(3005), SHQ_URL: site(3004) } },
    { name: 'docs', dir: 'apps/docs', port: 3002, public: { NEXT_PUBLIC_API_URL: bitocardApi, NEXT_PUBLIC_SHQ_URL: site(3004) } },
    { name: 'admin', dir: 'apps/admin', port: 3003, public: { NEXT_PUBLIC_API_URL: bitocardApi, NEXT_PUBLIC_STOREFRONT_URL: site(3000) } },
    { name: 'shq', dir: 'apps/shq', port: 3004, public: { NEXT_PUBLIC_API_URL: bitocardApi, NEXT_PUBLIC_VERIFY_URL: site(3006) } },
    { name: 'legals', dir: 'apps/legals', port: 3005 },
    { name: 'verify', dir: 'apps/verify', port: 3006, public: { NEXT_PUBLIC_API_URL: bitocardApi, NEXT_PUBLIC_SHQ_URL: site(3004) }, env: { API_URL: bitocardApi } },
    // Udozo
    {
      name: 'udozo', dir: 'apps/udozo', port: 3007,
      public: { NEXT_PUBLIC_API_URL: udozoApi, NEXT_PUBLIC_SHQ_URL: site(3011), NEXT_PUBLIC_CONNECT_URL: site(3013), NEXT_PUBLIC_POS_URL: site(3014) },
      env: { API_URL: udozoApi, UDOZO_URL: site(3007), STORE_SERVER_SECRET: s.udozo.STORE_SERVER_SECRET },
    },
    { name: 'udozo-shq', dir: 'apps/udozo-shq', port: 3011, public: { NEXT_PUBLIC_API_URL: udozoApi, NEXT_PUBLIC_UDOZO_URL: site(3007) } },
    { name: 'udozo-admin', dir: 'apps/udozo-admin', port: 3012, public: { NEXT_PUBLIC_API_URL: udozoApi, NEXT_PUBLIC_UDOZO_URL: site(3007) } },
    {
      name: 'udozo-connect', dir: 'apps/udozo-connect', port: 3013, public: { NEXT_PUBLIC_API_URL: udozoApi, NEXT_PUBLIC_UDOZO_URL: site(3007) },
      env: { API_URL: udozoApi, CONNECT_URL: site(3013), UDOZO_URL: site(3007), STORE_SERVER_SECRET: s.udozo.STORE_SERVER_SECRET },
    },
    {
      name: 'udozo-pos', dir: 'apps/udozo-pos', port: 3014, public: { NEXT_PUBLIC_API_URL: udozoApi, NEXT_PUBLIC_UDOZO_URL: site(3007) },
      env: { API_URL: udozoApi, POS_URL: site(3014), UDOZO_URL: site(3007), STORE_SERVER_SECRET: s.udozo.STORE_SERVER_SECRET },
    },
  ];
}

/** The workspace packages the image builds. */
export const packages = ['@bitocard/api', '@udozo/api', '@bitocard/storefront', '@bitocard/docs', '@bitocard/admin', '@bitocard/shq', '@bitocard/legals', '@bitocard/verify', '@udozo/web', '@udozo/shq', '@udozo/admin', '@udozo/connect', '@udozo/pos'];
