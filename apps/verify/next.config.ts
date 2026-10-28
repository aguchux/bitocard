import { createNextConfig } from "@bitocard/next-config";
import { afrippaIconFiles, brandKey } from "./lib/brand";

/**
 * Private (noindex) like the other consoles, but the camera is allowed for this site itself: the ID, selfie and
 * liveness steps use it. Later headers win over the shared ones for the same key. Framing stays refused, and no page
 * address (with its one-time link) is ever sent as a referrer.
 */
export default createNextConfig({
  indexable: false,
  // Afrippa's deployment serves Afrippa's icons (public/afrippa/, written by scripts/brand-assets.py) at the addresses the
  // icon files and manifest use, before Next.js's own; BitoCard's serves its own. Pages and icon links stay static.
  async rewrites() {
    if (brandKey(process.env.NEXT_PUBLIC_VERIFY_BRAND) !== "afrippa") return [];
    return { beforeFiles: afrippaIconFiles.map(file => ({ source: `/${file}`, destination: `/afrippa/${file}` })), afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
    ];
  },
});
