import { createHmac } from "node:crypto";

/**
 * Store traffic (`proxy.ts`): each page a shopper opens on a reseller's store is counted by the API without cookies or
 * anything kept about them (`StoreVisitsService`). Sent from this server with the shopper's address signed with
 * `STORE_SERVER_SECRET`, as for rate limits; the API ignores anything unsigned.
 */

/** BitoCard's own hosts are not a reseller's store (bitocard.com, its www, local development, Vercel previews). */
const ownHost = /^(?:(?:www\.)?bitocard\.com|localhost|127\.0\.0\.1|.*\.vercel\.app)$/;

/** The API call that counts this page view, or null when it is not one (not a page, not a reseller's store, not set up). */
export function visitRequest(request: { method: string; headers: Headers; nextUrl: { pathname: string; host: string } }, env: Record<string, string | undefined> = process.env, now = Date.now()) {
  const secret = env.STORE_SERVER_SECRET;
  if (!secret || request.method !== "GET") return null;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host).toLowerCase().replace(/:\d+$/, "");
  if (!host || ownHost.test(host) || request.nextUrl.pathname.startsWith("/preview")) return null;
  const ip = (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return null;
  const t = Math.floor(now / 1000);
  const base = env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? (env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return {
    url: `${base.replace(/\/+$/, "")}/v1/store/visits`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "bitocard-client": `t=${t},ip=${ip},v1=${createHmac("sha256", secret).update(`${t}.${ip}`).digest("hex")}` },
      body: JSON.stringify({ host, user_agent: (request.headers.get("user-agent") ?? "").slice(0, 512) }),
      signal: AbortSignal.timeout(3000),
    } satisfies RequestInit,
  };
}
