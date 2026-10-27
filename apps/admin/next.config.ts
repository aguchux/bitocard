import { createNextConfig } from "@bitocard/next-config";

export default createNextConfig({
  indexable: false,
  async redirects() {
    return [
      // Crypto has left BitoCard (docs/CRYPTO_SPINOFF_PLAN.md): its admin routes now answer only Afrippa's own admins
      // (admin.afrippa.com), so these pages cannot load here. Customers' payouts (Safe pay) and the retired exchange stay.
      { source: "/crypto", destination: "/", permanent: false },
      { source: "/crypto/:section(ads|assets|chains|customers|deposits|trades|withdrawals)/:path*", destination: "/", permanent: false },
    ];
  },
});
