import { createHmac } from "node:crypto";
import { optionalAllowed, readConsent } from "./cookie-consent";

/**
 * Where udozo.com's visitors come from (8 November 2026, the owner's request). The proxy reports each landing from
 * outside (another site, an ad, a campaign link, or typed in) to the API after the response, signed with
 * `STORE_SERVER_SECRET`, which counts it for the day by where it came from and the kind of page: no cookie, and nothing
 * about the visitor kept. Only with Accept all does this site also keep where the visit came from (`udz_src`, 30 days),
 * so an account made later can be credited to it (`creditSignup`).
 */

/** The query parameters that say where a visit came from: campaign tags and ad networks' click ids. */
export const sourceParamPattern = /^(utm_(source|medium|campaign|content|term)|gclid|gbraid|wbraid|gad_source|dclid|msclkid|ttclid|twclid|li_fat_id|sccid|epik|yclid|fbclid|igshid)$/i;

export const sourceCookie = "udz_src";
export const sourceCookieMaxAge = 30 * 24 * 60 * 60;

/** Pages that are never a landing: this site's own routes, sign-in round trips, previews, files. */
const notLandings = /^\/(api|auth|img|seller-card|brand-card|market|handoff|home-preview|store)(\/|$)|\.(xml|txt|json|js|css|map)$/;

const ownHost = (host: string, own: string) => host === own || host.endsWith(`.${own}`) || host === "localhost" || host.endsWith(".vercel.app");

/** The landing address's source parameters: tags kept (short), click ids only as present, never their value. */
export function sourceParamsOf(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of search) {
    const name = key.toLowerCase();
    if (!sourceParamPattern.test(name) || !value) continue;
    out[name] = name.startsWith("utm_") ? value.slice(0, 100) : "1";
  }
  return out;
}

type Incoming = { method: string; headers: Headers; nextUrl: { pathname: string; searchParams: URLSearchParams } };
export type Landing = { path: string; params: Record<string, string>; referrer: string | null; direct: boolean };

/**
 * The landing this request is, or null when it is not one: only a page the browser navigated to (never a prefetch,
 * a client-side navigation or a file), arriving from another site, with source tags, or typed in or bookmarked
 * (`Sec-Fetch-Site: none`). Moving around udozo.com is never a landing.
 */
export function landingOf(request: Incoming, siteHost: string): Landing | null {
  const header = (name: string) => request.headers.get(name);
  if (request.method !== "GET" || notLandings.test(request.nextUrl.pathname)) return null;
  if (header("rsc") || header("next-router-prefetch") || /prefetch/i.test(`${header("purpose") ?? ""}${header("sec-purpose") ?? ""}`)) return null;
  const dest = header("sec-fetch-dest");
  if (dest ? dest !== "document" : !/text\/html/.test(header("accept") ?? "")) return null;
  const params = sourceParamsOf(request.nextUrl.searchParams);
  let referrer = header("referer");
  try {
    if (referrer && ownHost(new URL(referrer).hostname.toLowerCase(), siteHost)) referrer = null;
  } catch {
    referrer = null;
  }
  const site = header("sec-fetch-site");
  const tagged = Object.keys(params).length > 0;
  if (!tagged && !referrer && site !== "none" && site !== "cross-site") return null;
  return { path: request.nextUrl.pathname.slice(0, 500), params, referrer: referrer ? originOf(referrer) : null, direct: !tagged && !referrer };
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, as the API checks it. */
export function trafficSignature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** The API call that counts a landing, or null without the shared secret. The shopper's address is signed as for rate limits. */
export function visitRequest(landing: Landing, request: Incoming, env: Record<string, string | undefined> = process.env, now = Date.now()) {
  const secret = env.STORE_SERVER_SECRET;
  if (!secret) return null;
  const base = env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? (env.VERCEL ? "https://api.udozo.com" : "http://localhost:3001");
  const body = JSON.stringify({ path: landing.path, params: landing.params, referrer: landing.referrer, user_agent: (request.headers.get("user-agent") ?? "").slice(0, 500) });
  const t = Math.floor(now / 1000);
  const ip = (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return {
    url: `${base.replace(/\/+$/, "")}/v1/traffic/visits`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "udozo-traffic-signature": trafficSignature(secret, body, t),
        ...(/^[0-9a-fA-F:.]{2,45}$/.test(ip) ? { "bitocard-client": `t=${t},ip=${ip},v1=${createHmac("sha256", secret).update(`${t}.${ip}`).digest("hex")}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(3000),
    } satisfies RequestInit,
  };
}

export type KeptSource = { path: string; params: Record<string, string>; referrer: string | null };

/** What `udz_src` holds, or null when it holds nothing usable. */
export function readSource(value: string | undefined): KeptSource | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<KeptSource>;
    if (typeof parsed.path !== "string" || !parsed.path.startsWith("/")) return null;
    const params: Record<string, string> = {};
    for (const [key, item] of Object.entries(parsed.params ?? {})) if (sourceParamPattern.test(key) && typeof item === "string") params[key] = item.slice(0, 100);
    return { path: parsed.path.slice(0, 500), params, referrer: typeof parsed.referrer === "string" ? parsed.referrer.slice(0, 1000) : null };
  } catch {
    return null;
  }
}

/**
 * What the proxy does with `udz_src` on a landing: with Accept all, keep a landing from somewhere (the latest one), or
 * a direct one when nothing is kept yet; without it, remove any kept. Null: leave it as it is.
 */
export function sourceCookieChange(landing: Landing | null, cookieHeader: string | null, kept: string | undefined): { set: string } | { remove: true } | null {
  if (!optionalAllowed(readConsent(cookieHeader))) return kept ? { remove: true } : null;
  if (!landing || (landing.direct && readSource(kept))) return null;
  return { set: JSON.stringify({ path: landing.path, params: landing.params, referrer: landing.referrer }) };
}

/** Only a referrer's origin is kept, never its path or query. */
function originOf(referrer: string) {
  try {
    const url = new URL(referrer);
    return url.protocol === "android-app:" ? `android-app://${url.hostname}` : url.origin;
  } catch {
    return null;
  }
}
