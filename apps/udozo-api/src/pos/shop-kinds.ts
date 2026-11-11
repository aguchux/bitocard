/**
 * What kind of shop a POS shop is (docs/UDOZO_POS_PLAN.md, the owner's 11 November 2026 request): the till is tailored
 * to it. Now its categories come first at the till and in Products; each kind will get a theme of its own (layout,
 * colours, what a line asks for: a pharmacy's batch and expiry, an auto parts shop's part number and fitment). Kinds are
 * code, like the plans' limits, so a new one is added here, with its categories as udozo.com's category slugs (a top
 * category takes its subcategories with it).
 */
export const posShopKinds = [
  { code: 'general', name: 'General shop', categories: [] },
  { code: 'pharmacy', name: 'Pharmacy or chemist', categories: ['pharmacy', 'health-beauty', 'medical-equipment'] },
  { code: 'auto_parts', name: 'Auto parts', categories: ['vehicle-parts', 'vehicles'] },
  { code: 'phones_electronics', name: 'Phones and electronics', categories: ['phones-tablets', 'electronics'] },
  { code: 'supermarket', name: 'Supermarket or provisions', categories: ['agriculture-food', 'home-garden', 'babies-kids', 'health-beauty'] },
  { code: 'fashion_beauty', name: 'Fashion and beauty', categories: ['fashion', 'health-beauty'] },
  { code: 'building_hardware', name: 'Building materials and hardware', categories: ['repair-construction'] },
] as const;

export type PosShopKind = (typeof posShopKinds)[number]['code'];
export const posShopKindCodes = posShopKinds.map(kind => kind.code) as [PosShopKind, ...PosShopKind[]];
export const isPosShopKind = (code: string): code is PosShopKind => (posShopKindCodes as string[]).includes(code);

/** A shop kind as the API shows it. */
export const presentShopKind = (code: string) => {
  const kind = posShopKinds.find(item => item.code === code) ?? posShopKinds[0];
  return { code: kind.code, name: kind.name, categories: [...kind.categories] };
};
