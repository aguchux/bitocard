/**
 * What BitoCard Verify asks for: the ID documents accepted in each country, the liveness steps, the business
 * documents for a registered business's KYB, and the reasons a reviewer can give.
 */

/** African countries: BitoCard Verify checks identities there unless an admin chose otherwise for a market. */
export const africanCountries = new Set(
  'DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(' '),
);

export type IdType = { code: string; label: string; back: boolean };

const passport: IdType = { code: 'passport', label: 'International passport', back: false };
const driversLicence: IdType = { code: 'drivers_licence', label: 'Driver’s licence', back: true };

/** ID documents per country (government-issued photo IDs); any other country takes these defaults. */
const byCountry: Record<string, IdType[]> = {
  NG: [
    { code: 'nin_slip', label: 'NIN slip or National ID card', back: false },
    passport,
    driversLicence,
    { code: 'voters_card', label: 'Voter’s card', back: true },
  ],
  GH: [{ code: 'ghana_card', label: 'Ghana Card', back: true }, passport, driversLicence, { code: 'voters_card', label: 'Voter ID card', back: true }],
  KE: [{ code: 'national_id', label: 'National ID card', back: true }, passport, driversLicence, { code: 'alien_id', label: 'Alien ID card', back: true }],
  ZA: [{ code: 'national_id', label: 'Smart ID card or green ID book', back: true }, passport, driversLicence],
};
const defaults: IdType[] = [{ code: 'national_id', label: 'National ID card', back: true }, passport, driversLicence];

export const idTypesFor = (country: string) => byCountry[country.toUpperCase()] ?? defaults;
export const idTypeFor = (country: string, code: string) => idTypesFor(country).find(item => item.code === code) ?? null;

/** Liveness steps: two are drawn at random for each case, so a recording made for another check rarely fits. */
export const livenessSteps = {
  turn_left: 'Turn your head to the left',
  turn_right: 'Turn your head to the right',
  look_up: 'Look up',
  smile: 'Smile',
  closer: 'Move your face closer to the camera',
} as const;
export type LivenessStep = keyof typeof livenessSteps;
/** Frames taken in each step. */
export const framesPerStep = 3;
export const livenessStepCount = 2;

/** A registered business's documents, with what each must show. */
export const businessDocuments = {
  business_registration: 'Certificate of registration (incorporation or business name)',
  business_address: 'Proof of business address, under three months old',
  business_directors: 'Document listing the directors or owners (for example a status report)',
} as const;

/** Why a reviewer declined (shown to the applicant as a short sentence). */
export const declineReasons = {
  document_unreadable: 'We could not read your document. Take a clear photo in good light.',
  document_expired: 'Your document has expired. Use a valid one.',
  document_mismatch: 'The details you entered do not match your document.',
  face_mismatch: 'Your face did not match the photo on your document.',
  liveness_failed: 'We could not confirm the photos were taken live.',
  business_document_invalid: 'Your business documents could not be accepted.',
  underage: 'You must be at least 18.',
  suspected_fraud: 'We could not verify your identity.',
  other: 'We could not verify your identity.',
} as const;
export type DeclineReason = keyof typeof declineReasons;
