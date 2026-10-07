/**
 * Single source of truth for BitoCard's legal pages.
 * Optional fields are omitted from the pages when not set.
 */
export type LegalEntity = {
  name: string;
  jurisdiction: string;
  /** Who this entity serves: it is the controller and contracting party for these regions. */
  regions: string;
  governingLaw: string;
  courts: string;
  /** Registration number and what the local registry calls it, e.g. "Company number" or "RC number". */
  companyNumber?: string;
  companyNumberLabel?: string;
  registeredAddress?: string;
};

export const legalContact = "legal@bitocard.com";

/** Shown as "Last updated" on every legal page. Update when any legal page changes. */
export const legalUpdated = "7 October 2026";
/** The same date in ISO 8601, for sitemaps and structured data. Keep in step with legalUpdated. */
export const legalUpdatedIso = "2026-10-07";

export const legalEntities: readonly LegalEntity[] = [
  {
    name: "Golojan Technologies LLC",
    jurisdiction: "Delaware, United States",
    regions: "North America (including Canada), South America, the Caribbean and Asia",
    governingLaw: "the laws of the State of Delaware, United States",
    courts: "the state and federal courts located in Delaware",
    companyNumber: "10762897",
    companyNumberLabel: "Delaware file number",
    registeredAddress: "1207 Delaware Ave #3036, Wilmington, DE 19806",
  },
  {
    name: "Golojan Ltd",
    jurisdiction: "England and Wales, United Kingdom",
    regions: "United Kingdom, European Economic Area, Switzerland and the rest of Europe",
    governingLaw: "the laws of England and Wales",
    courts: "the courts of England and Wales",
    companyNumber: "17481904",
    companyNumberLabel: "Company number",
    registeredAddress: "12 Devon Road, Canterbury CT1 1RP",
  },
  {
    name: "De-Golojan Technologies Ltd",
    jurisdiction: "Nigeria",
    regions: "Africa",
    governingLaw: "the laws of the Federal Republic of Nigeria",
    courts: "the courts of Nigeria",
    companyNumber: "RC 1606658",
    companyNumberLabel: "RC number",
    registeredAddress: "3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu",
  },
];

/** Regions not listed above (for example Oceania and the Middle East) are served by this entity. */
export const defaultEntity = legalEntities[0];

/** Paths within the legals app (legals.bitocard.com). Other apps link to them with appUrl("legals", doc.href). */
export const legalDocuments = [
  { href: "/documents/privacy", label: "Privacy notice", short: "Privacy" },
  { href: "/documents/terms", label: "Terms of use", short: "Terms" },
  { href: "/documents/cookies", label: "Cookie notice", short: "Cookies" },
  { href: "/documents/notice", label: "Legal notice", short: "Legal notice" },
] as const;
