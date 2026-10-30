import { type NextRequest, NextResponse } from "next/server";
import { apiUrl } from "@/lib/api";
import { siteOrigin } from "@/lib/site";
import { type SiteHost, type StoreRoute, classifyHost, storeHeader, storeOriginHeader, storePathHeader, storeRoute, subdomainOrigin } from "@/lib/store-host";
import { previewHeader, previewToken } from "@/lib/theme-preview";

/** Listings the API says are gone (410), and those it does not, for a minute per instance. */
const seen = new Map<string, { gone: boolean; at: number }>();
const rememberMs = 60_000;
const rememberAtMost = 2000;

/** Whether a listing is gone for good: sold over 30 days ago, expired, removed. Unclear (the API unreachable) is not gone. */
export async function listingGone(country: string, ref: string, now = Date.now()) {
  const key = `${country}:${ref}`;
  const known = seen.get(key);
  if (known && now - known.at < rememberMs) return known.gone;
  let gone = false;
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/listings/${ref}?country=${country.toUpperCase()}`), { signal: AbortSignal.timeout(3000) });
    gone = res.status === 410;
  } catch {
    return false;
  }
  if (seen.size >= rememberAtMost) seen.clear();
  seen.set(key, { gone, at: now });
  return gone;
}

const goneHtml = (cc: string) =>
  `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>This listing is no longer on Udozo</title></head><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#fcfdff;color:#070f4c"><main style="max-width:28rem;margin:0 auto;padding:4rem 1rem;text-align:center"><h1 style="font-size:1.5rem">This listing is no longer on Udozo</h1><p style="color:#414f77">It was sold, or the seller took it down.</p><a href="/${cc}" style="display:inline-block;margin-top:1rem;padding:0.75rem 1.25rem;border-radius:0.75rem;background:#070f4c;color:#fff;font-weight:700;text-decoration:none">See what is for sale</a></main></body></html>`;

/** Headers only this proxy may set: whatever the browser sent under these names is removed from every request. */
function cleaned(request: NextRequest) {
  const forwarded = new Headers(request.headers);
  for (const name of [previewHeader, storeHeader, storeOriginHeader, storePathHeader]) forwarded.delete(name);
  return forwarded;
}

/**
 * Passes an admin's theme preview (`?theme_preview=<token>`, on any page) to the root layout as a request header, so it
 * shows the draft theme; a header the browser sent itself is never passed on. The API checks the token either way.
 */
function withPreview(request: NextRequest) {
  const forwarded = cleaned(request);
  const token = previewToken(request.nextUrl.searchParams.get("theme_preview"));
  if (token) forwarded.set(previewHeader, token);
  return NextResponse.next({ request: { headers: forwarded } });
}

// ---- Resellers' stores ----

type Found = (StoreRoute & { origin: string }) | "missing" | "unreachable";

/** Stores found by host, for a minute per instance (as the API caches them); an unreachable API is never remembered. */
const stores = new Map<string, { found: Found; at: number }>();

async function lookup<T>(path: string): Promise<T | "missing" | "unreachable"> {
  try {
    const res = await fetch(apiUrl(path), { signal: AbortSignal.timeout(3000) });
    if (res.status === 404) return "missing";
    return res.ok ? ((await res.json()) as T) : "unreachable";
  } catch {
    return "unreachable";
  }
}

/** The published store a host serves: a sandbox subdomain, or a reseller's own active domain. */
export async function storeFor(host: Exclude<SiteHost, { kind: "marketplace" }>, now = Date.now()): Promise<Found> {
  const key = host.kind === "subdomain" ? `s:${host.subdomain}` : `d:${host.domain}`;
  const known = stores.get(key);
  if (known && now - known.at < rememberMs) return known.found;
  let subdomain = host.kind === "subdomain" ? host.subdomain : null;
  if (host.kind === "domain") {
    const domain = await lookup<{ subdomain: string }>(`/v1/storefronts/domains/${encodeURIComponent(host.domain)}`);
    if (typeof domain === "string") return remember(key, domain, now);
    subdomain = domain.subdomain;
  }
  const store = await lookup<StoreRoute>(`/v1/storefronts/${encodeURIComponent(subdomain!)}`);
  if (typeof store === "string") return remember(key, store, now);
  const origin = host.kind === "subdomain" ? subdomainOrigin(store.subdomain, siteOrigin()) : `https://${host.domain}`;
  return remember(key, { subdomain: store.subdomain, checkout_mode: store.checkout_mode, domain: store.domain, origin }, now);
}

function remember(key: string, found: Found, now: number) {
  if (found === "unreachable") return found;
  if (stores.size >= rememberAtMost) stores.clear();
  stores.set(key, { found, at: now });
  return found;
}

const page = (title: string, text: string, status: number) =>
  new NextResponse(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#fcfdff;color:#070f4c"><main style="max-width:28rem;margin:0 auto;padding:4rem 1rem;text-align:center"><h1 style="font-size:1.5rem">${title}</h1><p style="color:#414f77">${text}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 404 ? "public, max-age=60" : "no-store", "x-robots-tag": "noindex" } },
  );

/** A store's request: its pages under `/store/<subdomain>`, told which store and its origin; a live store's subdomain goes to its domain. */
async function storeRequest(request: NextRequest, host: Exclude<SiteHost, { kind: "marketplace" }>) {
  const store = await storeFor(host);
  if (store === "missing") return page("This store is not open", "Check the address, or shop on Udozo.", 404);
  if (store === "unreachable") return page("This store cannot be reached right now", "Try again in a minute.", 503);
  const route = storeRoute(host, store, request.nextUrl.pathname, request.nextUrl.search);
  if ("redirect" in route) return NextResponse.redirect(route.redirect, 308);
  const forwarded = cleaned(request);
  forwarded.set(storeHeader, store.subdomain);
  forwarded.set(storeOriginHeader, store.origin);
  forwarded.set(storePathHeader, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.rewrite(new URL(route.rewrite, request.url), { request: { headers: forwarded } });
}

/**
 * Every request starts here. A reseller's store (its sandbox subdomain or its own domain) is served from `/store/…`,
 * which udozo.com itself never serves. On udozo.com, listing pages that are gone answer 410 Gone (search engines drop
 * them faster than a 404); everything else goes on to the page. Only listing addresses (`/ng/l/<number>-<slug>`) are
 * checked, never their Safe pay pages.
 */
export async function proxy(request: NextRequest) {
  const host = classifyHost(request.headers.get("host") ?? request.nextUrl.host, siteOrigin());
  if (host.kind !== "marketplace") return storeRequest(request, host);
  if (request.nextUrl.pathname === "/store" || request.nextUrl.pathname.startsWith("/store/")) return page("Page not found", "There is nothing here.", 404);
  const match = /^\/([a-z]{2})\/l\/(\d{1,15})(?:-[a-z0-9-]*)?$/.exec(request.nextUrl.pathname);
  if (!match || request.method !== "GET" || !(await listingGone(match[1]!, match[2]!))) return withPreview(request);
  return new NextResponse(goneHtml(match[1]!), { status: 410, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-robots-tag": "noindex" } });
}

// Every page and route handler (never `_next`'s files or this site's static files), so the headers above can never be
// sent around the proxy, and every store's address is routed. robots.txt and the sitemaps go through it too.
export const config = { matcher: ["/((?!_next/|flags/|sw\.js|favicon\.ico|icon|apple-icon|.*\.(?:png|svg|webp|jpg|ico|json)$).*)"] };
