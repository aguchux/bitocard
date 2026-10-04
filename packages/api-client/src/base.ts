import { type BaseQueryFn, createApi, type FetchArgs, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

/** BitoCard's error shape: `{ error: { type, code, message, param?, request_id } }`. */
export type ApiError = { status: number; type: string; code: string; message: string; param?: string; requestId?: string };

/** Where the API lives: NEXT_PUBLIC_API_URL (for example http://localhost:3001 in development), else production. */
export const apiBaseUrl = () => (process.env.NEXT_PUBLIC_API_URL ?? 'https://api.bitocard.com').replace(/\/$/, '');

/**
 * Headers SHQ adds to every request: which of the person's reseller accounts it acts for (`BitoCard-Reseller`) and
 * sandbox mode (`BitoCard-Mode: test`). The admin app never sets them. Reset the API cache after changing either.
 */
const requestContext: { reseller?: string; mode?: 'live' | 'test' } = {};
export function setRequestContext(next: { reseller?: string | null; mode?: 'live' | 'test' }) {
  if ('reseller' in next) requestContext.reseller = next.reseller ?? undefined;
  if ('mode' in next) requestContext.mode = next.mode;
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Turns any failure into an ApiError, so screens show the API's own message. */
export function toApiError(status: number | string, data: unknown): ApiError {
  const body = (data as { error?: { type?: string; code?: string; message?: string; param?: string; request_id?: string } } | undefined)?.error;
  if (body?.code && body.message) {
    return { status: typeof status === 'number' ? status : 0, type: body.type ?? 'api_error', code: body.code, message: body.message, param: body.param, requestId: body.request_id };
  }
  if (status === 'FETCH_ERROR') return { status: 0, type: 'network_error', code: 'network_error', message: 'Could not reach BitoCard. Check your connection and try again.' };
  return { status: typeof status === 'number' ? status : 0, type: 'api_error', code: 'unexpected', message: 'Something went wrong. Try again.' };
}

/**
 * Sends cookies (the admin session cookie is shared on .bitocard.com), adds the Idempotency-Key every POST needs,
 * and returns ApiError on failure.
 */
export function createBaseQuery(baseUrl: () => string = apiBaseUrl): BaseQueryFn<string | FetchArgs, unknown, ApiError> {
  return async (args, api, extra) => {
    const request: FetchArgs = typeof args === 'string' ? { url: args } : { ...args };
    const method = (request.method ?? 'GET').toUpperCase();
    request.headers = {
      accept: 'application/json',
      ...(requestContext.reseller ? { 'bitocard-reseller': requestContext.reseller } : {}),
      ...(requestContext.mode === 'test' ? { 'bitocard-mode': 'test' } : {}),
      ...(request.headers as Record<string, string> | undefined),
      ...(method === 'POST' ? { 'idempotency-key': newKey() } : {}),
    };
    const raw = fetchBaseQuery({ baseUrl: baseUrl(), credentials: 'include' });
    const result = await raw(request, api, extra);
    if (result.error) return { error: toApiError(result.error.status, result.error.data), meta: result.meta };
    return { data: result.data, meta: result.meta };
  };
}

/** Tag types shared by every endpoint module, so a change on one screen refreshes the others. */
export const tagTypes = [
  'Session',
  'Overview',
  'Reseller',
  'Verification',
  'Order',
  'Supplier',
  'Product',
  'PricingRule',
  'Switch',
  'Country',
  'Activity',
  'Plan',
  'Integration',
  'IntegrationOffer',
  'Connection',
  // Reseller (SHQ)
  'Account',
  'Wallet',
  'TopUp',
  'ReservedAccount',
  'BankAccount',
  'Payout',
  'Subscription',
  'Store',
  'ApiKey',
  'WebhookEndpoint',
  'Event',
  'Team',
  'Pricing',
  'Catalogue',
  'Settings',
  'IdentityCheck',
  'ResellerIntegration',
  'Fee',
  'FeeRule',
] as const;

/** The one API slice. Endpoint modules add to it with `injectEndpoints`, so every app and package shares one cache. */
export const bitocardApi = createApi({
  reducerPath: 'bitocardApi',
  baseQuery: createBaseQuery(),
  tagTypes,
  endpoints: () => ({}),
});
