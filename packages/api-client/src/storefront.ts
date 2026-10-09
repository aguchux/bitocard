/**
 * BitoCard's own storefront (bitocard.com): the public `/v1/store` shapes and the home page layout, typed by hand
 * against the API presenters (`apps/api/src/storefront`). Types only, so the storefront's server code can use them
 * without the RTK Query client. Amounts are minor units.
 */

export type ProductCategory = 'gift_cards' | 'airtime' | 'data' | 'bills' | 'pay_tv' | 'esim' | 'software' | 'virtual_numbers' | 'virtual_cards' | 'mobile_money';

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
  mobile_money: 'Mobile money',
};

/** What a product can do (virtual numbers' calls and SMS), mirroring `apps/api/src/catalogue/features.ts`. */
export type ProductFeature = 'calls_in' | 'calls_out' | 'sms_in' | 'sms_out' | 'sms_people' | 'app_codes' | 'emergency' | 'caller_name' | 'fax';

export const productFeatureLabels: Record<ProductFeature, string> = {
  calls_in: 'Incoming calls',
  calls_out: 'Outgoing calls',
  sms_in: 'Receives SMS',
  sms_out: 'Sends SMS',
  sms_people: 'SMS from people',
  app_codes: 'Receives app codes',
  emergency: 'Emergency calls',
  caller_name: 'Shows caller name',
  fax: 'Receives fax',
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
  /** Up to three letters to show when there is no logo (MTN, GP, AM). */
  initials: string;
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
  /** What it can do, for icons and filters (empty for most categories). */
  features: ProductFeature[];
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

/** `on_sale` is false for a category not open yet (listed only in the menu, with `products: 0`). */
export type StoreCategory = { object: 'store_category'; category: ProductCategory; label: string; group: string | null; icon_url: string | null; image_url: string | null; products: number; on_sale: boolean };
/** A market BitoCard has set up, or another country with products on sale; `products` may be 0. */
export type StoreCountry = { code: string; name: string; products: number };
/** Every menu group is always listed; `on_sale` is false until one of its categories has products on sale. */
export type StoreNavigationGroup = { key: string; label: string; on_sale: boolean; categories: StoreCategory[]; brands: StoreBrand[] };
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
  /** False while the default layout is shown: nothing is published yet, or the page was taken offline. */
  published: boolean;
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

// -- Customers and checkout (M10b) -------------------------------------------------------------------------------

/** A way customers in a market can pay (`/v1/store/payment-methods?country=`). */
export type StorePaymentMethod = { object: 'payment_method'; id: string; label: string; description: string };
export type StorePaymentMethods = { object: 'list'; mode: 'live' | 'test'; data: StorePaymentMethod[] };

export type CheckoutStatus = 'awaiting_payment' | 'paid' | 'completed' | 'failed' | 'refund_pending' | 'refunded';

/** A delivered code, licence key or token: shown only on the customer's own order. */
export type StoreDelivery = { kind: string; code: string | null; pin: string | null; serial: string | null; details: Record<string, string> };

/** A customer's purchase: the payment, then the order placed once it is paid. Never shows costs or suppliers. */
/**
 * A customer's dispute about one of their orders, as the customer sees it: never staff notes, the store's report or its
 * recommendation. `escalated` means BitoCard is deciding it.
 */
export type StoreDispute = {
  object: 'dispute';
  id: string;
  reference: string;
  subject: string;
  topic: 'order' | 'payment' | 'funding' | 'trade' | 'other';
  status: 'open' | 'escalated' | 'resolved';
  checkout_id: string | null;
  outcome: 'resolved_by_reseller' | 'refunded_customer' | 'credited_reseller' | 'rejected' | 'chargeback_won' | 'chargeback_lost' | null;
  created_at: string;
  resolved_at: string | null;
  messages: Array<{ id: string; author: 'customer' | 'reseller' | 'bitocard' | 'system'; author_name: string | null; visibility: 'all'; body: string; created_at: string }>;
};

export type StoreCheckout = {
  object: 'checkout';
  id: string;
  mode: 'live' | 'test';
  status: CheckoutStatus;
  product: { id: string; key: string; name: string; category: ProductCategory; brand: string };
  face_value: number;
  face_currency: string;
  quantity: number;
  amount: number;
  currency: string;
  tax: { name: string; amount: number } | null;
  method: StorePaymentMethod;
  checkout_url: string | null;
  recipient: Record<string, string> | null;
  order: {
    id: string;
    status: 'processing' | 'completed' | 'failed' | 'refunded';
    receipt_number: string | null;
    completed_at: string | null;
    deliveries?: StoreDelivery[];
    redeem_instructions?: string | null;
  } | null;
  failure_reason: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The customer's figures for their account home (`/v1/store/account/summary`). */
export type StoreCustomerSummary = {
  object: 'customer_summary';
  /** Spent on delivered orders, by currency (the currency with the most delivered orders first). */
  orders_total: Array<{ amount: number; currency: string }>;
  orders: { total: number; in_progress: number };
  delivered_this_month: number;
};

/** How the store's customer account app looks (`/v1/store/app`): its menu on desktop. */
export type StoreApp = { object: 'store_app'; desktop_nav: 'rail' | 'bottom' };

/** Money in minor units (two decimal places) in a currency, for prices customers pay. */
export function formatPrice(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
