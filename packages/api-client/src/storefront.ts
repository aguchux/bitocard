/**
 * BitoCard's own storefront (bitocard.com): the public `/v1/store` shapes and the home page layout, typed by hand
 * against the API presenters (`apps/api/src/storefront`). Types only, so the storefront's server code can use them
 * without the RTK Query client. Amounts are minor units.
 */

export type ProductCategory = 'gift_cards' | 'airtime' | 'data' | 'bills' | 'pay_tv' | 'esim' | 'software' | 'virtual_numbers' | 'virtual_cards';

export const categoryLabels: Record<ProductCategory, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data',
  bills: 'Bills',
  pay_tv: 'Pay-TV',
  esim: 'eSIMs',
  software: 'Software',
  virtual_numbers: 'Virtual numbers',
  virtual_cards: 'Virtual cards',
};

export type StoreBrand = {
  object: 'store_brand';
  slug: string;
  name: string;
  company: string | null;
  description: string | null;
  logo_url: string | null;
  image_url: string | null;
  color: string | null;
  tags: string[];
  /** In brand lists: how many products, and whether featured. */
  products?: number;
  featured?: boolean;
};

export type StoreProduct = {
  object: 'store_product';
  id: string;
  key: string;
  name: string;
  category: ProductCategory;
  category_label: string;
  country: string;
  country_name: string;
  global: boolean;
  face_currency: string;
  denomination_type: 'fixed' | 'range';
  from: number;
  to: number;
  description: string | null;
  logo_url: string | null;
  brand: StoreBrand;
};

export type StoreProductDetail = StoreProduct & {
  denominations: number[] | null;
  range: { min: number; max: number } | null;
  recipient_type: string;
  redeem_instructions: string | null;
  other_countries: StoreProduct[];
  related: StoreProduct[];
};

export type StoreCategory = { object: 'store_category'; category: ProductCategory; label: string; group: string | null; icon_url: string | null; image_url: string | null; products: number };
export type StoreCountry = { code: string; name: string; products: number };
export type StoreNavigationGroup = { key: string; label: string; categories: StoreCategory[]; brands: StoreBrand[] };
export type StoreList<T> = { object: 'list'; data: T[]; has_more?: boolean; total?: number };

export type StoreSearch = {
  object: 'store_search';
  query: string;
  products: StoreProduct[];
  brands: StoreBrand[];
  categories: StoreCategory[];
  countries: StoreCountry[];
};

// -- Layout -----------------------------------------------------------------------------------------------------

/** Desktop has 12 columns, tablet 6, phones 1. `rows: 2` lets a section sit beside two stacked short ones. */
export type SectionSpan = { lg: 3 | 4 | 6 | 8 | 9 | 12; md: 3 | 6; rows: 1 | 2 };
type SectionBase = { id: string; span: SectionSpan; hidden: boolean };

export type HeroSection = SectionBase & { type: 'hero'; title: string; accent: string; subtitle: string; search: boolean; categoryChips: boolean };
export type ProductSource = 'trending' | 'top_selling' | 'new' | 'featured' | 'category' | 'brand' | 'manual';
export type ProductRailSection = SectionBase & {
  type: 'product_rail';
  title: string;
  subtitle: string;
  source: ProductSource;
  category?: ProductCategory;
  brand?: string;
  productKeys: string[];
  limit: number;
  filters: boolean;
  layout: 'cards' | 'list';
  viewAllHref?: string;
};
export type CategoryGridSection = SectionBase & { type: 'category_grid'; title: string; subtitle: string; categories: ProductCategory[] };
export type BrandGridSection = SectionBase & { type: 'brand_grid'; title: string; subtitle: string; tag: string; limit: number };
export type PromoTheme = 'pink' | 'sky' | 'navy' | 'light' | 'sunset';
export type PromoIllustration = 'store' | 'esim' | 'gift' | 'globe' | 'none';
export type PromoSection = SectionBase & {
  type: 'promo';
  title: string;
  subtitle: string;
  body: string;
  bullets: string[];
  cta?: { label: string; href: string };
  imageUrl?: string;
  theme: PromoTheme;
  illustration: PromoIllustration;
};
export type TrustIcon = 'lock' | 'bolt' | 'card' | 'globe' | 'shield' | 'support';
export type TrustBarSection = SectionBase & { type: 'trust_bar'; items: Array<{ icon: TrustIcon; title: string; body: string }> };

export type Section = HeroSection | ProductRailSection | CategoryGridSection | BrandGridSection | PromoSection | TrustBarSection;
export type SectionType = Section['type'];

/** A section as the home page returns it: with what it shows. */
export type ResolvedSection =
  | (HeroSection & { data: { featured: StoreBrand[] } })
  | (ProductRailSection & { data: { products: StoreProduct[] } })
  | (CategoryGridSection & { data: { categories: StoreCategory[] } })
  | (BrandGridSection & { data: { brands: StoreBrand[] } })
  | (PromoSection & { data: null })
  | (TrustBarSection & { data: null });

export type StoreHome = {
  object: 'store_home';
  preview: boolean;
  version: number | null;
  published_at: string | null;
  sections: ResolvedSection[];
  navigation: StoreNavigationGroup[];
  countries: StoreCountry[];
};

/** "$10.00", "₦1,000" or "GBP 5.00": a face value in its currency. */
export function formatFace(minor: number, currency: string) {
  const digits = ['JPY', 'KRW', 'UGX', 'RWF', 'XOF', 'XAF'].includes(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${currency} ${(minor / 10 ** digits).toFixed(digits)}`;
  }
}
