import Constants from 'expo-constants';

/** Where the app's API and site are (app.json's `extra`), and the app's own version. */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; siteUrl?: string };

export const apiUrl = extra.apiUrl ?? 'https://api.udozo.com';
export const siteUrl = extra.siteUrl ?? 'https://udozo.com';
export const appVersion = Constants.expoConfig?.version ?? '0.0.0';
