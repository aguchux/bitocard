/** A chain node or indexer could not answer, or answered with something unusable. Never a reason to mark a transfer failed. */
export class ChainUnavailable extends Error {
  override name = 'ChainUnavailable';
}

const timeoutMs = 20_000;

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (error) {
    throw new ChainUnavailable(`${new URL(url).host} unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  const text = await res.text();
  if (!res.ok) throw new ChainUnavailable(`${new URL(url).host} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Esplora answers some calls (broadcast, tip height) with plain text.
    return text as T;
  }
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return getJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

export async function postText(url: string, body: string) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (error) {
    throw new ChainUnavailable(`${new URL(url).host} unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  return { status: res.status, text: await res.text() };
}
