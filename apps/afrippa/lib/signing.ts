import "server-only";
import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";

/**
 * Afrippa's server signs every request it sends to Afrippa's routes (the API's `src/afrippa/signature.ts`):
 *
 *   Afrippa-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<METHOD>.<path and query>.<hex SHA-256 of the body>">
 *
 * keyed with `AFRIPPA_SERVER_SECRET` (never sent to browsers). Without it the API answers every Afrippa route as unknown.
 */
export const signatureHeader = "afrippa-signature";
/** The visitor's address, signed with the same secret (the API's `client-ip.ts`), so each visitor is rate limited alone. */
export const clientHeader = "bitocard-client";

const secret = () => process.env.AFRIPPA_SERVER_SECRET;

export function signRequest(key: string, request: { method: string; url: string; body?: string }, now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  const bodyHash = createHash("sha256").update(request.body ?? "").digest("hex");
  const v1 = createHmac("sha256", key).update(`${t}.${request.method.toUpperCase()}.${request.url}.${bodyHash}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** The signature header for a request to `url` (path and query), or none without the secret. */
export function signatureFor(method: string, url: string, body?: string, now = Date.now()): Record<string, string> {
  const key = secret();
  return key ? { [signatureHeader]: signRequest(key, { method, url, body }, now) } : {};
}

/**
 * The visitor's address, signed. It comes from the platform (`x-real-ip`, else the first `x-forwarded-for`, which
 * Vercel sets and callers cannot); outside a request (builds, cached reads) there is none.
 */
export async function visitorHeader(now = Date.now()): Promise<Record<string, string>> {
  const key = secret();
  if (!key) return {};
  let ip = "";
  try {
    const list = await headers();
    ip = (list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  } catch {
    return {};
  }
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return {};
  const t = Math.floor(now / 1000);
  return { [clientHeader]: `t=${t},ip=${ip},v1=${createHmac("sha256", key).update(`${t}.${ip}`).digest("hex")}` };
}
