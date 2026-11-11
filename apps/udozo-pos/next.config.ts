import { createNextConfig } from "@bitocard/next-config";

/**
 * Udozo POS (https://pos.udozo.com, docs/UDOZO_POS_PLAN.md): a public marketing site (indexed: `/`, `/pricing`,
 * `/download`) and, behind sign-in, the shop owner's POS. The private pages carry noindex in their own metadata and
 * robots.txt keeps them out. The till scans barcodes with the device's camera, so this site alone may use it; later
 * headers win over the shared ones for the same key.
 */
export default createNextConfig({
  indexable: true,
  // A file of a till's unsent sales comes through a server action (Vercel takes 4.5 MB a request).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" }] }];
  },
});
