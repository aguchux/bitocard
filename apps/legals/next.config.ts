import { createNextConfig } from "@bitocard/next-config";

export default createNextConfig({
  async redirects() {
    // Documents moved under /documents; keep the earlier short paths working.
    return [{ source: "/:doc(privacy|terms|cookies|notice)", destination: "/documents/:doc", permanent: true }];
  },
});
