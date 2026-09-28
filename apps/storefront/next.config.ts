import { createNextConfig } from "@bitocard/next-config";

// Mirrors appUrl("legals") in @bitocard/ui/site. The legal pages moved from /legal/* to their own subdomain.
const legals = process.env.LEGALS_URL ?? (process.env.VERCEL ? "https://legals.bitocard.com" : "http://localhost:3005");

export default createNextConfig({
  async redirects() {
    return [
      { source: "/legal", destination: legals, permanent: true },
      { source: "/legal/:doc(privacy|terms|cookies|notice)", destination: `${legals}/documents/:doc`, permanent: true },
    ];
  },
});
