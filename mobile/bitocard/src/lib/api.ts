import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { appHeader, appTag, networkError, readResponse, request, sessionHeader, type RequestOptions } from '@/lib/api-core';
import { apiUrl, appVersion } from '@/lib/config';
import { readSession } from '@/lib/session';
import { activeTransactionPin } from '@/lib/transaction-pin';

export { ApiError } from '@/lib/api-core';

/** A new Idempotency-Key: a random UUID from the phone's secure random source. */
export const newIdempotencyKey = () => Crypto.randomUUID();

const app = appTag(Platform.OS === 'ios' ? 'ios' : 'android', appVersion);

/**
 * Calls BitoCard's API with the signed-in customer's session, if any, saying it is the app. No store is named, so the
 * API serves bitocard.com's own store: the same account, wallet and orders as on the website.
 */
export async function api<T>(path: string, options: Omit<RequestOptions, 'session' | 'app'> & { transaction?: boolean } = {}) {
  const { transaction, ...requestOptions } = options;
  return request<T>(fetch, apiUrl, path, { ...requestOptions, transactionPin: requestOptions.transactionPin ?? (transaction ? activeTransactionPin() ?? undefined : undefined), session: await readSession(), app }, newIdempotencyKey);
}

/** A multipart send (a gift card's photos): the session and the app's tag as for any call; the answer read the same way. */
export async function apiUpload<T>(path: string, form: FormData, idempotencyKey?: string, transaction = false) {
  const session = await readSession();
  const headers: Record<string, string> = { Accept: 'application/json', [appHeader]: app, 'Idempotency-Key': idempotencyKey ?? newIdempotencyKey() };
  if (session) headers[sessionHeader] = session;
  const pin = transaction ? activeTransactionPin() : null;
  if (pin) headers['BitoCard-Transaction-PIN'] = pin;
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers, body: form });
  } catch {
    throw networkError();
  }
  return readResponse<T>(response);
}
