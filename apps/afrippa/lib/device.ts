/** This site's own cookie holding a browser's random device ID (`proxy.ts`), sent to the API as `Afrippa-Device`. */
export const deviceCookie = "afr_device";
export const deviceHeader = "afrippa-device";

const pattern = /^afd_[A-Za-z0-9_-]{43}$/;

export const validDeviceId = (value: string | undefined | null): value is string => typeof value === "string" && pattern.test(value);

/** A new device ID: `afd_` and 32 random bytes in base64url (Web Crypto, so it runs in the proxy too). */
export function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return `afd_${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
