import { createNextConfig } from "@bitocard/next-config";

/**
 * Udozo POS (https://pos.udozo.com, docs/UDOZO_POS_PLAN.md): a public marketing site (indexed: `/`, `/pricing`,
 * `/download`) and, behind sign-in, the shop owner's POS. The private pages carry noindex in their own metadata and
 * robots.txt keeps them out.
 */
export default createNextConfig({ indexable: true });
