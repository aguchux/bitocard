import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * DIDWW callback signatures: `X-DIDWW-Signature` is the hex HMAC-SHA1, keyed with the API key, of the callback address
 * (scheme, host, explicit port, path and query) followed by each parameter's name and value, sorted by name, with no
 * separators. For POST callbacks the parameters are the form fields.
 */
export function didwwSignatureValid(apiKey: string | undefined, url: string, params: Record<string, string>, signature: string | undefined) {
  if (!apiKey || !signature) return false;
  let data: string;
  try {
    data = normalizedUrl(url);
  } catch {
    return false;
  }
  for (const key of Object.keys(params).sort()) data += `${key}${params[key]}`;
  const expected = createHmac('sha1', apiKey).update(data).digest('hex');
  const given = signature.trim().toLowerCase();
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** `https://api.example.com/x?y=1` becomes `https://api.example.com:443/x?y=1`, as DIDWW signs it. */
function normalizedUrl(url: string) {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(/:$/, '');
  const port = parsed.port || (scheme === 'https' ? '443' : '80');
  const user = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
  const path = parsed.pathname === '/' && !url.replace(/^[a-z]+:\/\/[^/?#]*/i, '').startsWith('/') ? '' : parsed.pathname;
  return `${scheme}://${user}${parsed.hostname}:${port}${path}${parsed.search}${parsed.hash}`;
}

/** What an order callback is about: DIDWW's order ID and its new status. The reference is in our callback address. */
export function didwwNotice(params: Record<string, string>, reference: string | undefined) {
  const status = params.status?.trim().toLowerCase() || null;
  return {
    eventType: params.type && status ? `${params.type}.${status}`.slice(0, 100) : (params.type ?? null),
    reference: reference?.trim() || null,
    supplierTransactionId: params.id?.trim() || null,
  };
}
