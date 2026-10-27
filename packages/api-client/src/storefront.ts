/**
 * BitoCard's own storefront (bitocard.com): the public `/v1/store` shapes and the home page layout, typed by hand
 * against the API presenters (`apps/api/src/storefront`). Types only, so the storefront's server code can use them
 * without the RTK Query client. Amounts are minor units.
 */

export type ProductCategory = 'gift_cards' | 'airtime' | 'data' | 'bills' | 'pay_tv' | 'esim' | 'software' | 'vpn' | 'rdp' | 'virtual_numbers' | 'virtual_cards' | 'mobile_money';

export const categoryLabels: Record<ProductCategory, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data',
  bills: 'Bills',
  pay_tv: 'Pay-TV',
  esim: 'eSIMs',
  software: 'Software',
  virtual_numbers: 'Virtual numbers',
  vpn: 'VPN',
  rdp: 'RDP',
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
  /** The face values in the signed-in customer's currency (asked with `currency`), or null. */
  price: StoreLocalPrice | null;
  description: string | null;
  logo_url: string | null;
  /** What it can do, for icons and filters (empty for most categories). */
  features: ProductFeature[];
  brand: StoreBrand;
};

/**
 * A product's face values in the shopper's currency, at BitoCard's rate, rounded up to a whole unit. `rate` is the
 * shopper's minor units per face minor unit (a decimal string). What the customer pays is quoted at checkout.
 */
export type StoreLocalPrice = { currency: string; from: number; to: number; rate: string };

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
export type StoreCountry = { code: string; name: string; products: number; store_subdomain: string | null };
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
export type BrandGridSection = SectionBase & { type: 'brand_grid'; title: string; subtitle: string; tag: string; categories?: ProductCategory[]; limit: number };
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
export type TrustIcon = 'lock' | 'bolt' | 'card' | 'globe' | 'shield' | 'support' | 'gift' | 'phone' | 'coin' | 'chart' | 'clock' | 'star';
export type TrustBarSection = SectionBase & { type: 'trust_bar'; items: Array<{ icon: TrustIcon; title: string; body: string }> };

export type Section = HeroSection | ProductRailSection | CategoryGridSection | BrandGridSection | PromoSection | TrustBarSection;
export type SectionType = Section['type'];

// Reseller store templates' sections (bitocard.com's Storefront Manager offers the six above).
export type QuickBuyCategory = 'airtime' | 'data' | 'bills' | 'pay_tv' | 'mobile_money';
export type QuickBuySection = SectionBase & { type: 'quick_buy'; title: string; subtitle: string; categories: QuickBuyCategory[] };
export type CryptoQuoteSection = SectionBase & { type: 'crypto_quote'; title: string; subtitle: string; assets: string[]; side: 'buy' | 'sell' };
export type P2pMarketSection = SectionBase & { type: 'p2p_market'; title: string; subtitle: string; asset: string; limit: number };
export type ProductSpotlightSection = SectionBase & { type: 'product_spotlight'; title: string; subtitle: string; productKey: string; bullets: string[]; imageUrl?: string };
export type FeaturesSection = SectionBase & { type: 'features'; title: string; subtitle: string; items: Array<{ icon: TrustIcon; title: string; body: string }> };
export type FaqSection = SectionBase & { type: 'faq'; title: string; items: Array<{ question: string; answer: string }> };
// Resale shops (B2B reselling): BitoCard Shop suppliers' listings sold at the store's prices.
export type ListingRailSection = SectionBase & { type: 'listing_rail'; title: string; subtitle: string; source: 'newest' | 'price_low' | 'category'; category?: string; limit: number; viewAllHref?: string };
export type ListingGridSection = SectionBase & { type: 'listing_grid'; title: string; subtitle: string; category?: string; sort: 'newest' | 'price_asc' | 'price_desc'; limit: number };
export type ResaleCategoriesSection = SectionBase & { type: 'resale_categories'; title: string; subtitle: string; limit: number };
export type StoreSection = Section | QuickBuySection | CryptoQuoteSection | P2pMarketSection | ProductSpotlightSection | FeaturesSection | FaqSection | ListingRailSection | ListingGridSection | ResaleCategoriesSection;

export type ResalePhoto = { url: string; width: number | null; height: number | null };
/** Who supplies a resale listing: always shown with it, linking to their page on the store (`/suppliers/<id>`). */
export type ResaleSupplierLine = { id: string; name: string; member_since: string; badges: Array<'phone_confirmed' | 'id_checked'> };
/** A resale listing on sale on a Resale shop: the supplier's words and photos, the store's price, an approved note. */
export type ResaleStoreListing = {
  object: 'resale_store_listing';
  id: string;
  ref: number;
  slug: string;
  title: string;
  cover: ResalePhoto | null;
  photo_count: number;
  currency: string;
  price: number;
  condition: 'new' | 'used' | 'untested' | 'parts' | null;
  category: { slug: string; name: string } | null;
  area: { name: string; state: string | null } | null;
  delivery: 'none' | 'state' | 'nationwide';
  available: number;
  note: string | null;
  supplier: ResaleSupplierLine;
};
export type ResaleFeature = { key: string; name: string; unit: string | null; value: string | number | boolean | null };
export type ResaleStoreListingDetail = Omit<ResaleStoreListing, 'object'> & {
  object: 'resale_store_listing_detail';
  description: string | null;
  features: ResaleFeature[];
  photos: ResalePhoto[];
  video: { url: string; poster_url: string | null; duration_ms: number | null } | null;
  safety_checklist: string[];
  buyer_fee: number;
};
/** A supplier's page on a Resale shop: who they are and, when asked, one listing exactly as they wrote it (no price). */
export type ResaleStoreSupplier = ResaleSupplierLine & {
  object: 'resale_store_supplier';
  area: { name: string; state: string | null } | null;
  completed_sales: number;
  listings_here: number;
  listing: {
    ref: number;
    title: string;
    description: string | null;
    condition: string | null;
    category: { slug: string; name: string } | null;
    area: { name: string; state: string | null } | null;
    features: ResaleFeature[];
    photos: ResalePhoto[];
  } | null;
};
export type ResaleCategoryTile = { slug: string; name: string; count: number; cover: ResalePhoto | null };
export type ResaleStoreListingPage = { object: 'list'; data: ResaleStoreListing[]; total: number; offset: number; limit: number };
export type StoreSectionType = StoreSection['type'];
export type CryptoAssetRef = { code: string; name: string };

/** A section as the home page returns it: with what it shows. */
export type ResolvedSection =
  | (HeroSection & { data: { featured: StoreBrand[]; listings?: ResaleStoreListing[]; categories?: ResaleCategoryTile[] } })
  | (ProductRailSection & { data: { products: StoreProduct[] } })
  | (CategoryGridSection & { data: { categories: StoreCategory[] } })
  | (BrandGridSection & { data: { brands: StoreBrand[] } })
  | (PromoSection & { data: null })
  | (TrustBarSection & { data: null })
  | (QuickBuySection & { data: { categories: Array<{ category: QuickBuyCategory; label: string; brands: StoreBrand[]; products: StoreProduct[] }> } })
  | (CryptoQuoteSection & { data: { assets: CryptoAssetRef[] } })
  | (P2pMarketSection & { data: { asset: CryptoAssetRef | null } })
  | (ProductSpotlightSection & { data: { product: StoreProductDetail | null } })
  | (FeaturesSection & { data: null })
  | (FaqSection & { data: null })
  | (ListingRailSection & { data: { listings: ResaleStoreListing[]; total: number } })
  | (ListingGridSection & { data: { listings: ResaleStoreListing[]; total: number } })
  | (ResaleCategoriesSection & { data: { categories: ResaleCategoryTile[] } });

// -- Store templates: how a reseller's store looks (`GET /v1/storefronts/:subdomain` `design`) ----------------------

export type StoreTemplateKey = 'all_in_one' | 'topups' | 'gift_cards' | 'crypto_desk' | 'single_product' | 'vpn_shop' | 'rdp_shop' | 'resale_shop';
export type StoreThemeColors = { primary: string; accent: string; background: string; surface: string; ink: string; muted: string; heroFrom: string; heroTo: string; heroInk: string };
export type StoreVariantStyle = {
  mode: 'light' | 'dark';
  hero: 'search' | 'gradient' | 'minimal' | 'quick_buy' | 'networks' | 'billers' | 'card_wall' | 'boutique' | 'neon' | 'terminal' | 'market' | 'swap' | 'spotlight' | 'split' | 'story' | 'shield' | 'devices' | 'tunnel' | 'desktop' | 'rack' | 'blueprint' | 'showroom' | 'shelf' | 'aisle';
  corners: 'sharp' | 'soft' | 'round';
  cards: 'flat' | 'raised' | 'outline' | 'glass';
  font: 'sans' | 'display' | 'mono' | 'serif';
  density: 'compact' | 'comfortable' | 'airy';
};
export type StoreDesign = { template: StoreTemplateKey; variant: string; theme: string; style: StoreVariantStyle; colors: StoreThemeColors };

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
/** Minor-unit digits as the store shows them (the API's `wholeCurrencies` too). */
const currencyDigits = (currency: string) => (['JPY', 'KRW', 'UGX', 'RWF', 'XOF', 'XAF'].includes(currency) ? 0 : 2);

/**
 * A face value of the product in the shopper's currency (`price`), converted the way the API does (its rate, rounded up
 * to a whole unit), or null when the product has no local price or is already in that currency.
 */
export function localFace(value: number, product: Pick<StoreProduct, 'face_currency' | 'price'>) {
  const price = product.price;
  if (!price || price.currency === product.face_currency) return null;
  const unit = 10 ** currencyDigits(price.currency);
  return { amount: Math.ceil((value * Number(price.rate)) / unit - 1e-9) * unit, currency: price.currency };
}

export function formatFace(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${currency} ${(minor / 10 ** digits).toFixed(digits)}`;
  }
}

// -- Customers and checkout (M10b) -------------------------------------------------------------------------------

/** A way customers in a market can pay (`/v1/store/payment-methods?country=`). */
/** `networks`: the mobile money networks payers in the country can pay from (MTN, Telecel…); empty for cards and bank. */
export type StorePaymentMethod = { object: 'payment_method'; id: string; label: string; description: string; networks: string[] };
/** With wallets on (`wallet_required`) the only method is `wallet`: customers top their wallet up, then buy from it. */
export type StorePaymentMethods = { object: 'list'; mode: 'live' | 'test'; wallet_required?: boolean; data: StorePaymentMethod[] };

/** A customer's own bank account number: transfers into it top the wallet up. */
export type StoreReservedAccount = { object: 'reserved_account'; id: string; currency: string; bank_name: string; account_number: string; account_name: string };

/** A store customer's wallet in one market: spent only on the store's products, never withdrawn. */
export type StoreWallet = {
  object: 'customer_wallet';
  mode: 'live' | 'test';
  country: string;
  currency: string;
  /** Wallets are on for this store: purchases are paid only from the wallet. */
  enabled: boolean;
  balance: number;
  top_up_methods: StorePaymentMethod[];
  reserved_accounts: StoreReservedAccount[];
  reserved_accounts_available: boolean;
  reserved_account_needs_bvn: boolean;
  /** Both wallets: the customer's country's currency first (`primary`), then US dollars. */
  wallets: StoreWalletSummary[];
};

export type StoreWalletSummary = { currency: string; primary: boolean; balance: number };

/** Paying from the wallet: what each wallet would pay for a quote (US dollars at BitoCard's rate; `amount` null while unavailable). */
export type StoreWalletOption = { currency: string; amount: number | null; balance: number; enough: boolean };

export type StoreWalletTopUp = {
  object: 'customer_top_up';
  id: string;
  mode: 'live' | 'test';
  status: 'pending' | 'succeeded' | 'failed';
  source: 'checkout' | 'bank_transfer';
  amount: number;
  currency: string;
  method: { id: string; label: string };
  charged: { amount: number; currency: string } | null;
  checkout_url: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export type StoreWalletTransaction = {
  object: 'wallet_transaction';
  id: string;
  /** customer_top_up, customer_deposit, wallet_purchase or checkout_refund. */
  type: string;
  description: string;
  /** Positive in, negative out. */
  amount: number;
  currency: string;
  checkout_id: string | null;
  top_up_id: string | null;
  created_at: string;
};

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
  outcome: 'resolved_by_reseller' | 'refunded_customer' | 'credited_reseller' | 'rejected' | 'chargeback_won' | 'chargeback_lost' | 'chargeback_accepted' | null;
  created_at: string;
  resolved_at: string | null;
  messages: Array<{ id: string; author: 'customer' | 'reseller' | 'bitocard' | 'system'; author_name: string | null; visibility: 'all'; body: string; created_at: string }>;
};

/** A customer's support ticket to their store, as they see it (never staff notes or staff names). */
export type StoreTicket = {
  object: 'support_ticket';
  id: string;
  reference: string;
  /** open: waiting for the store; pending: waiting for the customer; resolved. */
  status: 'open' | 'pending' | 'resolved';
  category: 'order' | 'payment' | 'account' | 'product' | 'technical' | 'other';
  subject: string;
  checkout_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  messages: Array<{ id: string; author: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; author_name: string | null; author_avatar_url: string | null; visibility: 'all'; body: string; created_at: string }>;
};

/** The customer's (or visitor's) live chat with their store. */
export type StoreChat = {
  object: 'support_chat';
  id: string;
  /** bot: an assistant answers; waiting: for a person; with_staff: a person is answering; closed. */
  status: 'bot' | 'waiting' | 'with_staff' | 'closed';
  ticket_reference: string | null;
  created_at: string;
  closed_at: string | null;
  messages: StoreChatMessage[];
};
/** The store's chat assistant as customers see it. */
export type StoreAssistant = { name: string; avatar_url: string | null; greeting: string | null };
/** A photo or PDF sent in a chat (read through the store's own server). */
export type StoreChatAttachment = { id: string; name: string; content_type: 'image/jpeg' | 'image/png' | 'application/pdf'; size: number; width: number | null; height: number | null };
/** Messages carry who wrote them: the person answering by name, or the assistant by its name. */
export type StoreChatMessage = { id: string; author: 'customer' | 'reseller' | 'bitocard' | 'bot' | 'system'; author_name: string | null; author_avatar_url: string | null; body: string; attachments: StoreChatAttachment[]; created_at: string };
/** A signed-out visitor chatting with the store: the name and email they gave. */
export type StoreChatVisitor = { name: string; email: string };

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
  /** Charged by the gateway in another currency (cards in US dollars where Stripe cannot take this one); null otherwise. */
  charged: { amount: number; currency: string } | null;
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
/** install_prompt: the store asks shoppers to install it as an app (BitoCard's own stores only, an admin switch). */
export type StoreApp = { object: 'store_app'; desktop_nav: 'rail' | 'bottom'; install_prompt: boolean };

/** Money in minor units (two decimal places) in a currency, for prices customers pay. */
export function formatPrice(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** An eSIM on its order's page: status, data use (bytes) and expiry. Its activation code is on the order. */
export type StoreEsim = {
  object: 'esim';
  id: string;
  iccid: string;
  status: 'ready' | 'installed' | 'active' | 'used_up' | 'expired' | 'cancelled' | 'revoked' | 'suspended';
  data: { total: number | null; used: number | null; remaining: number | null; updated_at: string | null };
  expires_at: string | null;
  top_ups: 'none' | 'data' | 'days';
  /** Never installed: cancelling it refunds the order. */
  cancellable: boolean;
};

/** The top-ups an eSIM takes now at the store's price, and the customer's wallets that can pay (`available` false: the store tops it up). */
export type StoreEsimTopUpOptions = {
  object: 'list';
  /** `prices`: what it costs from each wallet (the US dollar price at BitoCard's rate; null while unavailable). */
  data: Array<{ id: string; name: string; data: string; days: number; amount: number; currency: string; prices: Array<{ currency: string; amount: number | null }> }>;
  wallets: Array<{ currency: string; primary: boolean; balance: number }>;
  available: boolean;
};

export type StoreEsimTopUp = { object: 'esim_top_up'; id: string; name: string; status: 'pending' | 'completed' | 'failed'; amount: number; currency: string; failure_reason: string | null };

/** VPN access an order bought, on its order page: never the supplier; the sign-in details are the order's delivery. */
export type StoreVpn = {
  object: 'vpn_subscription';
  id: string;
  status: 'provisioning' | 'active' | 'expired' | 'revoked' | 'suspended' | 'failed' | 'needs_review';
  term_days: number;
  devices: number;
  renews_automatically: false;
  starts_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  password_changed_at: string | null;
};

// -- Crypto wallets and P2P ------------------------------------------------------------------------------------------

/**
 * One asset in the customer's crypto wallets. Amounts are decimal strings with every place (`"12.500000"`).
 * `enabled` is false for an asset admins switched off that the customer still holds: it can be withdrawn, not traded
 * or deposited (such assets are listed only while the customer holds some).
 */
export type StoreCryptoBalance = { object: 'crypto_balance'; asset: string; name: string; decimals: number; enabled: boolean; available: string; locked: string; frozen: string; withdrawing: string; total: string };

/** `GET /v1/store/crypto`: the customer's crypto wallets, their P2P cash (minor units) and what they can do now. */
export type StoreCryptoWallets = {
  object: 'crypto_wallets';
  mode: 'live' | 'test';
  country: string;
  currency: string;
  enabled: boolean;
  p2p_enabled: boolean;
  /** The global market (US dollars, across countries) is open to the customer, even where their own market is off. */
  global_enabled: boolean;
  /** The crypto declaration (not a US or UK citizen or resident), needed to trade: confirm it with `POST /v1/store/crypto/declaration { version }`. */
  declaration: { version: string; declared: boolean };
  verified: boolean;
  frozen: boolean;
  assets: StoreCryptoBalance[];
  /** proceeds: P2P sales (withdrawable); wallet: top-ups; locked: behind buy ads; paying_out: on its way to a bank. */
  cash: { currency: string; proceeds: number; wallet: number; locked: number; paying_out: number };
  /** USD balances when the customer's home currency is not USD. */
  usd_cash?: { currency: 'USD'; proceeds: number; wallet: number; locked: number; paying_out: number };
  /** P2P money in other countries' currencies (from selling in their markets): spent in those markets, never cashed out by the customer. */
  other_cash: Array<{ currency: string; proceeds: number; locked: number }>;
};

export type StoreCryptoTransaction = {
  object: 'crypto_transaction';
  id: string;
  type: string;
  balance: 'available' | 'locked' | 'frozen' | 'withdrawing';
  description: string;
  asset: string;
  amount: string;
  trade_id: string | null;
  ad_id: string | null;
  created_at: string;
};

/** An ad on the P2P market. `side: sell` means its trader sells (you buy); `price` is fiat minor units per whole unit. */
export type StoreP2pAd = {
  object: 'p2p_ad';
  id: string;
  mode: 'live' | 'test';
  side: 'buy' | 'sell';
  asset: string;
  decimals: number;
  currency: string;
  country: string;
  /** The ad's market: a country code, or `WW` for the global market (US dollars, across countries). */
  market: string;
  price: number;
  available: string;
  total: string;
  filled: string;
  min_fiat: number;
  max_fiat: number;
  fee_bps: number;
  terms: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  mine: boolean;
  trader: { nickname: string; trades_30d: number; trades_total: number };
  created_at: string;
  updated_at: string;
};

/**
 * A market the customer may trade in now (`GET /v1/store/p2p/markets`): their own (`home`, local currency and US
 * dollars), the global market (`WW`, US dollars) and other countries taking cross-border trades (their currency only).
 */
export type StoreP2pMarket = { object: 'p2p_market'; market: string; name: string; currencies: string[]; home: boolean; cross_border: boolean };

/** What a trade would be: the crypto, BitoCard's fee, what the buyer receives and the fiat (minor units). */
export type StoreP2pTerms = { asset: string; currency: string; price: number; amount: string; fee: string; received: string; fiat: number };
/** `side`: what the viewer does (buy from a sell ad, sell to a buy ad). */
export type StoreP2pQuote = StoreP2pTerms & { object: 'p2p_quote'; side: 'buy' | 'sell'; ad?: StoreP2pAd; fee_bps: number };

export type StoreP2pTrade = StoreP2pTerms & {
  object: 'p2p_trade';
  id: string;
  /** P2P-000123. */
  number: string;
  mode: 'live' | 'test';
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  ad_id: string;
  /** The market traded in: a country code, or `WW` for the global market. */
  market: string;
  counterparty: { nickname: string };
  settlement: 'instant' | 'classic';
  status: string;
  created_at: string;
  completed_at: string | null;
};

/** A network an asset can be deposited on now (`token`: ERC-20, BEP-20, TRC-20; null for the chain's own coin). */
export type StoreCryptoNetwork = { object: 'crypto_network'; asset: string; chain: string; name: string; token: string | null; confirmations: number };

/** The customer's own deposit address for an asset on a chain. */
export type StoreCryptoDepositAddress = { object: 'crypto_deposit_address'; mode: 'live' | 'test'; asset: string; chain: string; network: string; address: string; contract: string | null; confirmations: number; watch_until: string };

export type StoreCryptoDeposit = {
  object: 'crypto_deposit';
  id: string;
  asset: string;
  chain: string;
  network: string;
  tx_hash: string;
  amount: string;
  status: 'pending' | 'credited' | 'ignored' | 'failed';
  confirmations: number;
  confirmations_needed: number | null;
  created_at: string;
  credited_at: string | null;
};

/** `GET /v1/store/crypto/withdrawal-networks`: where an asset can be sent now, with BitoCard's fee and the minimum. */
export type StoreWithdrawalNetworks = {
  object: 'crypto_withdrawal_networks';
  asset: string;
  daily_limit: string;
  remaining_today: string;
  data: Array<{ object: 'crypto_network'; chain: string; name: string; fee: string; minimum: string; confirmations: number }>;
};

/** A saved withdrawal address: `ready` once its 24-hour wait is over (`usable_from`). */
export type StoreWithdrawalAddress = { object: 'crypto_withdrawal_address'; id: string; mode: 'live' | 'test'; chain: string; network: string; address: string; label: string; usable_from: string; ready: boolean; created_at: string };

export type StoreWithdrawalPreview = { object: 'crypto_withdrawal_preview'; mode: 'live' | 'test'; asset: string; chain: string; network: string; address: string; amount: string; fee: string; total: string; needs_approval: boolean };

export type StoreCryptoWithdrawal = {
  object: 'crypto_withdrawal';
  id: string;
  /** CW-000123. */
  number: string;
  mode: 'live' | 'test';
  asset: string;
  chain: string;
  network: string;
  address: string;
  amount: string;
  fee: string;
  total: string;
  status: 'awaiting_code' | 'review' | 'queued' | 'submitting' | 'broadcast' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  review_reason: string | null;
  tx_hash: string | null;
  confirmations: number;
  created_at: string;
  completed_at: string | null;
};

/** `GET /v1/store/crypto/cash`: P2P money (minor units): what can be paid out now, and what waits for the payout hold. */
export type StoreP2pCash = { object: 'p2p_cash'; mode: 'live' | 'test'; currency: string; balance: number; held: number; available: number; hold_days: number; minimum: number };

export type StoreCustomerBankAccount = {
  object: 'customer_bank_account';
  id: string;
  mode: 'live' | 'test';
  currency: string;
  bank_name: string;
  account_number_last4: string;
  account_name: string;
  payouts_available_from: string;
  ready: boolean;
  created_at: string;
};

export type StoreCustomerPayout = {
  object: 'customer_payout';
  id: string;
  mode: 'live' | 'test';
  status: 'pending' | 'processing' | 'paid' | 'failed';
  amount: number;
  currency: string;
  bank_account: { bank_name: string; account_number_last4: string } | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export type StoreP2pProfile = { object: 'p2p_profile'; nickname: string; nickname_chosen: boolean; trades_30d: number; trades_total: number };

// -- Instant exchange -------------------------------------------------------------------------------------------------

/** One side of a coin on the exchange: BitoCard's price (fiat minor units per whole coin), limits and what its reserve allows. */
export type StoreExchangeSide = { price: number; markup_bps: number; min_fiat: number; max_fiat: number | null; available_amount: string; available_fiat: number };

/** A coin on the exchange: its live market price, BitoCard's buy and sell sides, or why it is closed. */
export type StoreExchangeAsset = {
  desk: { id: string; name: string };
  asset: string;
  name: string;
  decimals: number;
  /** The customer's available balance of the coin. */
  holding: string;
  market: { usd: string; change_24h: number | null; updated_at: string | null; price: number | null } | null;
  closed: 'not_offered' | 'price_unavailable' | 'conversion_unavailable' | null;
  buy: StoreExchangeSide | null;
  sell: StoreExchangeSide | null;
};

/** `GET /v1/store/exchange`: what the customer can trade with BitoCard now. */
export type StoreExchange = {
  object: 'exchange';
  mode: 'live' | 'test';
  currency: string;
  desk: { id: string; name: string };
  enabled: boolean;
  reason: string | null;
  message: string | null;
  quote_seconds: number;
  balances: { proceeds: number; wallet: number };
  assets: StoreExchangeAsset[];
};

/** A price held for `quote_seconds`: exactly what the trade moves. */
export type StoreExchangeQuote = {
  object: 'exchange_quote';
  id: string;
  mode: 'live' | 'test';
  side: 'buy' | 'sell';
  asset: string;
  currency: string;
  amount: string;
  fiat: number;
  price: number;
  markup_bps: number;
  market_usd: string;
  market_updated_at: string | null;
  fx_rate: string;
  expires_at: string;
  created_at: string;
  /** The most the desk's reserve allows on this side right now, in coins and money (fiat minor units). */
  available: { amount: string; fiat: number };
  /** True when the quote is exactly that most: the trade takes everything the reserve has available. */
  capped: boolean;
};

export type StoreExchangeTrade = {
  object: 'exchange_trade';
  id: string;
  /** EX-000123. */
  number: string;
  mode: 'live' | 'test';
  desk: { id: string; name: string };
  side: 'buy' | 'sell';
  asset: string;
  currency: string;
  amount: string;
  fiat: number;
  price: number;
  markup_bps: number;
  from_proceeds: number;
  from_wallet: number;
  created_at: string;
};

/** A crypto amount for people: trailing zeros dropped, at least two places for stablecoins ("49.9", "0.0002"). */
export function formatCrypto(amount: string, asset?: string) {
  const [whole, fraction = ''] = amount.split('.');
  let trimmed = fraction.replace(/0+$/, '');
  if (asset && ['USDT', 'USDC'].includes(asset) && trimmed.length < 2) trimmed = trimmed.padEnd(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${trimmed ? `.${trimmed}` : ''}${asset ? ` ${asset}` : ''}`;
}

// -- Spin and win ---------------------------------------------------------------------------------------------------

/** The coins the wheel pays in. */
export type StoreSpinAsset = 'USDT' | 'USDC' | 'BNB';

/** Why a customer cannot spin (null when they can). */
export type StoreSpinBlock = 'not_enabled' | 'crypto_not_enabled' | 'email_not_verified' | 'customer_verification_required' | 'crypto_account_frozen' | 'claimed_elsewhere';

/** One of the wheel's segments, clockwise from the top (index 0 first). `usd`: its value, "0.05". */
export type StoreSpinSegment = { index: number; asset: StoreSpinAsset; usd: string };

/**
 * The customer's spins: what they have won so far and today's spins (up to `daily_limit` a day). The total and the
 * number of spins are never shown. `next_spin_at`: when they can spin again, while today's spins are used and some
 * remain; `finished` once they have had them all.
 */
export type StoreSpinAllowance = {
  won_usd: string;
  spins_used: number;
  today_left: number;
  daily_limit: number;
  next_spin_at: string | null;
  finished: boolean;
};

/**
 * What the customer holds in spin rewards: per coin (`usd` its value now, null while BNB has no price) and in all.
 * Rewards are never withdrawn or traded: they are exchanged into the store wallet, in `exchange_currencies`.
 */
export type StoreSpinRewardBalance = {
  coins: Array<{ asset: StoreSpinAsset | string; amount: string; usd: string | null }>;
  usd: string;
  exchange_currencies: string[];
};

/** A spin won: `amount` in the coin (a decimal string), `usd` its value, `segment` where the wheel landed. */
export type StoreSpinWin = { id: string; number: number; asset: StoreSpinAsset | string; amount: string; usd: string; segment: number; created_at: string };

/** `GET /v1/store/spins`: the wheel, whether the customer can spin (and why not), their allowance and latest wins. */
export type StoreSpinRewards = {
  object: 'spin_rewards';
  mode: 'live' | 'test';
  enabled: boolean;
  reason: StoreSpinBlock | null;
  segments: StoreSpinSegment[];
  /** Spins a day in the customer's market (admins set it per market). */
  daily_limit: number;
  /** Null until the first spin. */
  allowance: StoreSpinAllowance | null;
  recent: StoreSpinWin[];
  rewards: StoreSpinRewardBalance;
};

/** `POST /v1/store/spins`: the spin's outcome, decided by the server, and the allowance after it. */
export type StoreSpin = { object: 'spin'; id: string; number: number; segment: number; asset: StoreSpinAsset | string; amount: string; usd: string; allowance: StoreSpinAllowance };

/** `POST /v1/store/spins/exchange { preview: true }`: what the rewards are worth in a wallet's currency now. */
export type StoreSpinExchangePreview = { object: 'spin_exchange_preview'; usd: string; currency: string; amount: number; rate: string; coins: StoreSpinRewardBalance['coins'] };

/** `POST /v1/store/spins/exchange`: the rewards moved into the store wallet (`amount` in its minor units). */
export type StoreSpinExchange = { object: 'spin_exchange'; id: string; usd: string; currency: string; amount: number; rate: string; created_at: string };

/** Signed-out Customer Catcher state. The opaque claim token is kept by the storefront server, never in this shape. */
export type StorePublicSpinRewards = Omit<StoreSpinRewards, 'object' | 'mode' | 'reason'> & {
  object: 'public_spin_rewards';
  reason: string | null;
  claim_expires_at: string;
};

export type StorePublicSpinResult = { spin: StoreSpin; status: StorePublicSpinRewards };

/** A saved visitor win shown once after sign-up/sign-in, or the reason it was invalidated. */
export type StorePublicSpinClaim = {
  object: 'public_spin_claim';
  status: 'active' | 'claimed' | 'invalidated' | 'expired';
  reason: string | null;
  message?: string | null;
  usd?: string;
  spins?: number;
  currencies?: Array<{ currency: string; amount: number }>;
  id?: string;
  currency?: string;
  amount?: number;
};
