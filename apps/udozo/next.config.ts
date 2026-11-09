import { createNextConfig } from "@bitocard/next-config";
import { previewParents } from "./lib/preview";

/**
 * The site udozo.com served before (Udozo Memorial) gave /logo.png as its icon, which search engines still hold: it
 * goes for good to Udozo's logo, so they fetch the new one.
 */
export const oldLogo = { source: "/logo.png", destination: "/udozo-logo.png", permanent: true };

/** Categories that joined another: their old addresses go for good to where their listings are now. */
export const movedCategories = [{ from: "computers", to: "electronics" }];

/**
 * Udozo is public and indexed. "Use my location" on the area picker needs the browser's location for this site
 * itself (later headers win over the shared ones for the same key); the position never leaves the page, which only finds
 * the nearest area. Calls need the microphone, for this site only (never a frame from elsewhere).
 */
export default createNextConfig({
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), payment=()" }] },
      // The home page editor's live preview: only /home-preview may be framed, and only by Udozo's admin.
      {
        source: "/home-preview",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${previewParents().join(" ")}` },
        ],
      },
    ];
  },
  async redirects() {
    return [
      oldLogo,
      // Safe pay is UdozoPay (9 November 2026): its old addresses move for good.
      { source: "/account/safe-pay", destination: "/account/udozopay", permanent: true },
      { source: "/legal/safe-pay", destination: "/legal/udozopay", permanent: true },
      // Udozo Connect's addresses in notices and emails (`/connect/application`) open connect.udozo.com.
      { source: "/connect/:path*", destination: `${(process.env.NEXT_PUBLIC_CONNECT_URL ?? "https://connect.udozo.com").replace(/\/$/, "")}/:path*`, permanent: false },
      ...movedCategories.flatMap(({ from, to }) => [
        { source: `/c/${from}`, destination: `/c/${to}`, permanent: true },
        { source: `/:cc([a-z]{2})/c/${from}`, destination: `/:cc/c/${to}`, permanent: true },
        // A place's category pages: /ng/lagos/computers and /ng/lagos/ikeja/computers.
        { source: `/:cc([a-z]{2})/:place/${from}`, destination: `/:cc/:place/${to}`, permanent: true },
        { source: `/:cc([a-z]{2})/:state/:area/${from}`, destination: `/:cc/:state/:area/${to}`, permanent: true },
      ]),
    ];
  },
});
