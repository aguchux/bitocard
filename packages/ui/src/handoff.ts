import { appUrl } from "./site";

/**
 * The sign-in handoff between BitoCard's own sites: bitocard.com, its country stores (ng.bitocard.com…) and BitoCard Shop
 * (shop.bitocard.com) share one customer account but each keeps its own session cookie. So that a site can offer
 * "Continue as Adaeze" before anyone clicks, the site a customer signs in on also sets `bc_signed_in` across the parent
 * domain: their first name and the site they are signed in on, nothing else. It is not a credential: continuing still
 * goes through a one-time code from that site (`/handoff/go`), so a forged cookie only changes a button's words.
 * Server-side only (httpOnly); resellers' stores never set or read it.
 */
export const signedInCookie = "bc_signed_in";
export const signedInMaxAge = 60 * 60 * 24 * 30;

export type SignedIn = { name: string; origin: string };

/** bitocard.com (or the configured store address) and BitoCard Shop, as URLs. */
function bases() {
  return { store: new URL(appUrl("storefront")), shop: new URL(appUrl("shop")) };
}

/**
 * Whether an origin is one of BitoCard's own sites a customer can be handed between: bitocard.com, a two-letter
 * country store under it (same scheme and port), or BitoCard Shop. Whether a country store is open is the API's to say.
 */
export function isHouseOrigin(origin: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const { store, shop } = bases();
  if (url.origin === store.origin || url.origin === shop.origin) return true;
  return url.protocol === store.protocol && new RegExp(`^[a-z]{2}\\.${store.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(url.host);
}

/** The parent domain the cookie is shared on (`.bitocard.com`), or none where browsers would refuse it (localhost, an IP). */
export function signedInDomain() {
  const host = bases().store.hostname;
  return host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") ? undefined : `.${host}`;
}

/** The first word of the customer's name, kept short: all the button needs. */
export const firstName = (name: string) => (name.trim().split(/\s+/)[0] ?? "").slice(0, 40);

export function encodeSignedIn(value: SignedIn) {
  return Buffer.from(JSON.stringify({ n: firstName(value.name), o: value.origin }), "utf8").toString("base64url");
}

/** The cookie's contents, or null when it is missing, malformed, or names a site that is not BitoCard's own. */
export function decodeSignedIn(raw: string | undefined | null): SignedIn | null {
  if (!raw || raw.length > 400) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { n?: unknown; o?: unknown };
    if (typeof parsed.n !== "string" || typeof parsed.o !== "string" || !parsed.n.trim() || !isHouseOrigin(parsed.o)) return null;
    return { name: firstName(parsed.n), origin: parsed.o };
  } catch {
    return null;
  }
}

/** `#c=<code>&n=<path>` (the landing page's fragment) as the code and where to go next. */
export function readHandoffHash(hash: string) {
  const values = new URLSearchParams(hash.replace(/^#/, ""));
  return { code: values.get("c") ?? "", next: values.get("n") ?? "/" };
}

/** Where to start the handoff: the signed-in site's `/handoff/go`, sending the customer back to `next` on `to`. */
export function handoffStart(from: string, to: string, next: string) {
  const url = new URL("/handoff/go", from);
  url.searchParams.set("to", to);
  url.searchParams.set("next", next);
  return url.href;
}
