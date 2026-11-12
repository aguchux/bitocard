import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { appTag, request, type RequestOptions } from '@/lib/api-core';
import { apiUrl, appVersion } from '@/lib/config';
import { readSession } from '@/lib/session';

export { ApiError } from '@/lib/api-core';

/** A new Idempotency-Key: a random UUID from the phone's secure random source. */
export const newIdempotencyKey = () => Crypto.randomUUID();

const app = appTag(Platform.OS === 'ios' ? 'ios' : 'android', appVersion);

/** Calls Udozo's API with the signed-in customer's session, if any, saying it is the app. */
export async function api<T>(path: string, options: Omit<RequestOptions, 'session' | 'app'> = {}) {
  return request<T>(fetch, apiUrl, path, { ...options, session: await readSession(), app }, newIdempotencyKey);
}
