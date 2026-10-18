import { createNextConfig } from "@bitocard/next-config";

// Mirrors appUrl("legals") in @bitocard/ui/site. The legal pages moved from /legal/* to their own subdomain.
const legals = process.env.LEGALS_URL ?? (process.env.VERCEL ? "https://legals.bitocard.com" : "http://localhost:3005");

export default createNextConfig({
  async redirects() {
    return [
      { source: "/legal", destination: legals, permanent: true },
      // The wallet's Activity screen is now Transactions.
      { source: "/account/wallet/activity", destination: "/account/wallet/transactions", permanent: true },
      { source: "/legal/:doc(privacy|terms|cookies|notice)", destination: `${legals}/documents/:doc`, permanent: true },
      // Resellers' stores (<subdomain>.bitocard.com) are their own brand: BitoCard's reseller page lives on bitocard.com only.
      { source: "/resellers", has: [{ type: "host", value: "(?!www\\.)[a-z0-9-]+\\.bitocard\\.com" }], destination: "https://bitocard.com/resellers", permanent: false },
      // Resellers' own domains too: any host that is not BitoCard's (bitocard.com, local development, Vercel previews).
      {
        source: "/resellers",
        missing: [
          { type: "host", value: "(?:[a-z0-9-]+\\.)?bitocard\\.com" },
          { type: "host", value: "(?:[a-z0-9-]+\\.)?localhost(?::\\d+)?" },
          { type: "host", value: ".*\\.vercel\\.app" },
        ],
        destination: "https://bitocard.com/resellers",
        permanent: false,
      },
    ];
  },
});
