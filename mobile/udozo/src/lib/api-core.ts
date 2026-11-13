/**
 * How the app talks to Udozo's API, without React Native, so it runs under `node --test`.
 *
 * - Errors always come back as `{ error: { type, code, message, param?, request_id } }`; the app words its own
 *   message only for the network failing or an answer it cannot read.
 * - The customer's session goes in `BitoCard-Customer-Session` (kept in the phone's secure store, never logged).
 * - Every POST carries an `Idempotency-Key`. A money step makes its key once per attempt and passes it in, so a
 *   retried tap never pays twice; other POSTs get a fresh one.
 */

export const sessionHeader = 'BitoCard-Customer-Session';

export type ApiErrorBody = { error: { type: string; code: string; message: string; param?: string; request_id?: string } };

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param?: string;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.type = body.type;
    this.code = body.code;
    this.param = body.param;
    this.requestId = body.request_id;
  }
}

export const networkError = () =>
  new ApiError(0, { type: 'api_error', code: 'network_error', message: 'Udozo cannot be reached. Check your connection and try again.' });

const unreadable = (status: number) =>
  new ApiError(status, { type: 'api_error', code: 'api_error', message: 'Something went wrong on our side. Try again in a minute.' });

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  session?: string | null;
  /** A money step's own key, kept until it succeeds or is refused. */
  idempotencyKey?: string;
  /** The app says it is the app on every call: `ios/0.1.0` or `android/0.1.0` (the API counts its sign-ups apart). */
  app?: string;
  /** Any other headers the call needs (a visitor's assistant token). */
  headers?: Record<string, string>;
};

/** The header the app names itself in, as the API reads it (`Udozo-App`). */
export const appHeader = 'Udozo-App';
export const appTag = (platform: 'ios' | 'android', version: string) => `${platform}/${version}`;

/** The URL and fetch options for a call; `newKey` makes an Idempotency-Key when a POST has none. */
export function buildRequest(baseUrl: string, path: string, options: RequestOptions, newKey: () => string) {
  if (!path.startsWith('/v1/')) throw new Error(`Not an API path: ${path}`);
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.session) headers[sessionHeader] = options.session;
  if (options.app) headers[appHeader] = options.app;
  if (options.headers) Object.assign(headers, options.headers);
  if (method === 'POST') headers['Idempotency-Key'] = options.idempotencyKey ?? newKey();
  return {
    url: `${baseUrl.replace(/\/+$/, '')}${path}`,
    init: { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
  };
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as ApiErrorBody | null)?.error;
  return !!error && typeof error.code === 'string' && typeof error.message === 'string';
}

/** The answer's JSON, or the API's error thrown as an `ApiError`. A 204 is `undefined`. */
export async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw unreadable(response.status);
  }
  if (response.ok) return body as T;
  if (isErrorBody(body)) throw new ApiError(response.status, body.error);
  throw unreadable(response.status);
}

/** Calls the API. A network failure becomes `network_error`; the session is never logged. */
export async function request<T>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  options: RequestOptions,
  newKey: () => string,
): Promise<T> {
  const { url, init } = buildRequest(baseUrl, path, options, newKey);
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw networkError();
  }
  return readResponse<T>(response);
}
