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

/** JSON request to a provider, classifying failures as definite (4xx) or unclear (everything else). */
export async function providerRequest<T>(provider: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
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
    const message = (body as { message?: string; responseMessage?: string } | null)?.message ?? (body as { responseMessage?: string } | null)?.responseMessage ?? `HTTP ${res.status}`;
    throw new ProviderError(provider, message, res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429, res.status);
  }
  return body as T;
}
