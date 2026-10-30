/** The request header the proxy sets from `?theme_preview=` (an admin's 30-minute preview link), for the root layout. */
export const previewHeader = "x-udozo-theme-preview";

const previewPattern = /^\d{10,16}\.[A-Za-z0-9_-]{20,100}$/;

/** A preview token as the API signs them (`<expiry>.<signature>`), or null. */
export const previewToken = (value: string | null | undefined) => (value && previewPattern.test(value) ? value : null);
