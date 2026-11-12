import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { api, ApiError } from '@/lib/api';
import type { SessionReply } from '@/lib/types';

/**
 * Signing in with Apple, Google and Facebook in the app: each SDK gives the app a token, which the API checks
 * (`POST /v1/store/account/<provider>/native`); the API's rules are the web's. Google and Facebook show only in builds
 * that have their IDs (`app.config.ts`). A person who cancels gets null, never an error.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as { googleWebClientId?: string | null; googleIosClientId?: string | null; facebook?: boolean };

export const googleAvailable = Boolean(extra.googleWebClientId);
export const facebookAvailable = Boolean(extra.facebook);
export const appleAvailable = () => (Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false));

const newNonce = () => Crypto.randomUUID().replace(/-/g, '');
const cancelled = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? '';
  return /cancel/i.test(code) || code === 'ERR_REQUEST_CANCELED' || code === '12501' || code === 'SIGN_IN_CANCELLED';
};

export async function signInWithApple(ref?: string): Promise<SessionReply | null> {
  const nonce = newNonce();
  // Apple keeps what the app passes; the API accepts the nonce or its SHA-256, so the raw one never reaches Apple.
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hashed });
  } catch (error) {
    if (cancelled(error)) return null;
    throw error;
  }
  if (!credential.identityToken) throw new ApiError(0, { type: 'api_error', code: 'apple_failed', message: 'Sign in with Apple did not work. Try again.' });
  return api<SessionReply>('/v1/store/account/apple/native', {
    body: {
      identity_token: credential.identityToken,
      nonce,
      authorization_code: credential.authorizationCode ?? undefined,
      first_name: credential.fullName?.givenName ?? undefined,
      last_name: credential.fullName?.familyName ?? undefined,
      ref,
    },
  });
}

export async function signInWithGoogle(ref?: string): Promise<SessionReply | null> {
  // Loaded only when used, in builds that have the IDs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: extra.googleWebClientId ?? undefined, iosClientId: extra.googleIosClientId ?? undefined });
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
    const result = await GoogleSignin.signIn();
    if (!isSuccessResponse(result)) return null;
    const idToken = result.data.idToken;
    if (!idToken) throw new ApiError(0, { type: 'api_error', code: 'google_failed', message: 'Google sign-in did not work. Try again.' });
    // Google's library gives no nonce: the API takes only a token issued in the last 10 minutes.
    return await api<SessionReply>('/v1/store/account/google/native', { body: { id_token: idToken, ref } });
  } catch (error) {
    if (cancelled(error)) return null;
    throw error;
  }
}

export async function signInWithFacebook(ref?: string): Promise<SessionReply | null> {
  // Linked only into builds with Facebook's app ID (react-native.config.js): loaded only then.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('react-native-fbsdk-next') as typeof import('react-native-fbsdk-next');
  if (Platform.OS === 'ios') {
    // iPhones: Limited Login, a signed token for the app's nonce (whether or not tracking is allowed).
    const nonce = newNonce();
    const result = await sdk.LoginManager.logInWithPermissions(['public_profile', 'email'], 'limited', nonce);
    if (result.isCancelled) return null;
    const token = await sdk.AuthenticationToken.getAuthenticationTokenIOS();
    if (!token?.authenticationToken) return null;
    return api<SessionReply>('/v1/store/account/facebook/native', { body: { id_token: token.authenticationToken, nonce, ref } });
  }
  const result = await sdk.LoginManager.logInWithPermissions(['public_profile', 'email']);
  if (result.isCancelled) return null;
  const token = await sdk.AccessToken.getCurrentAccessToken();
  if (!token?.accessToken) return null;
  return api<SessionReply>('/v1/store/account/facebook/native', { body: { access_token: token.accessToken, ref } });
}
