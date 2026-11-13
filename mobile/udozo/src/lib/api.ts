import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { appTag, networkError, readResponse, request, type RequestOptions } from '@/lib/api-core';
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

/** A file sent as multipart (a chat photo): the session and the app's tag as for any call; the answer read the same way. */
export async function apiUpload<T>(path: string, form: FormData) {
  const session = await readSession();
  const headers: Record<string, string> = { Accept: 'application/json', 'Udozo-App': app, 'Idempotency-Key': newIdempotencyKey() };
  if (session) headers['BitoCard-Customer-Session'] = session;
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers, body: form });
  } catch {
    throw networkError();
  }
  return readResponse<T>(response);
}

/**
 * A large file sent as multipart with its progress (a listing's video): as `apiUpload`, through XMLHttpRequest, which
 * says how much has gone (`onProgress`, 0 to 100). `abort` stops it; a stopped or failed send is `network_error`.
 */
export function apiUploadWithProgress<T>(path: string, form: FormData, onProgress: (percent: number) => void) {
  const request = new XMLHttpRequest();
  const done = (async () => {
    const session = await readSession();
    return new Promise<T>((resolve, reject) => {
      request.open('POST', `${apiUrl}${path}`);
      request.setRequestHeader('Accept', 'application/json');
      request.setRequestHeader('Udozo-App', app);
      request.setRequestHeader('Idempotency-Key', newIdempotencyKey());
      if (session) request.setRequestHeader('BitoCard-Customer-Session', session);
      request.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
      request.onerror = () => reject(networkError());
      request.onabort = () => reject(networkError());
      request.onload = () => {
        const text = request.responseText;
        const response = { status: request.status, ok: request.status >= 200 && request.status < 300, json: async () => JSON.parse(text) } as Response;
        readResponse<T>(response).then(resolve, reject);
      };
      request.send(form);
    });
  })();
  return { done, abort: () => request.abort() };
}

/** An image the API serves only to the signed-in customer (a chat's photos): its address with the session to send. */
export function privateImage(path: string, session: string | null) {
  return { uri: `${apiUrl}${path}`, headers: session ? { 'BitoCard-Customer-Session': session, 'Udozo-App': app } : undefined };
}
