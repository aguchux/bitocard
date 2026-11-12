import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json, plus what depends on the build's environment (EAS environment variables, or a local .env):
 *
 * - `GOOGLE_WEB_CLIENT_ID` (the web client the API checks native ID tokens against), `GOOGLE_IOS_CLIENT_ID` and
 *   `GOOGLE_IOS_URL_SCHEME` (its reversed form): Continue with Google shows only once they are set.
 * - `FACEBOOK_APP_ID` and `FACEBOOK_CLIENT_TOKEN`: Continue with Facebook, and the Facebook SDK is linked only then
 *   (`react-native.config.js`), since it needs its app ID from the start.
 * - `GOOGLE_SERVICES_JSON`: the Firebase file for Android push (an EAS file variable), without which Android gets no
 *   push token.
 * - `UDOZO_API_URL`: another API (a staging one) for test builds.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env;
  const plugins: NonNullable<ExpoConfig['plugins']> = [...(config.plugins ?? [])];
  if (env.GOOGLE_IOS_URL_SCHEME) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: env.GOOGLE_IOS_URL_SCHEME }]);
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_CLIENT_TOKEN) {
    plugins.push([
      'react-native-fbsdk-next',
      { appID: env.FACEBOOK_APP_ID, clientToken: env.FACEBOOK_CLIENT_TOKEN, displayName: 'Udozo', isAutoInitEnabled: true, autoLogAppEventsEnabled: false, advertiserIDCollectionEnabled: false },
    ]);
  }
  return {
    ...config,
    name: config.name ?? 'Udozo',
    slug: config.slug ?? 'udozo',
    plugins,
    android: { ...config.android, ...(env.GOOGLE_SERVICES_JSON ? { googleServicesFile: env.GOOGLE_SERVICES_JSON } : {}) },
    extra: {
      ...config.extra,
      ...(env.UDOZO_API_URL ? { apiUrl: env.UDOZO_API_URL } : {}),
      googleWebClientId: env.GOOGLE_WEB_CLIENT_ID ?? null,
      googleIosClientId: env.GOOGLE_IOS_CLIENT_ID ?? null,
      facebook: Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_CLIENT_TOKEN),
    },
  };
};
