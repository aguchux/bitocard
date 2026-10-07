import { categoryLabels, navigationGroups, productSources } from '../../storefront/layout.js';
import { array, bool, constant, int, list, listExample, nullableInt, nullableStr, nullableTime, objectSchema, oneOf, ref, type Schema, shape, str, time, uuid } from '../schema.js';
import { category, features } from './commerce.js';
import type { DocsArea } from './index.js';

const groupKeys = navigationGroups.map(group => group.key);
const color = (description: string) => str(description, { pattern: '^#[0-9a-f]{6}$' });

// -- Reseller stores --------------------------------------------------------------------------------------------

const branding = shape(
  {
    logo_url: nullableStr('HTTPS address of the store logo, or null for none.'),
    primary_color: color('Main colour, as lower-case hex.'),
    accent_color: color('Accent colour, as lower-case hex.'),
  },
  'How the store looks.',
);

const store = objectSchema(
  'Store',
  {
    object: constant('store'),
    id: uuid('Store ID.'),
    name: str('Store name, shown to your customers.'),
    subdomain: str('The store address: `<subdomain>.bitocard.com`. Can change only while the store is a draft.'),
    url: str('The store’s full address.', { format: 'uri' }),
    status: oneOf('`draft` (not shown to anyone), `published` (live), or `suspended` by BitoCard (contact support).', ['draft', 'published', 'suspended']),
    branding,
    checkout_mode: oneOf(
      'Customer checkout on the store: `test` (sandbox: simulated payments and orders, for trying the store) until you switch it to `live`, which needs a verified business.',
      ['test', 'live'],
    ),
    published_at: nullableTime('When the store was first published; kept when it is unpublished.'),
    created_at: time('When the store was created.'),
  },
  'Your BitoCard-hosted storefront on `<subdomain>.bitocard.com`.',
);

const storeExample = {
  object: 'store',
  id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
  name: 'Ada Digital',
  subdomain: 'adadigital',
  url: 'https://adadigital.bitocard.com',
  status: 'published',
  branding: { logo_url: 'https://cdn.bitocard.com/bitocard/resellers/2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f/store/logos/6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png', primary_color: '#070f4c', accent_color: '#ff2382' },
  checkout_mode: 'live',
  published_at: '2026-10-02T14:20:00.000Z',
  created_at: '2026-10-01T10:05:12.000Z',
};

const subdomainAvailability = objectSchema('Subdomain availability', {
  object: constant('subdomain_availability'),
  subdomain: str('The name checked, in lower case.'),
  available: bool('Whether a store can use it.'),
  reason: nullableStr('Why it cannot be used (wrong format, reserved or taken); null when available.'),
});

const storefront = objectSchema(
  'Storefront',
  {
    object: constant('storefront'),
    name: str('Store name.'),
    subdomain: str('The store address: `<subdomain>.bitocard.com`.'),
    branding,
    country: nullableStr('ISO 3166-1 alpha-2 country of the reseller’s business.'),
    currency: nullableStr('ISO 4217 currency the store sells in.'),
    checkout_mode: oneOf('`live`, or `test` while the store’s checkout is the sandbox (show shoppers that orders are not real).', ['test', 'live']),
  },
  'What a published store needs to render: its name, branding, country, currency and checkout mode.',
);

// -- BitoCard's store (bitocard.com) ----------------------------------------------------------------------------

const brandProperties: Record<string, Schema> = {
  object: constant('store_brand'),
  slug: str('Brand slug, for example `mtn` or `amazon`; filter products with `brand`.'),
  name: str('Brand name.'),
  company: nullableStr('The company behind the brand, for example `MultiChoice` for DStv.'),
  description: nullableStr('About the brand.'),
  logo_url: nullableStr('Logo address. Show it on a white tile; with none, show `initials` on `color`.'),
  image_url: nullableStr('Gift card art or brand image.'),
  color: nullableStr('Brand colour as hex, for example `#FFCB05`.'),
  initials: str('Up to three letters to show when there is no logo.'),
  tags: array(str('A tag.'), 'Tags for filters, for example `mobile`, `gaming` or `tv`.'),
};
const storeBrand = objectSchema('Store brand', brandProperties, 'A brand as the store shows it.');
const storeBrandListing = objectSchema(
  'Store brand listing',
  { ...brandProperties, products: int('Products of this brand on sale.'), featured: bool('Featured by BitoCard (shown first).') },
  'A brand on sale, with how many of its products are on sale.',
);
const storeBrandMatch = objectSchema('Store brand match', { ...brandProperties, products: int('Matching products of this brand.') }, 'A brand matching a search.');

const productProperties: Record<string, Schema> = {
  object: constant('store_product'),
  id: uuid('Product ID.'),
  key: str('Product key (`category:country:brand:variant`), used in the product page address.'),
  name: str('Product name.'),
  category: category(),
  category_label: str('The category’s name, for example `Gift cards`.'),
  country: str('ISO 3166-1 alpha-2 country where the product is used.'),
  country_name: str('The country’s name in English.'),
  global: bool('Usable in any country (gift cards, eSIMs, software, numbers) rather than one market’s services.'),
  face_currency: str('ISO 4217 currency of the face values.'),
  denomination_type: oneOf('`fixed` face values, or a `range` the customer chooses within.', ['fixed', 'range']),
  from: int('Lowest face value, in minor units of `face_currency`.'),
  to: int('Highest face value, in minor units of `face_currency`.'),
  description: nullableStr('About the product.'),
  logo_url: nullableStr('The product logo from BitoCard files: the product image, else the brand logo; or null.'),
  features,
  brand: ref('StoreBrand'),
};
const storeProduct = objectSchema('Store product', productProperties, 'A product on sale, with its face values. Prices are quoted at checkout.');
const storeProductDetail = objectSchema(
  'Store product detail',
  {
    ...productProperties,
    denominations: { type: ['array', 'null'], items: { type: 'integer' }, description: 'Face values to choose from, in minor units of `face_currency`; null for a range.' },
    range: { ...shape({ min: int('Lowest face value, in minor units.'), max: int('Highest face value, in minor units.') }), type: ['object', 'null'], description: 'The range a customer may enter; null for fixed values.' },
    recipient_type: oneOf('What the customer gives when buying: `phone`, `smartcard`, `meter`, or `none`.', ['phone', 'smartcard', 'meter', 'none']),
    redeem_instructions: nullableStr('How to redeem it, where it applies.'),
    other_countries: array(ref('StoreProduct'), 'The same brand’s products elsewhere (up to 8).'),
    related: array(ref('StoreProduct'), 'Other brands in the same category (up to 8).'),
  },
  'A product page: its face values, what the customer gives, how to redeem it, and related products.',
);

const storeCategory = objectSchema(
  'Store category',
  {
    object: constant('store_category'),
    category: category(),
    label: str('The category’s name.'),
    group: { type: ['string', 'null'], enum: [...groupKeys, null], description: 'The menu group it belongs to.' },
    icon_url: nullableStr('Uploaded icon, if any.'),
    image_url: nullableStr('Uploaded banner image (4:1), if any.'),
    products: int('Products on sale.'),
    on_sale: bool('On sale now; false for categories not open yet (shown as “Soon”).'),
  },
  'A product category.',
);
const storeCategoryMatch = objectSchema('Store category match', {
  object: constant('store_category'),
  category: category(),
  label: str('The category’s name.'),
  group: { type: ['string', 'null'], enum: [...groupKeys, null], description: 'The menu group it belongs to.' },
  products: int('Products on sale in the category.'),
});
const storeCountry = objectSchema('Store country', {
  code: str('ISO 3166-1 alpha-2 country code.'),
  name: str('Country name.'),
  products: int('Products on sale there (zero is possible for a market not stocked yet).'),
});
const navigationGroup = objectSchema('Store menu group', {
  key: oneOf('Group key; filter products with `group`.', groupKeys),
  label: str('Group name.'),
  on_sale: bool('Whether any of its categories is on sale.'),
  categories: array(ref('StoreCategory'), 'Its categories, on sale or not.'),
  brands: array(ref('StoreBrandListing'), 'Its top brands (up to 8); empty when nothing is on sale.'),
});

// Home page sections: the Storefront Manager layout, each with the `data` it shows.
const span = shape(
  {
    lg: int('Desktop width out of 12 columns.', { enum: [3, 4, 6, 8, 9, 12] }),
    md: int('Tablet width out of 6 columns.', { enum: [3, 6] }),
    rows: int('Rows tall on desktop and tablet (2 lets a tall section sit beside two stacked ones).', { enum: [1, 2] }),
  },
  'Where the section sits on the grid. Phones show every section full width, in order.',
);
const href = str('A path on the store, such as `/catalogs/esim`, or an https address.');
const section = (type: string, description: string, fields: Record<string, Schema>, data: Schema, optional: Record<string, Schema> = {}): Schema => {
  const required = { id: str('Section ID, unique on the page.'), type: constant(type), span, hidden: bool('Always false here: hidden sections are left out.'), ...fields, data };
  return { type: 'object', title: `${type} section`, description, required: Object.keys(required), additionalProperties: false, properties: { ...required, ...optional } };
};
const heading = { title: str('Heading.'), subtitle: str('Subheading; may be empty.') };
const sections = [
  section(
    'hero',
    'The banner with search.',
    { title: str('Heading.'), accent: str('Second, highlighted line of the heading; may be empty.'), subtitle: str('Text under the heading; may be empty.'), search: bool('Show the search bar with its country picker.'), categoryChips: bool('Show a shortcut chip per menu group.') },
    shape({ featured: array(ref('StoreBrandListing'), 'Up to 6 brands for the floating cards, those with a logo first.') }),
  ),
  section(
    'product_rail',
    'A row of products.',
    {
      ...heading,
      source: oneOf('Where the products come from: `trending` (most sold in 7 days), `top_selling` (30 days), `new`, `featured` brands, a `category`, a `brand`, or `manual` (hand-picked).', productSources),
      productKeys: array(str('A product key.'), 'Hand-picked products, for `manual`.'),
      limit: int('Most products to show.'),
      filters: bool('Show filter chips (All, the visitor’s country, Global, brand tags).'),
      layout: oneOf('Show as `cards` or a `list`.', ['cards', 'list']),
    },
    shape({ products: array(ref('StoreProduct')) }),
    { category: category('For `source: category`.'), brand: str('Brand slug, for `source: brand`.'), viewAllHref: href },
  ),
  section('category_grid', 'Category tiles.', { ...heading, categories: array(category(), 'The categories chosen, in order; empty means every category on sale.') }, shape({ categories: array(ref('StoreCategory')) })),
  section(
    'brand_grid',
    'Brand tiles.',
    { ...heading, tag: str('Only brands with this tag; empty means featured brands first.'), limit: int('Most brands to show.') },
    shape({ brands: array(ref('StoreBrandListing')) }),
  ),
  section(
    'promo',
    'A promotional card.',
    {
      ...heading,
      body: str('Body text; may be empty.'),
      bullets: array(str('A bullet point.')),
      theme: oneOf('The card’s colours.', ['pink', 'sky', 'navy', 'light', 'sunset']),
      illustration: oneOf('A drawn illustration shown when there is no image.', ['store', 'esim', 'gift', 'globe', 'none']),
    },
    { type: 'null', description: 'Always null.' },
    { cta: shape({ label: str('Button text.'), href }, 'The button.'), imageUrl: str('Image address (https).') },
  ),
  section(
    'trust_bar',
    'Reassurances in a row.',
    { items: array(shape({ icon: oneOf('Icon.', ['lock', 'bolt', 'card', 'globe', 'shield', 'support']), title: str('Title.'), body: str('Text; may be empty.') }), '1 to 4 items.') },
    { type: 'null', description: 'Always null.' },
  ),
];

const storeHome = objectSchema(
  'Store home',
  {
    object: constant('store_home'),
    preview: bool('True when showing the draft through a preview link.'),
    published: bool('False while the default layout is shown (nothing published yet, or taken offline).'),
    version: nullableInt('The published version shown; null for the default layout or a preview.'),
    published_at: nullableTime('When that version was published.'),
    sections: array({ oneOf: sections }, 'The page’s visible sections in order, each filled in with what it shows (`data`).'),
    navigation: array(ref('StoreMenuGroup'), 'The menu: every group, always in the same order.'),
    countries: array(ref('StoreCountry'), 'Countries for the country picker, by name.'),
  },
  'The home page of bitocard.com, ready to render.',
);

const storeSearch = objectSchema(
  'Store search',
  {
    object: constant('store_search'),
    query: str('What was searched for.'),
    products: array(ref('StoreProduct'), 'Matching products, best first.'),
    brands: array(ref('StoreBrandMatch'), 'Brands of the best-matching products (up to 8).'),
    categories: array(ref('StoreCategoryMatch'), 'Categories matching by name or by the words people use (“top up”, “electricity”).'),
    countries: array(ref('StoreCountry'), 'Matching countries (up to 5).'),
  },
  'Search results across products, brands, categories and countries.',
);

// -- Examples ---------------------------------------------------------------------------------------------------

const mtnBrand = { object: 'store_brand', slug: 'mtn', name: 'MTN', company: 'MTN Group', description: null, logo_url: 'https://bitocard.com/brand-icons/mtn.svg', image_url: null, color: '#FFCB05', initials: 'MTN', tags: ['mobile'] };
const dstvBrand = { object: 'store_brand', slug: 'dstv', name: 'DStv', company: 'MultiChoice', description: null, logo_url: null, image_url: null, color: '#0033A0', initials: 'DS', tags: ['tv'] };
const amazonBrand = { object: 'store_brand', slug: 'amazon', name: 'Amazon', company: 'Amazon.com, Inc.', description: null, logo_url: 'https://bitocard.com/brand-icons/amazon.svg', image_url: 'https://bitocard.com/brand-cards/amazon.webp', color: '#232F3E', initials: 'AM', tags: ['shopping'] };

const mtnProduct = {
  object: 'store_product',
  id: 'c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f',
  key: 'airtime:NG:mtn:topup',
  name: 'MTN Nigeria airtime',
  category: 'airtime',
  category_label: categoryLabels.airtime,
  country: 'NG',
  country_name: 'Nigeria',
  global: false,
  face_currency: 'NGN',
  denomination_type: 'range',
  from: 5_000,
  to: 5_000_000,
  description: 'Top up any MTN Nigeria prepaid line.',
  logo_url: null,
  features: [],
  brand: mtnBrand,
};
const amazonProduct = {
  ...mtnProduct,
  id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d',
  key: 'gift_cards:US:amazon-us',
  name: 'Amazon US',
  category: 'gift_cards',
  category_label: categoryLabels.gift_cards,
  country: 'US',
  country_name: 'United States',
  global: true,
  face_currency: 'USD',
  denomination_type: 'fixed',
  from: 1_000,
  to: 5_000,
  description: null,
  brand: amazonBrand,
};
const dstvProduct = {
  ...mtnProduct,
  id: 'e1d2c3b4-a596-4877-8a9b-0c1d2e3f4a5b',
  key: 'pay_tv:NG:dstv:dstv-padi',
  name: 'DStv Padi',
  category: 'pay_tv',
  category_label: categoryLabels.pay_tv,
  denomination_type: 'fixed',
  from: 440_000,
  to: 440_000,
  description: 'One month of DStv Padi.',
  brand: dstvBrand,
};
const ghanaAirtime = {
  ...mtnProduct,
  id: 'b3c4d5e6-f7a8-4b9c-8d0e-1f2a3b4c5d6e',
  key: 'airtime:GH:mtn:topup',
  name: 'MTN Ghana airtime',
  country: 'GH',
  country_name: 'Ghana',
  face_currency: 'GHS',
  from: 100,
  to: 100_000,
  description: null,
};

const listing = (brand: object, products: number, featured: boolean) => ({ ...brand, products, featured });
const brandListings = [listing(mtnBrand, 3, true), listing(amazonBrand, 1, true), listing(dstvBrand, 6, false)];

const category_ = (key: keyof typeof categoryLabels, group: string, products: number, onSale = products > 0) => ({
  object: 'store_category',
  category: key,
  label: categoryLabels[key],
  group,
  icon_url: null,
  image_url: null,
  products,
  on_sale: onSale,
});
const giftCards = category_('gift_cards', 'gift-cards', 24);
const airtime = category_('airtime', 'mobile', 6);
const data = category_('data', 'mobile', 18);
const payTv = category_('pay_tv', 'bills', 12);
const bills = category_('bills', 'bills', 4);

const countries = [
  { code: 'GH', name: 'Ghana', products: 9 },
  { code: 'KE', name: 'Kenya', products: 0 },
  { code: 'NG', name: 'Nigeria', products: 40 },
  { code: 'US', name: 'United States', products: 12 },
];

const navigation = [
  { key: 'gift-cards', label: 'Gift cards', on_sale: true, categories: [giftCards], brands: [listing(amazonBrand, 1, true)] },
  { key: 'mobile', label: 'Mobile', on_sale: true, categories: [airtime, data, category_('mobile_money', 'mobile', 0), category_('virtual_numbers', 'mobile', 0)], brands: [listing(mtnBrand, 3, true)] },
  { key: 'bills', label: 'Bills', on_sale: true, categories: [bills, payTv], brands: [listing(dstvBrand, 6, false)] },
  { key: 'esims', label: 'eSIMs', on_sale: false, categories: [category_('esim', 'esims', 0)], brands: [] },
  { key: 'software', label: 'Software', on_sale: false, categories: [category_('software', 'software', 0)], brands: [] },
  { key: 'virtual-cards', label: 'Virtual cards', on_sale: false, categories: [category_('virtual_cards', 'virtual-cards', 0)], brands: [] },
];

const homeExample = {
  object: 'store_home',
  preview: false,
  published: true,
  version: 3,
  published_at: '2026-10-05T16:00:00.000Z',
  sections: [
    {
      id: 'a1b2c3d4',
      type: 'hero',
      span: { lg: 12, md: 6, rows: 1 },
      hidden: false,
      title: 'One marketplace.',
      accent: 'More ways to pay.',
      subtitle: 'Shop gift cards, top up mobile, pay bills, and explore digital essentials.',
      search: true,
      categoryChips: true,
      data: { featured: brandListings },
    },
    {
      id: 'b2c3d4e5',
      type: 'product_rail',
      span: { lg: 8, md: 6, rows: 2 },
      hidden: false,
      title: 'Trending now',
      subtitle: 'Popular brands. Great selection. Delivered digitally.',
      source: 'trending',
      productKeys: [],
      limit: 6,
      filters: true,
      layout: 'cards',
      viewAllHref: '/catalogs',
      data: { products: [mtnProduct, dstvProduct, amazonProduct] },
    },
    {
      id: 'c3d4e5f6',
      type: 'promo',
      span: { lg: 4, md: 3, rows: 1 },
      hidden: false,
      title: 'Reseller spotlight',
      subtitle: 'Create your own digital store and sell top brands.',
      body: '',
      bullets: ['Wide product selection', 'Flexible pricing', 'Your brand, your customers'],
      cta: { label: 'Start selling', href: '/resellers' },
      theme: 'pink',
      illustration: 'store',
      data: null,
    },
    { id: 'd4e5f6a7', type: 'category_grid', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Shop by category', subtitle: 'Everything digital, in one place.', categories: [], data: { categories: [giftCards, airtime, data, bills, payTv] } },
    { id: 'e5f6a7b8', type: 'brand_grid', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Popular brands', subtitle: 'Find the brands you love.', tag: '', limit: 12, data: { brands: brandListings } },
    {
      id: 'f6a7b8c9',
      type: 'trust_bar',
      span: { lg: 12, md: 6, rows: 1 },
      hidden: false,
      items: [
        { icon: 'lock', title: 'Secure checkout', body: 'Your information is protected.' },
        { icon: 'bolt', title: 'Digital delivery', body: 'Most products arrive in minutes.' },
      ],
      data: null,
    },
  ],
  navigation,
  countries,
};

export const storesDocs: DocsArea = {
  schemas: {
    Store: store,
    SubdomainAvailability: subdomainAvailability,
    Storefront: storefront,
    StoreBrand: storeBrand,
    StoreBrandListing: storeBrandListing,
    StoreBrandMatch: storeBrandMatch,
    StoreProduct: storeProduct,
    StoreProductDetail: storeProductDetail,
    StoreCategory: storeCategory,
    StoreCategoryMatch: storeCategoryMatch,
    StoreCountry: storeCountry,
    StoreMenuGroup: navigationGroup,
    StoreHome: storeHome,
    StoreSearch: storeSearch,
  },
  responses: {
    'GET /v1/stores/subdomains/{subdomain}': {
      status: 200,
      description: 'Whether the address is free.',
      schema: 'SubdomainAvailability',
      example: { object: 'subdomain_availability', subdomain: 'adadigital', available: false, reason: 'This name is taken.' },
    },
    'POST /v1/stores': { status: 201, description: 'The new store, as a draft.', schema: 'Store', example: { ...storeExample, status: 'draft', checkout_mode: 'test', published_at: null, branding: { ...storeExample.branding, logo_url: null } } },
    'GET /v1/stores': { status: 200, description: 'Your stores (one for now), oldest first.', schema: list(ref('Store'), {}, false), example: { object: 'list', data: [storeExample] } },
    'PATCH /v1/stores/{id}': { status: 200, description: 'The updated store.', schema: 'Store', example: storeExample },
    'POST /v1/stores/{id}/publish': { status: 200, description: 'The store, now published.', schema: 'Store', example: storeExample },
    'POST /v1/stores/{id}/unpublish': { status: 200, description: 'The store, back to a draft (a suspended store is returned unchanged).', schema: 'Store', example: { ...storeExample, status: 'draft' } },
    'GET /v1/storefronts/{subdomain}': {
      status: 200,
      description: 'The published store. Drafts, suspended stores and unknown addresses are not found.',
      schema: 'Storefront',
      example: { object: 'storefront', name: storeExample.name, subdomain: storeExample.subdomain, branding: storeExample.branding, country: 'NG', currency: 'NGN', checkout_mode: 'live' },
    },
    'GET /v1/store/home': { status: 200, description: 'The home page. Until a layout is published, the default layout (`published: false`).', schema: 'StoreHome', example: homeExample },
    'GET /v1/store/products': {
      status: 200,
      description: 'A page of products on sale.',
      schema: list(ref('StoreProduct'), { total: int('How many products match, across every page.') }),
      example: { ...listExample([mtnProduct, ghanaAirtime], true), total: 6 },
    },
    'GET /v1/store/products/{key}': {
      status: 200,
      description: 'The product page.',
      schema: 'StoreProductDetail',
      example: { ...dstvProduct, denominations: [440_000], range: null, recipient_type: 'smartcard', redeem_instructions: null, other_countries: [], related: [] },
    },
    'GET /v1/store/search': {
      status: 200,
      description: 'Search results, best matches first.',
      schema: 'StoreSearch',
      example: {
        object: 'store_search',
        query: 'mtn',
        products: [mtnProduct, ghanaAirtime],
        brands: [{ ...mtnBrand, products: 2 }],
        categories: [],
        countries: [],
      },
    },
    'GET /v1/store/categories': { status: 200, description: 'Categories on sale.', schema: list(ref('StoreCategory'), {}, false), example: { object: 'list', data: [giftCards, airtime, data, bills, payTv] } },
    'GET /v1/store/brands': {
      status: 200,
      description: 'Brands on sale: featured first (in BitoCard’s order), then by how many products are on sale.',
      schema: list(ref('StoreBrandListing'), {}, false),
      example: { object: 'list', data: brandListings },
    },
    'GET /v1/store/navigation': {
      status: 200,
      description: 'The menu and the countries.',
      schema: objectSchema('Store navigation', {
        object: constant('store_navigation'),
        groups: array(ref('StoreMenuGroup'), 'Every menu group, always in the same order.'),
        countries: array(ref('StoreCountry'), 'Countries for the country picker, by name.'),
      }),
      example: { object: 'store_navigation', groups: navigation, countries },
    },
  },
};
