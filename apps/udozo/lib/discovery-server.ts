import "server-only";
import { cookies, headers } from "next/headers";
import { apiUrl } from "./api";
import { consentCookie, optionalAllowed, readConsent } from "./cookie-consent";
import { customerCookie, customerFetch, shopperHeader } from "./customer";
import { newVisitorId, visitorCookie, visitorHeader, visitorMaxAgeSeconds, visitorPattern } from "./discovery";

/**
 * Who discovery records on udozo.com's server: the signed-in customer (their session, which `customerFetch` sends), else
 * a visitor who chose Accept all (`udz_vid`, sent as `Udozo-Visitor`). Nobody else.
 */

/** The visitor's ID from this site's cookie, or null (none, or not one of ours). */
export async function currentVisitor() {
  const value = (await cookies()).get(visitorCookie)?.value;
  return value && visitorPattern.test(value) ? value : null;
}

export async function signedIn() {
  return Boolean((await cookies()).get(customerCookie)?.value);
}

/** Whether the visitor chose Accept all (the consent cookie, as the banner wrote it). */
export async function consentsToOptional() {
  const value = (await cookies()).get(consentCookie)?.value;
  return optionalAllowed(readConsent(value ? `${consentCookie}=${value}` : null));
}

/**
 * A discovery request for whoever is looking: the customer's session when signed in, else the visitor's ID (if any).
 * Null when the API cannot be reached.
 */
export async function discoveryFetch(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  const visitor = (await signedIn()) ? null : await currentVisitor();
  const agent = (await headers()).get("user-agent") ?? "";
  return customerFetch(method, path, body, { headers: { "user-agent": agent, ...(visitor ? { [visitorHeader]: visitor } : {}) } });
}

/** Sets a new visitor ID (route handlers only): host-only, httpOnly, 12 months. Only call after checking consent. */
export async function keepVisitor() {
  const id = newVisitorId();
  (await cookies()).set(visitorCookie, id, { maxAge: visitorMaxAgeSeconds, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  return id;
}

/**
 * Forgets the visitor (Necessary only): what Udozo kept under their ID is deleted, asked as the visitor alone (never with
 * a customer's session, which would clear the customer's own history), then the cookie goes.
 */
export async function dropVisitor() {
  const visitor = await currentVisitor();
  if (visitor) {
    try {
      await fetch(apiUrl("/v1/classifieds/history"), { method: "DELETE", cache: "no-store", headers: { accept: "application/json", [visitorHeader]: visitor, ...(await shopperHeader()) } });
    } catch {
      // The API forgets idle visitors on its own (180 days); the cookie still goes.
    }
  }
  (await cookies()).delete(visitorCookie);
}

/**
 * After signing in: what the visitor looked at before becomes the customer's (`POST /v1/classifieds/history/merge`).
 * The visitor cookie stays (they may sign out again). Never fails the sign-in.
 */
export async function mergeVisitorHistory(session: { token: string }) {
  const visitor = await currentVisitor();
  if (!visitor) return;
  await customerFetch("POST", "/v1/classifieds/history/merge", { visitor }, { headers: { "bitocard-customer-session": session.token } }).catch(() => null);
}
