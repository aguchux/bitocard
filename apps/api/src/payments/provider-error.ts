/**
 * A failed call to a payment provider. `definite` is true only when the provider clearly refused the request;
 * timeouts, network errors and server errors are unclear (the action may still have happened), so callers must
 * check the status later instead of treating them as failures.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly definite: boolean,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

const timeoutMs = 15_000;

type ErrorReply = {
  message?: string;
  responseMessage?: string;
  errorMessage?: string;
  errorCode?: string;
  error?: { message?: string } | string;
  failureReason?: { failureCode?: string; failureMessage?: string };
};

/**
 * What a provider said when it refused a request: the usual message fields (Stripe, Flutterwave, Monnify, pawaPay's
 * `failureReason` and `errorMessage`), else a short excerpt of the body, else the status. Never the request itself.
 */
export function errorText(body: unknown, text: string, status: number) {
  const reply = (body && typeof body === 'object' ? body : {}) as ErrorReply;
  const failure = reply.failureReason ? [reply.failureReason.failureCode, reply.failureReason.failureMessage].filter(Boolean).join(': ') : '';
  const found =
    reply.message ?? reply.responseMessage ?? reply.errorMessage ?? (typeof reply.error === 'string' ? reply.error : reply.error?.message) ?? (failure || reply.errorCode);
  if (found) return found.slice(0, 300);
  const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return excerpt ? `HTTP ${status}: ${excerpt}` : `HTTP ${status}`;
}

/**
 * Request to a provider with a JSON body (or a form body, `form`, as Stripe takes), classifying failures as definite
 * (4xx) or unclear (everything else).
 */
export async function providerRequest<T>(
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  const type = init.form ? 'application/x-www-form-urlencoded' : init.body !== undefined ? 'application/json' : null;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...(type ? { 'content-type': type } : {}), ...init.headers },
      body: init.form ? new URLSearchParams(init.form).toString() : init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(provider, `request failed: ${(error as Error).message}`, false);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ProviderError(provider, `unreadable response (HTTP ${res.status})`, false, res.status);
  }
  if (!res.ok) {
    const message = errorText(body, text, res.status);
    throw new ProviderError(provider, message, res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429, res.status);
  }
  return body as T;
}
