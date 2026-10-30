import { createNextConfig } from "@bitocard/next-config";

export default createNextConfig({
  indexable: false,
  async redirects() {
    return [
      // Crypto has left BitoCard (docs/CRYPTO_SPINOFF_PLAN.md): its admin routes now answer only Afrippa's own admins
      // (admin.afrippa.com), so these pages cannot load here. Customers' payouts (Safe pay) left with the Shop.
      { source: "/crypto", destination: "/", permanent: false },
      { source: "/crypto/:path*", destination: "/", permanent: false },
      // BitoCard Shop and B2B reselling have left BitoCard for Udozo (docs/UDOZO_SPINOFF_PLAN.md): their admin routes
      // answer only Udozo's API, so old links and bookmarks land on the overview.
      { source: "/classifieds", destination: "/", permanent: false },
      { source: "/classifieds/:path*", destination: "/", permanent: false },
      { source: "/reports/resale", destination: "/reports", permanent: false },
      { source: "/support/assistants/who-answers", destination: "/support/assistants", permanent: false },
    ];
  },
});
