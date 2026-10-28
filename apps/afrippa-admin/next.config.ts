import { createNextConfig } from "@bitocard/next-config";

/** Afrippa's admin (admin.afrippa.com): private, never indexed. */
export default createNextConfig({ indexable: false });
