import { type NextRequest, NextResponse } from "next/server";
import { apiUrl } from "@/lib/api";

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
  `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>This listing is no longer on BitoCard Shop</title></head><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#fcfdff;color:#070f4c"><main style="max-width:28rem;margin:0 auto;padding:4rem 1rem;text-align:center"><h1 style="font-size:1.5rem">This listing is no longer on BitoCard Shop</h1><p style="color:#414f77">It was sold, or the seller took it down.</p><a href="/${cc}" style="display:inline-block;margin-top:1rem;padding:0.75rem 1.25rem;border-radius:0.75rem;background:#070f4c;color:#fff;font-weight:700;text-decoration:none">See what is for sale</a></main></body></html>`;

/**
 * Listing pages that are gone answer 410 Gone (search engines drop them faster than a 404); everything else goes on to
 * the page. Only listing addresses (`/ng/l/<number>-<slug>`) are checked, never their Safe pay pages.
 */
export async function proxy(request: NextRequest) {
  const match = /^\/([a-z]{2})\/l\/(\d{1,15})(?:-[a-z0-9-]*)?$/.exec(request.nextUrl.pathname);
  if (!match || request.method !== "GET" || !(await listingGone(match[1]!, match[2]!))) return NextResponse.next();
  return new NextResponse(goneHtml(match[1]!), { status: 410, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-robots-tag": "noindex" } });
}

export const config = { matcher: ["/:cc/l/:listing"] };
