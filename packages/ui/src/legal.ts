/**
 * Single source of truth for BitoCard's legal pages.
 * Fill in companyNumber and registeredAddress when confirmed; pages omit fields that are not set.
 */
export type LegalEntity = {
  name: string;
  jurisdiction: string;
  /** Who this entity serves: it is the controller and contracting party for these regions. */
  regions: string;
  governingLaw: string;
  courts: string;
  companyNumber?: string;
  registeredAddress?: string;
};

export const legalContact = "legal@bitocard.com";

/** Shown as "Last updated" on every legal page. Update when any legal page changes. */
export const legalUpdated = "28 September 2026";

export const legalEntities: readonly LegalEntity[] = [
  {
    name: "Golojan Technologies LLC",
    jurisdiction: "Delaware, United States",
    regions: "North America (including Canada), South America, the Caribbean and Asia",
    governingLaw: "the laws of the State of Delaware, United States",
    courts: "the state and federal courts located in Delaware",
  },
  {
    name: "Golojan LLC",
    jurisdiction: "England and Wales, United Kingdom",
    regions: "United Kingdom, European Economic Area, Switzerland and the rest of Europe",
    governingLaw: "the laws of England and Wales",
    courts: "the courts of England and Wales",
  },
  {
    name: "De-Golojan Technologies Ltd",
    jurisdiction: "Nigeria",
    regions: "Africa",
    governingLaw: "the laws of the Federal Republic of Nigeria",
    courts: "the courts of Nigeria",
  },
];

/** Regions not listed above (for example Oceania and the Middle East) are served by this entity. */
export const defaultEntity = legalEntities[0];

/** Paths within the legals app (legals.bitocard.com). Other apps link to them with appUrl("legals", doc.href). */
export const legalDocuments = [
  { href: "/privacy", label: "Privacy notice", short: "Privacy" },
  { href: "/terms", label: "Terms of use", short: "Terms" },
  { href: "/cookies", label: "Cookie notice", short: "Cookies" },
  { href: "/notice", label: "Legal notice", short: "Legal notice" },
] as const;
