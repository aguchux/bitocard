import { createNextConfig } from "@bitocard/next-config";

/**
 * BitoCard Shop is public and indexed. "Use my location" on the area picker needs the browser's location for this site
 * itself (later headers win over the shared ones for the same key); the position never leaves the page, which only finds
 * the nearest area.
 */
export default createNextConfig({
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" }] }];
  },
});
