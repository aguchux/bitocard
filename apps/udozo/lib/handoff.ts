/**
 * Udozo's sign-in handoff (docs/UDOZO_SPINOFF_PLAN.md, step 3): one Udozo account works on udozo.com and every reseller
 * store, but each address keeps its own host-only session. A store's sign-in sends the shopper to udozo.com's
 * `/handoff/go?to=<store origin>&next=<path>`, which signs them in here if needed, asks the API for a one-time code
 * bound to that store, and sends them to `<store origin>/handoff#c=<code>&n=<path>`. No cookie is shared across sites.
 */

/**
 * Whether an origin can be handed a customer from here: an https origin with no path, user or query (plain http only
 * for localhost, in development), never this site itself. Which origins are Udozo's stores is the API's to say: it
 * refuses any other target.
 */
export function handoffTarget(value: string, self: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.origin !== value.replace(/\/$/, "")) return null;
  return url.origin === self ? null : url.origin;
}
