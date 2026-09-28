import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/**
 * Builds the Next.js config shared by every BitoCard app.
 * Private apps (admin, reseller, api) set `indexable: false` so every response carries a noindex header.
 *
 * @param {{ indexable?: boolean } & import("next").NextConfig} [options]
 * @returns {import("next").NextConfig}
 */
export function createNextConfig({ indexable = true, ...config } = {}) {
  const headers = indexable ? securityHeaders : [...securityHeaders, { key: "X-Robots-Tag", value: "noindex, nofollow" }];

  return {
    poweredByHeader: false,
    reactStrictMode: true,
    turbopack: { root: repoRoot },
    outputFileTracingRoot: repoRoot,
    ...config,
    async headers() {
      const extra = config.headers ? await config.headers() : [];
      return [{ source: "/:path*", headers }, ...extra];
    },
  };
}
