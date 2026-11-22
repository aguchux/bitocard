import { createNextConfig } from "@bitocard/next-config";

export default createNextConfig({
  // Not the blanket noindex header: a header cannot be lifted per page, and sign-up and sign-in are indexable.
  // Every other page is noindex through the root layout's metadata (lib/seo.ts).
  indexable: true,
  async redirects() {
    // B2B reselling has left BitoCard for Udozo (docs/UDOZO_SPINOFF_PLAN.md): old Resale links land on the stores.
    return [
      // Ticket notices once linked to /support/tickets/<id>; the page is /support/<id>.
      { source: "/support/tickets/:id", destination: "/support/:id", permanent: true },
      { source: "/resale", destination: "/store", permanent: false },
      { source: "/resale/:path*", destination: "/store", permanent: false },
    ];
  },
});
