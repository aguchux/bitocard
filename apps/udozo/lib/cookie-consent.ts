/**
 * Cookie consent on Udozo's sites. Udozo's optional cookies are `udz_vid` (udozo.com remembering what a signed-out
 * visitor looks at, to personalise what they see) and `udz_src` (where the latest visit came from, to credit a sign-up
 * to the link or ad that brought it; `lib/traffic.ts`); every other cookie is strictly necessary (the cookie notice lists
 * them). The banner asks, and remembers the answer in `udz_cookie_consent` (first-party, readable by the page, 12
 * months). Nothing optional may be set unless `optionalAllowed` says so. Bump `consentVersion` when the optional cookies
 * change, so everyone is asked again (2: `udz_vid`, 4 November 2026; 3: `udz_src`, 8 November 2026).
 */

export const consentCookie = "udz_cookie_consent";
export const consentVersion = 3;
export const consentMaxAgeSeconds = 365 * 24 * 60 * 60;
/** Fired on `window` to open the banner again (the footers' Cookie settings). */
export const consentSettingsEvent = "udz:cookie-settings";
/** Fired on `window` with the new choice as `detail`, once a visitor chooses. */
export const consentChangedEvent = "udz:cookie-consent";

export type ConsentChoice = "necessary" | "all";
export type Consent = { choice: ConsentChoice; at: string };

/** The visitor's choice from a `Cookie` header or `document.cookie`, or null when they have not chosen (or chose under an older version). */
export function readConsent(cookieString: string | null | undefined): Consent | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== consentCookie) continue;
    const match = /^v(\d+)\.(necessary|all)\.(\d{4}-\d{2}-\d{2})$/.exec(decodeURIComponent(rest.join("=")));
    if (!match || Number(match[1]) !== consentVersion) return null;
    return { choice: match[2] as ConsentChoice, at: match[3]! };
  }
  return null;
}

/** The `document.cookie` assignment that records a choice on this site only (host-only), Secure on https. */
export function consentCookieValue(choice: ConsentChoice, now: Date, secure: boolean): string {
  const value = `v${consentVersion}.${choice}.${now.toISOString().slice(0, 10)}`;
  return `${consentCookie}=${value}; Max-Age=${consentMaxAgeSeconds}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Whether optional cookies may be used: only after the visitor chose Accept all. */
export const optionalAllowed = (consent: Consent | null) => consent?.choice === "all";
