/**
 * The Golojan entity that sells, as seller of record, to customers in each region. Mirrors the entities in
 * packages/ui/src/legal.ts (the legal pages); a test checks the two stay in step.
 */
export type SellerEntity = { name: string; companyNumberLabel: string; companyNumber: string; registeredAddress: string };

const golojanLlc: SellerEntity = {
  name: 'Golojan Technologies LLC',
  companyNumberLabel: 'Delaware file number',
  companyNumber: '10762897',
  registeredAddress: '1207 Delaware Ave #3036, Wilmington, DE 19806',
};

const golojanLtd: SellerEntity = {
  name: 'Golojan Ltd',
  companyNumberLabel: 'Company number',
  companyNumber: '17481904',
  registeredAddress: '12 Devon Road, Canterbury CT1 1RP',
};

const deGolojan: SellerEntity = {
  name: 'De-Golojan Technologies Ltd',
  companyNumberLabel: 'RC number',
  companyNumber: 'RC 1606658',
  registeredAddress: '3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu',
};

export const sellerEntities = [golojanLlc, golojanLtd, deGolojan];

/** UK, EEA and Switzerland. */
const europe = new Set(
  'GB AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(' '),
);

const africa = new Set(
  'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(' '),
);

/** Golojan Ltd for the UK and Europe, De-Golojan Technologies Ltd for Africa, Golojan Technologies LLC elsewhere. */
export function sellerFor(country: string): SellerEntity {
  if (europe.has(country)) return golojanLtd;
  if (africa.has(country)) return deGolojan;
  return golojanLlc;
}
