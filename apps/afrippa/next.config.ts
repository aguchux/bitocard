import { createNextConfig } from "@bitocard/next-config";

/**
 * Afrippa (afrippa.com) is public and indexed: its markets and traders' cards, nicknames only. Files sent in an order
 * room go through a server action (up to 4 MB, read on this server and passed to the API), above Next's 1 MB default.
 */
export default createNextConfig({ experimental: { serverActions: { bodySizeLimit: "4.5mb" } } });
