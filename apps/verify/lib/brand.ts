/**
 * Which product this deployment of Verify serves, fixed at build time by `NEXT_PUBLIC_VERIFY_BRAND` (so server and
 * browser agree): BitoCard's (verify.bitocard.com, the default) or Afrippa's (verify.afrippa.com, its own Vercel
 * project). The same capture, liveness and documents; each product's own name, API routes, session cookie, icons and
 * privacy notice. Afrippa's checks are reviewed only in Afrippa's admin, so its deployment has no review console.
 */
export type VerifyBrandKey = "bitocard" | "afrippa";

export type VerifyBrand = {
  key: VerifyBrandKey;
  /** The company the applicant is checked for. */
  name: string;
  /** This app's name. */
  product: string;
  description: string;
  /** The API's applicant routes for this product's cases (a session works only on its own product's). */
  apiPrefix: string;
  /** The API when no address is set, in production. */
  apiDefault: string;
  /** The host-only cookie holding the applicant's session. */
  cookie: string;
  /** Resellers review their customers' checks here (BitoCard's only). */
  review: boolean;
  /** The privacy notice the consent links to; null until the product publishes one (Afrippa's comes with step 5). */
  privacyUrl: string | null;
  /** The product's own sites a lost applicant may have come from (their host names). */
  hosts: string[];
  /** The logo: the mark beside the name, "Bito" + "card" or "Afri" + "ppa". */
  mark: string;
  wordmark: [string, string];
};

export const verifyBrands: Record<VerifyBrandKey, VerifyBrand> = {
  bitocard: {
    key: "bitocard",
    name: "BitoCard",
    product: "BitoCard Verify",
    description: "Check your identity, or your business, for BitoCard and the stores it supplies.",
    apiPrefix: "/v1/kyc",
    apiDefault: "https://api.bitocard.com",
    cookie: "bc_kyc",
    review: true,
    privacyUrl: "https://legals.bitocard.com/documents/privacy",
    hosts: ["bitocard.com"],
    mark: "/bitocard-mark.png",
    wordmark: ["Bito", "card"],
  },
  afrippa: {
    key: "afrippa",
    name: "Afrippa",
    product: "Afrippa Verify",
    description: "Check your identity to trade on Afrippa.",
    apiPrefix: "/v1/afrippa/kyc",
    apiDefault: "https://api.afrippa.com",
    cookie: "afr_kyc",
    review: false,
    // Afrippa's own legal documents come with step 5 of the spin-off plan, on afrippa.com: published before checks go live.
    privacyUrl: null,
    hosts: ["afrippa.com"],
    mark: "/afrippa/afrippa-mark.png",
    wordmark: ["Afri", "ppa"],
  },
};

export const brandKey = (value: string | undefined): VerifyBrandKey => (value === "afrippa" ? "afrippa" : "bitocard");

/** This deployment's brand. */
export const brand: VerifyBrand = verifyBrands[brandKey(process.env.NEXT_PUBLIC_VERIFY_BRAND)];

/** Afrippa's icons, served at the usual addresses on its deployment (next.config.ts), so pages stay static. */
export const afrippaIconFiles = ["favicon.ico", "icon.svg", "icon1.png", "apple-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"] as const;
