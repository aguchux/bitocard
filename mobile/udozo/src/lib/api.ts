import * as Crypto from 'expo-crypto';

import { request, type RequestOptions } from '@/lib/api-core';
import { apiUrl } from '@/lib/config';
import { readSession } from '@/lib/session';

export { ApiError } from '@/lib/api-core';

/** A new Idempotency-Key: a random UUID from the phone's secure random source. */
export const newIdempotencyKey = () => Crypto.randomUUID();

/** Calls Udozo's API with the signed-in customer's session, if any. */
export async function api<T>(path: string, options: Omit<RequestOptions, 'session'> = {}) {
  return request<T>(fetch, apiUrl, path, { ...options, session: await readSession() }, newIdempotencyKey);
}
