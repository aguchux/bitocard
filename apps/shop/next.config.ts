import { createNextConfig } from "@bitocard/next-config";

/**
 * BitoCard Shop is public and indexed. "Use my location" on the area picker needs the browser's location for this site
 * itself (later headers win over the shared ones for the same key); the position never leaves the page, which only finds
 * the nearest area. The service worker is always fetched fresh, so a new version reaches visitors on their next visit.
 */
export default createNextConfig({
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
});
