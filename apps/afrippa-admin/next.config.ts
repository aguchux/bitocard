import { createNextConfig } from "@bitocard/next-config";

/** Afrippa's admin (admin.afrippa.com): private, never indexed. */
export default createNextConfig({
  indexable: false,
  async redirects() {
    // Ticket notices once linked to /support/tickets/<id>; the page is /support/<id>.
    return [{ source: "/support/tickets/:id", destination: "/support/:id", permanent: true }];
  },
});
