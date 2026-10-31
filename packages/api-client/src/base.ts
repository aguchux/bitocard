import { type BaseQueryFn, createApi, type FetchArgs, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

/** BitoCard's error shape: `{ error: { type, code, message, param?, request_id } }`. */
export type ApiError = { status: number; type: string; code: string; message: string; param?: string; requestId?: string };

/**
 * Where the API lives: NEXT_PUBLIC_API_URL (for example http://localhost:3001 in development), else production:
 * api.bitocard.com, api.afrippa.com for Afrippa's admin (its own host, so its admin cookie stays same-site), or
 * api.udozo.com for Udozo's apps (its own instance of the API, `setApiProduct('udozo')`).
 */
// eslint-disable-next-line @typescript-eslint/no-use-before-define -- read when called, long after it is set
export const apiBaseUrl = () => (process.env.NEXT_PUBLIC_API_URL ?? (adminProduct === 'afrippa' ? 'https://api.afrippa.com' : apiProduct === 'udozo' ? 'https://api.udozo.com' : 'https://api.bitocard.com')).replace(/\/$/, '');

/**
 * Which product's API instance the apps call (docs/UDOZO_SPINOFF_PLAN.md): Udozo's apps set `udozo` once at start-up,
 * so production calls go to api.udozo.com. The paths are BitoCard's own (the same code runs there); nothing is rewritten.
 */
let apiProduct: 'bitocard' | 'udozo' = 'bitocard';
export function setApiProduct(product: 'bitocard' | 'udozo') {
  apiProduct = product;
}

/**
 * Headers SHQ adds to every request: which of the person's reseller accounts it acts for (`BitoCard-Reseller`) and
 * sandbox mode (`BitoCard-Mode: test`). The admin app never sets them. Reset the API cache after changing either.
 */
const requestContext: { reseller?: string; mode?: 'live' | 'test' } = {};
export function setRequestContext(next: { reseller?: string | null; mode?: 'live' | 'test' }) {
  if ('reseller' in next) requestContext.reseller = next.reseller ?? undefined;
  if ('mode' in next) requestContext.mode = next.mode;
}

/**
 * Which product's admin routes the admin hooks call. BitoCard's admin app leaves it at `bitocard` (`/v1/admin/...`);
 * Afrippa's (admin.afrippa.com) sets `afrippa` once at start-up, so the same hooks and screens (signing in, the session
 * gate, step-up, the inbox) call Afrippa's own admin realm (`/v1/afrippa/admin/...`). Nothing else is rewritten.
 */
let adminProduct: 'bitocard' | 'afrippa' = 'bitocard';
export function setAdminProduct(product: 'bitocard' | 'afrippa') {
  adminProduct = product;
}
/** A path as the current admin product calls it. */
export const adminPath = (path: string) => (adminProduct === 'afrippa' && path.startsWith('/v1/admin/') ? `/v1/afrippa${path.slice(3)}` : path);

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * A raw request to the API with the same cookies and account headers as the RTK Query client: for files (a chat's
 * photos and PDFs, read as blobs because an `<img>` cannot name the account) and multipart uploads.
 */
export function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  return fetch(`${apiBaseUrl()}${adminPath(path)}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(requestContext.reseller ? { 'bitocard-reseller': requestContext.reseller } : {}),
      ...(requestContext.mode === 'test' ? { 'bitocard-mode': 'test' } : {}),
      ...(method === 'POST' ? { 'idempotency-key': newKey() } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}


/**
 * The product's name as its apps show it: Afrippa in Afrippa's admin, Udozo in Udozo's apps, else BitoCard. Shared
 * screens name the product with it, never a written-in "BitoCard".
 */
export const productName = (): 'BitoCard' | 'Udozo' | 'Afrippa' => (adminProduct === 'afrippa' ? 'Afrippa' : apiProduct === 'udozo' ? 'Udozo' : 'BitoCard');

/** Turns any failure into an ApiError, so screens show the API's own message. */
export function toApiError(status: number | string, data: unknown): ApiError {
  const body = (data as { error?: { type?: string; code?: string; message?: string; param?: string; request_id?: string } } | undefined)?.error;
  if (body?.code && body.message) {
    return { status: typeof status === 'number' ? status : 0, type: body.type ?? 'api_error', code: body.code, message: body.message, param: body.param, requestId: body.request_id };
  }
  // Afrippa's admin and Udozo's apps name their own product.
  const product = productName();
  if (status === 'FETCH_ERROR') return { status: 0, type: 'network_error', code: 'network_error', message: `Could not reach ${product}. Check your connection and try again.` };
  if (status === 'TIMEOUT_ERROR') return { status: 0, type: 'network_error', code: 'timeout', message: `${product} took too long to answer. Try again.` };
  return { status: typeof status === 'number' ? status : 0, type: 'api_error', code: 'unexpected', message: 'Something went wrong. Try again.' };
}

/**
 * Reads give up after this long, so a stalled connection shows an error with Retry instead of a spinner for ever.
 * Changes have no limit: some (a supplier's catalogue sync) legitimately take minutes.
 */
export const readTimeoutMs = 30_000;

/**
 * Admin step-up: a sensitive or money action outside the session's 5-minute window answers `step_up_required`. The
 * admin app registers a handler that asks for the authenticator code and opens the window (true) or is cancelled
 * (false); the request is then sent once more. Requests refused together share one prompt.
 */
let stepUpHandler: (() => Promise<boolean>) | null = null;
let stepUpPending: Promise<boolean> | null = null;

export function setStepUpHandler(handler: (() => Promise<boolean>) | null) {
  stepUpHandler = handler;
}

function askForStepUp() {
  if (!stepUpHandler) return Promise.resolve(false);
  stepUpPending ??= stepUpHandler().finally(() => {
    stepUpPending = null;
  });
  return stepUpPending;
}

const needsStepUp = (status: unknown, data: unknown) => status === 403 && (data as { error?: { code?: string } } | undefined)?.error?.code === 'step_up_required';

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
    const asked: FetchArgs = typeof args === 'string' ? { url: args } : { ...args };
    const original: FetchArgs = { ...asked, url: adminPath(asked.url) };
    const method = (original.method ?? 'GET').toUpperCase();
    const send = () => {
      const request: FetchArgs = {
        ...original,
        headers: {
          accept: 'application/json',
          ...(requestContext.reseller ? { 'bitocard-reseller': requestContext.reseller } : {}),
          ...(requestContext.mode === 'test' ? { 'bitocard-mode': 'test' } : {}),
          ...(original.headers as Record<string, string> | undefined),
          ...(method === 'POST' ? { 'idempotency-key': newKey() } : {}),
        },
      };
      if (method === 'GET' && request.timeout === undefined) request.timeout = readTimeoutMs;
      return client(baseUrl())(request, api, extra);
    };
    const request = original;
    let result = await send();
    // Outside the step-up window: ask for the authenticator code, then try once more (a new request, a new key).
    if (result.error && needsStepUp(result.error.status, result.error.data) && !original.url.includes('/auth/') && (await askForStepUp())) result = await send();
    if (result.error) {
      // Runs only on a request, long after the API slice below exists.
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
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
  'Invoice',
  'Reseller',
  'Verification',
  'Order',
  'Supplier',
  'SupplierFunding',
  'Report',
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
  'Esim',
  'Vpn',
  'TopUp',
  'ReservedAccount',
  'BankAccount',
  'Payout',
  'Subscription',
  'Store',
  'Domain',
  'ApiKey',
  'WebhookEndpoint',
  'Event',
  'Team',
  'Pricing',
  'Catalogue',
  'Settings',
  'IdentityCheck',
  'StoreCustomer',
  'ResellerIntegration',
  'Fee',
  'FeeRule',
  'Chargeback',
  'Dispute',
  'SupportTicket',
  'SupportChat',
  'SupportAi',
  'SupportBot',
  'Stock',
  'Number',
  'Crypto',
  'P2p',
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
  // BitoCard Shop (admin)
  'ClassifiedListing',
  'ClassifiedReport',
  'ClassifiedSeller',
  'ClassifiedCategory',
  'ClassifiedOrder',
  'ClassifiedSettings',
  'ResaleListing',
  'ResaleRule',
  'ResaleSupplier',
  'ResaleOrder',
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
