import { createNextConfig } from "@bitocard/next-config";

// Mirrors appUrl("legals") in @bitocard/ui/site. The legal pages moved from /legal/* to their own subdomain.
const legals = process.env.LEGALS_URL ?? (process.env.VERCEL ? "https://legals.bitocard.com" : "http://localhost:3005");

/**
 * Pilot markets' own country stores (docs/BITOCARD_COUNTRY_STORES_PLAN.md): bitocard.com, just localised, so the
 * /resellers redirect below must not treat them as a reseller's store. This redirect runs on the host header alone,
 * before any page or API call, so it cannot ask the API which stores are house-owned; this list is kept to the same
 * three pilot markets the plan enumerates everywhere else, and grows only when a new market's country store ships.
 */
const countryStoreSubdomains = ["ng", "gh", "ke"];
const notCountryStore = countryStoreSubdomains.map(code => `(?!${code}\\.)`).join("");

export default createNextConfig({
  async redirects() {
    return [
      { source: "/legal", destination: legals, permanent: true },
      // The wallet's Activity screen is now Transactions.
      { source: "/account/wallet/activity", destination: "/account/wallet/transactions", permanent: true },
      { source: "/legal/:doc(privacy|terms|cookies|notice)", destination: `${legals}/documents/:doc`, permanent: true },
      // Resellers' stores (<subdomain>.bitocard.com) are their own brand: BitoCard's reseller page lives on bitocard.com
      // only. A market's own country store is bitocard.com itself, just localised, so it keeps this page too.
      {
        source: "/resellers",
        has: [{ type: "host", value: `(?!www\\.)${notCountryStore}[a-z0-9-]+\\.bitocard\\.com` }],
        destination: "https://bitocard.com/resellers",
        permanent: false,
      },
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
