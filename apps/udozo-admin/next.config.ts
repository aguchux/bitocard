import { createNextConfig } from "@bitocard/next-config";

/** Udozo Admin (https://admin.udozo.com): private, never indexed (docs/UDOZO_SPINOFF_PLAN.md, step 4). */
export default createNextConfig({ indexable: false });
