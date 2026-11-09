import { createNextConfig } from "@bitocard/next-config";

/**
 * Udozo Connect (https://connect.udozo.com): where people apply to run a Connect Centre and, later, run it
 * (docs/UDOZO_CONNECT_PLAN.md). Private, never indexed. Office photos go through this site's own server, so the
 * camera is never needed from the page itself (a file picker opens it on phones).
 */
export default createNextConfig({ indexable: false });
