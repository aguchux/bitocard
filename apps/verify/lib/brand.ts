/**
 * Which product this deployment of Verify serves, fixed at build time by `NEXT_PUBLIC_VERIFY_BRAND` (so server and
 * browser agree): BitoCard's (verify.bitocard.com, the default), Afrippa's (verify.afrippa.com) or Udozo's
 * (verify.udozo.com), each its own Vercel project. The same capture, liveness and documents; each product's own name,
 * API, session cookie, icons and privacy notice. Afrippa's and Udozo's checks are reviewed only in their own admins, so
 * their deployments have no review console.
 */
export type VerifyBrandKey = "bitocard" | "afrippa" | "udozo";

export type VerifyBrand = {
  key: VerifyBrandKey;
  /** The company the applicant is checked for. */
  name: string;
  /** This app's name. */
  product: string;
  description: string;
  /**
   * The API's applicant routes for this product's cases (a session works only on its own product's). Udozo's are
   * BitoCard's own paths on Udozo's own API instance (the same code, its own database).
   */
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
  /** The logo: the mark beside the name, "Bito" + "card", "Afri" + "ppa" or "Udo" + "zo". */
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
    // Afrippa's privacy notice on afrippa.com (a draft for lawyers' review until checks go live).
    privacyUrl: "https://afrippa.com/legal/privacy",
    hosts: ["afrippa.com"],
    mark: "/afrippa/afrippa-mark.png",
    wordmark: ["Afri", "ppa"],
  },
  udozo: {
    key: "udozo",
    name: "Udozo",
    product: "Udozo Verify",
    description: "Check your identity, or your business, for Udozo and the stores on it.",
    apiPrefix: "/v1/kyc",
    apiDefault: "https://api.udozo.com",
    cookie: "udz_kyc",
    review: false,
    // Udozo's privacy notice on udozo.com (a draft for lawyers' review until checks go live).
    privacyUrl: "https://udozo.com/legal/privacy",
    // udozo.com, Seller HQ and every store's <store>.udozo.com address.
    hosts: ["udozo.com"],
    mark: "/udozo/udozo-mark.png",
    wordmark: ["Udo", "zo"],
  },
};

export const brandKey = (value: string | undefined): VerifyBrandKey => (value === "afrippa" || value === "udozo" ? value : "bitocard");

/** This deployment's brand. */
export const brand: VerifyBrand = verifyBrands[brandKey(process.env.NEXT_PUBLIC_VERIFY_BRAND)];

/**
 * A second brand's icons (public/afrippa/ or public/udozo/), served at the usual addresses on its deployment
 * (next.config.ts), so pages stay static.
 */
export const brandIconFiles = ["favicon.ico", "icon.svg", "icon1.png", "apple-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"] as const;
