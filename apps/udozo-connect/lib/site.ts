/**
 * Udozo Connect's addresses, never from forwarded headers a proxy might let callers set. Pure, so pages, route
 * handlers and tests share them.
 */

/** This site (`CONNECT_URL`, else connect.udozo.com on Vercel, else localhost:3013). The handoff names it. */
export function siteOrigin() {
  return new URL(process.env.CONNECT_URL || (process.env.VERCEL ? "https://connect.udozo.com" : "http://localhost:3013")).origin;
}

/** udozo.com, where people sign in, check their identity, confirm their mobile and top up their wallet. */
export function udozoOrigin() {
  return new URL(process.env.UDOZO_URL || process.env.NEXT_PUBLIC_UDOZO_URL || (process.env.VERCEL ? "https://udozo.com" : "http://localhost:3007")).origin;
}

/** A page on udozo.com. */
export const udozoUrl = (path: string) => `${udozoOrigin()}${path}`;

/** Udozo's own API (`API_URL`, then the public address, then production on Vercel and the local API in development). */
export const productionApi = "https://api.udozo.com";
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? productionApi : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Only paths on this site are followed after signing in, never another site. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/") {
  const next = typeof value === "string" ? value : "";
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would become "//evil.com": refuse them anywhere.
  return next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}

/**
 * Where Sign in goes: udozo.com's handoff, which signs the person in there first if needed and sends them back to this
 * site's `/handoff` with a one-time code, landing on `next`.
 */
export function signInUrl(next: string) {
  const url = new URL("/handoff/go", udozoOrigin());
  url.searchParams.set("to", siteOrigin());
  url.searchParams.set("next", safeNext(next));
  return url.href;
}

/** This site's own sign-in address, which sends the browser on to udozo.com (`app/signin/route.ts`). */
export const signInPath = (next: string) => `/signin?next=${encodeURIComponent(safeNext(next))}`;
