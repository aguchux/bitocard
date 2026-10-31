import { createNextConfig } from "@bitocard/next-config";

/** Categories that joined another: their old addresses go for good to where their listings are now. */
export const movedCategories = [{ from: "computers", to: "electronics" }];

/**
 * Udozo is public and indexed. "Use my location" on the area picker needs the browser's location for this site
 * itself (later headers win over the shared ones for the same key); the position never leaves the page, which only finds
 * the nearest area.
 */
export default createNextConfig({
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" }] }];
  },
  async redirects() {
    return movedCategories.flatMap(({ from, to }) => [
      { source: `/c/${from}`, destination: `/c/${to}`, permanent: true },
      { source: `/:cc([a-z]{2})/c/${from}`, destination: `/:cc/c/${to}`, permanent: true },
      // A place's category pages: /ng/lagos/computers and /ng/lagos/ikeja/computers.
      { source: `/:cc([a-z]{2})/:place/${from}`, destination: `/:cc/:place/${to}`, permanent: true },
      { source: `/:cc([a-z]{2})/:state/:area/${from}`, destination: `/:cc/:state/:area/${to}`, permanent: true },
    ]);
  },
});
