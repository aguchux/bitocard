import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json, plus what depends on the build's environment (EAS environment variables, or a local .env):
 *
 * - `GOOGLE_SERVICES_JSON`: the Firebase file for Android push (an EAS file variable, secret), without which Android
 *   gets no push token. iPhones need no Firebase file: their APNs key is in EAS credentials.
 * - `BITOCARD_API_URL` and `BITOCARD_SITE_URL`: another API and site (a staging one) for test builds; app.json's
 *   `extra` otherwise.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env;
  return {
    ...config,
    name: config.name ?? 'BitoCard',
    slug: config.slug ?? 'bitocard',
    android: { ...config.android, ...(env.GOOGLE_SERVICES_JSON ? { googleServicesFile: env.GOOGLE_SERVICES_JSON } : {}) },
    extra: {
      ...config.extra,
      ...(env.BITOCARD_API_URL ? { apiUrl: env.BITOCARD_API_URL } : {}),
      ...(env.BITOCARD_SITE_URL ? { siteUrl: env.BITOCARD_SITE_URL } : {}),
    },
  };
};
