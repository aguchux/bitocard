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
  if (status === 'TIMEOUT_ERROR') return { status: 0, type: 'network_error', code: 'timeout', message: 'BitoCard took too long to answer. Try again.' };
  return { status: typeof status === 'number' ? status : 0, type: 'api_error', code: 'unexpected', message: 'Something went wrong. Try again.' };
}

/**
 * Reads give up after this long, so a stalled connection shows an error with Retry instead of a spinner for ever.
 * Changes have no limit: some (a supplier's catalogue sync) legitimately take minutes.
 */
export const readTimeoutMs = 30_000;

/**
 * Sends cookies (the admin session cookie is shared on .bitocard.com), adds the Idempotency-Key every POST needs,
 * and returns ApiError on failure. A 401 outside sign-in means the session ended while the page was open: the session
 * is checked again, so the app's gate sends the person to sign in instead of leaving every panel showing an error.
 */
export function createBaseQuery(baseUrl: () => string = apiBaseUrl): BaseQueryFn<string | FetchArgs, unknown, ApiError> {
  const clients = new Map<string, ReturnType<typeof fetchBaseQuery>>();
  const client = (url: string) => {
    let raw = clients.get(url);
    if (!raw) clients.set(url, (raw = fetchBaseQuery({ baseUrl: url, credentials: 'include' })));
    return raw;
  };
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
    if (method === 'GET' && request.timeout === undefined) request.timeout = readTimeoutMs;
    const result = await client(baseUrl())(request, api, extra);
    if (result.error) {
      if (result.error.status === 401 && !request.url.includes('/auth/')) api.dispatch(bitocardApi.util.invalidateTags(['Session']));
      return { error: toApiError(result.error.status, result.error.data), meta: result.meta };
    }
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
  'Chargeback',
  'Dispute',
  'Stock',
  'Number',
  // Both apps
  'Notification',
  'SupplierNotification',
  'Device',
  'NotificationPreference',
  // Storefront Manager (admin)
  'Storefront',
  'Brand',
  'Media',
  'BrandRegistry',
  'Email',
  'Category',
] as const;

/**
 * How long a screen's data stays cached after the last screen using it closes, so going back is instant.
 * Anything older than `revalidateAfterSeconds` is shown at once and refreshed in the background.
 */
export const keepUnusedSeconds = 300;
export const revalidateAfterSeconds = 30;

/**
 * The one API slice. Endpoint modules add to it with `injectEndpoints`, so every app and package shares one cache.
 * Stale while revalidate: cached data shows straight away, and is refreshed when it is older than 30 seconds on
 * opening a screen, when the tab comes back into focus and when the connection returns (`setupListeners`).
 */
export const bitocardApi = createApi({
  reducerPath: 'bitocardApi',
  baseQuery: createBaseQuery(),
  tagTypes,
  keepUnusedDataFor: keepUnusedSeconds,
  refetchOnMountOrArgChange: revalidateAfterSeconds,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
