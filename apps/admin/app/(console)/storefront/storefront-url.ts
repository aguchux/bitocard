/**
 * Where bitocard.com lives: NEXT_PUBLIC_STOREFRONT_URL when set, the local storefront (port 3000) when the admin runs
 * on localhost, otherwise production.
 */
export function storefrontOrigin() {
  const configured = process.env.NEXT_PUBLIC_STOREFRONT_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "http://localhost:3000";
  return "https://bitocard.com";
}

/** The storefront page that shows the draft home page for a preview token. */
export const previewUrl = (token: string) => `${storefrontOrigin()}/preview?token=${encodeURIComponent(token)}`;
