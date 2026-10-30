import { createNextConfig } from "@bitocard/next-config";

export default createNextConfig({
  indexable: false,
  async redirects() {
    // B2B reselling has left BitoCard for Udozo (docs/UDOZO_SPINOFF_PLAN.md): old Resale links land on the stores.
    return [
      { source: "/resale", destination: "/store", permanent: false },
      { source: "/resale/:path*", destination: "/store", permanent: false },
    ];
  },
});
