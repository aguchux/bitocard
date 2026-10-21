import { categoryLabels, navigationGroups, productSources, quickBuyCategories, sectionIcons } from '../../storefront/layout.js';
import { storeTemplates, templateKeys } from '../../stores/templates.js';
import { array, bool, constant, int, list, listExample, nullable, nullableInt, nullableStr, nullableTime, objectSchema, oneOf, ref, type Schema, shape, str, time, uuid } from '../schema.js';
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
    template: oneOf('The store template: what it sells and the sections its editor offers (see `GET /v1/store-templates`).', templateKeys),
    variant: str('The template’s design variant, for example `classic`.'),
    theme: str('The variant’s colour theme, for example `navy_pink`.'),
    focus: nullableStr('Single product stores: the product key the store sells; null for other templates.'),
    home: shape({ version: nullableInt('The published home page version; null until one is published (the design’s starting page is shown).'), published_at: nullableTime('When it was published.') }, 'The store’s home page.'),
    checkout_mode: oneOf(
      'Customer checkout on the store: `test` (sandbox: simulated payments and orders, for trying the store) until you switch it to `live`, which needs a verified business.',
      ['test', 'live'],
    ),
    ai_overage: oneOf('Beyond the month’s AI replies on BitoCard’s AI: `stop` (people answer) or `pay` (each reply billed as it goes).', ['stop', 'pay']),
    desktop_nav: nullableStr('Your customers’ account app menu on desktop: `rail` (side rail) or `bottom` (bottom bar); null follows BitoCard’s default. Phones and tablets always use the bottom bar.', { enum: ['rail', 'bottom', null] }),
    customer_verification: bool('Whether your store’s customers are asked for the identity check where BitoCard’s market rules require one (`true`), or never (`false`). Turning it off never marks anyone as checked.'),
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
  template: 'all_in_one',
  variant: 'classic',
  theme: 'navy_pink',
  focus: null,
  home: { version: 2, published_at: '2026-10-03T09:12:00.000Z' },
  checkout_mode: 'live',
  desktop_nav: null,
  ai_overage: 'stop',
  customer_verification: true,
  published_at: '2026-10-02T14:20:00.000Z',
  created_at: '2026-10-01T10:05:12.000Z',
};

const trafficCounts = {
  views: int('Pages viewed (never prefetches, files, or known crawlers and link previews).'),
  visitors: int('Visitors, each counted once a day (told apart only within the day, without cookies), added up over the days.'),
};
const storeTraffic = objectSchema(
  'Store traffic',
  {
    object: constant('store_traffic'),
    days: int('How many days are counted, today included.'),
    from: str('The first day counted (UTC).', { format: 'date' }),
    to: str('The last day counted: today (UTC).', { format: 'date' }),
    ...trafficCounts,
    hosts: array(shape({ host: str('The address: the store’s bitocard.com address or one of its own domains.'), ...trafficCounts }), 'Each address the store was visited on, most viewed first.'),
    daily: array(shape({ date: str('The day (UTC).', { format: 'date' }), ...trafficCounts }), 'Every day in the period, oldest first, with zeros on days without visits.'),
  },
  'Visits to your store, counted on BitoCard’s storefront without cookies or anything kept about your visitors.',
);

const colorField = (description: string) => str(description, { pattern: '^#[0-9a-f]{6}$' });
const themeColors = shape(
  {
    primary: colorField('Buttons, links and highlights.'),
    accent: colorField('Badges, prices and the second highlight.'),
    background: colorField('The page behind everything.'),
    surface: colorField('Cards and panels.'),
    ink: colorField('Body text.'),
    muted: colorField('Secondary text.'),
    heroFrom: colorField('Where the hero’s gradient starts.'),
    heroTo: colorField('Where it ends.'),
    heroInk: colorField('Text on the hero.'),
  },
  'The colour theme.',
);
const variantStyle = shape(
  {
    mode: oneOf('Light or dark pages.', ['light', 'dark']),
    hero: oneOf('The hero’s layout.', ['search', 'gradient', 'minimal', 'quick_buy', 'networks', 'billers', 'card_wall', 'boutique', 'neon', 'terminal', 'market', 'swap', 'spotlight', 'split', 'story', 'shield', 'devices', 'tunnel', 'desktop', 'rack', 'blueprint']),
    corners: oneOf('Corner style.', ['sharp', 'soft', 'round']),
    cards: oneOf('Card style.', ['flat', 'raised', 'outline', 'glass']),
    font: oneOf('Type style.', ['sans', 'display', 'mono', 'serif']),
    density: oneOf('Spacing between sections.', ['compact', 'comfortable', 'airy']),
  },
  'How the variant draws the store.',
);
const storeDesign = objectSchema(
  'Store design',
  {
    template: oneOf('The store template.', templateKeys),
    variant: str('The design variant.'),
    theme: str('The colour theme.'),
    style: variantStyle,
    colors: themeColors,
  },
  'How a store looks: its template, the variant’s style and the theme’s colours (the store’s own primary and accent colours win).',
);
const sectionTypes = ['hero', 'product_rail', 'category_grid', 'brand_grid', 'promo', 'trust_bar', 'quick_buy', 'crypto_quote', 'p2p_market', 'product_spotlight', 'features', 'faq'];
const storeTemplate = objectSchema(
  'Store template',
  {
    object: constant('store_template'),
    key: oneOf('Template key, sent as `template` when creating or changing a store.', templateKeys),
    name: str('Its name.'),
    tagline: str('One line saying what it is for.'),
    description: str('What the store sells and how it looks.'),
    categories: { type: ['array', 'null'], items: category(), description: 'The categories the store sells; null for every category, empty for none (the crypto desk sells crypto, not catalogue products).' },
    single_product: bool('The store sells one product, chosen as its `focus`.'),
    crypto: bool('The crypto desk: offered where crypto trading is switched on for you.'),
    sections: array(str('A section type.', { enum: sectionTypes }), 'Sections the store’s editor offers.'),
    available: bool('Whether you can use it now.'),
    reason: nullableStr('Why not, when it is not available.'),
    variants: array(
      shape({
        key: str('Variant key, sent as `variant`.'),
        name: str('Its name.'),
        description: str('How it looks.'),
        style: variantStyle,
        themes: array(shape({ key: str('Theme key, sent as `theme`.'), name: str('Its name.'), colors: themeColors }), 'Its colour themes; the first is the default.'),
      }),
      'Its design variants; the first is the default.',
    ),
  },
  'A store template with its design variants and colour themes.',
);
const editorSection: Schema = {
  type: 'object',
  description: 'A section as saved: `id`, `type`, `span`, `hidden` and its own fields (as on the store home page, without `data`).',
  required: ['id', 'type', 'span', 'hidden'],
  additionalProperties: true,
  properties: { id: str('Section ID, unique on the page.'), type: str('Section type.', { enum: sectionTypes }), span: { type: 'object' }, hidden: bool('Kept in the page but not shown.') },
};
const storeHomeEditor = objectSchema(
  'Store home editor',
  {
    object: constant('store_home_editor'),
    store_id: uuid('Store ID.'),
    template: oneOf('The store template.', templateKeys),
    variant: str('The design variant.'),
    sections_allowed: array(str('A section type.', { enum: sectionTypes }), 'Section types the store’s template offers.'),
    draft: array(editorSection, 'The page being edited: the draft, else what is published, else the design’s starting page.'),
    published: bool('False while shoppers see the design’s starting page.'),
    version: nullableInt('The published version; null until one is published.'),
    published_at: nullableTime('When it was published.'),
    updated_at: time('When the store was last changed.'),
  },
  'A store’s home page in SHQ’s editor.',
);
const storeHomeVersion = objectSchema('Store home version', {
  object: constant('store_home_version'),
  version: int('Version number.'),
  template: oneOf('The template it was made with.', templateKeys),
  variant: str('The variant it was made with.'),
  sections: int('How many sections it had.'),
  restorable: bool('Whether it can be restored (made with the store’s current template).'),
  published_at: time('When it was published.'),
});
const storeHomePreview = objectSchema('Store home preview', {
  object: constant('store_home_preview'),
  url: str('The draft on the store’s own address.', { format: 'uri' }),
  token: str('The preview token in the link.'),
  expires_at: time('When the link stops working (30 minutes).'),
});

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
    design: ref('StoreDesign'),
    focus: nullableStr('Single product stores: the product key the store sells; null for other templates.'),
    country: nullableStr('ISO 3166-1 alpha-2 country of the reseller’s business.'),
    currency: nullableStr('ISO 4217 currency the store sells in.'),
    checkout_mode: oneOf('`live`, or `test` while the store’s checkout is the sandbox (show shoppers that orders are not real).', ['test', 'live']),
    app: shape({ desktop_nav: oneOf('The customer account app’s menu on desktop: the store’s choice, else BitoCard’s default.', ['rail', 'bottom']) }, 'How the customer account app looks.'),
    domain: nullableStr('The store’s own main domain while it works (for example `adadigital.com`), else null.'),
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
  price: nullable(
    shape(
      {
        currency: str('The currency asked (ISO 4217).'),
        from: int('Lowest face value in `currency`, in minor units, rounded up to a whole unit.'),
        to: int('Highest face value in `currency`, in minor units, rounded up to a whole unit.'),
        rate: str('Minor units of `currency` per minor unit of `face_currency` (a decimal), for converting any face value the same way.'),
      },
      'The face values in the signed-in customer’s currency, at BitoCard’s rate. Only when `currency` is asked and has a rate; what the customer pays is quoted at checkout.',
    ),
  ),
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
    recipient_type: oneOf('What the customer gives when buying: `phone`, `smartcard`, `meter`, `account` (an account number, such as an internet subscription\'s), or `none`.', ['phone', 'smartcard', 'meter', 'account', 'none']),
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
    { ...heading, tag: str('Only brands with this tag; empty means featured brands first.'), categories: array(category(), 'Only brands selling in these categories; empty means every category.'), limit: int('Most brands to show.') },
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
    { items: array(shape({ icon: oneOf('Icon.', sectionIcons), title: str('Title.'), body: str('Text; may be empty.') }), '1 to 4 items.') },
    { type: 'null', description: 'Always null.' },
  ),
  section(
    'quick_buy',
    'Reseller stores: a form to top up or pay a bill at once.',
    { ...heading, categories: array(oneOf('A tab.', quickBuyCategories), 'The form’s tabs, in order.') },
    shape({ categories: array(shape({ category: category(), label: str('Tab label.'), brands: array(ref('StoreBrandListing'), 'Its networks or billers.'), products: array(ref('StoreProduct'), 'Its products (up to 48): each network’s top-up or bundles, each biller’s payment.') }), 'The tabs on sale here, with their networks or billers.') }),
  ),
  section(
    'crypto_quote',
    'Reseller stores (crypto desk): an instant buy and sell quote form.',
    { ...heading, assets: array(str('A coin code.'), 'Coins offered first; empty means every coin on sale.'), side: oneOf('The side shown first.', ['buy', 'sell']) },
    shape({ assets: array(shape({ code: str('Coin code, for example `USDT`.'), name: str('Coin name.') }), 'Coins offered, in order.') }),
  ),
  section(
    'p2p_market',
    'Reseller stores (crypto desk): the P2P market for a coin.',
    { ...heading, asset: str('Coin code.'), limit: int('Most offers to show.') },
    shape({ asset: nullable(shape({ code: str('Coin code.'), name: str('Coin name.') })) }),
  ),
  section(
    'product_spotlight',
    'One product in full with its buy form (the store’s focus product unless another is named).',
    { title: str('Heading; empty uses the product’s name.'), subtitle: str('Text; may be empty.'), productKey: str('A product key; empty means the store’s focus product.'), bullets: array(str('A selling point.')) },
    shape({ product: nullable(ref('StoreProductDetail')) }),
    { imageUrl: str('Image address (https).') },
  ),
  section(
    'features',
    'Features or steps as icon cards.',
    { ...heading, items: array(shape({ icon: oneOf('Icon.', sectionIcons), title: str('Title.'), body: str('Text; may be empty.') }), '1 to 6 items.') },
    { type: 'null', description: 'Always null.' },
  ),
  section('faq', 'Questions and answers.', { title: str('Heading.'), items: array(shape({ question: str('Question.'), answer: str('Answer.') }), '1 to 12 items.') }, { type: 'null', description: 'Always null.' }),
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
  price: null,
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
  { key: 'vpn', label: 'VPN', on_sale: false, categories: [category_('vpn', 'vpn', 0)], brands: [] },
  { key: 'rdp', label: 'RDP', on_sale: false, categories: [category_('rdp', 'rdp', 0)], brands: [] },
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
    { id: 'e5f6a7b8', type: 'brand_grid', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Popular brands', subtitle: 'Find the brands you love.', tag: '', categories: [], limit: 12, data: { brands: brandListings } },
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

const designExample = {
  template: 'all_in_one',
  variant: 'classic',
  theme: 'navy_pink',
  style: storeTemplates[0].variants[0].style,
  colors: { ...storeTemplates[0].variants[0].themes[0].colors, primary: '#070f4c', accent: '#ff2382' },
};
const templateExamples = storeTemplates.slice(0, 1).map(template => ({
  object: 'store_template',
  key: template.key,
  name: template.name,
  tagline: template.tagline,
  description: template.description,
  categories: template.categories,
  single_product: template.single,
  crypto: template.crypto,
  sections: template.sections,
  available: true,
  reason: null,
  variants: template.variants.map(variant => ({ key: variant.key, name: variant.name, description: variant.description, style: variant.style, themes: variant.themes.map(item => ({ key: item.key, name: item.name, colors: item.colors })) })),
}));
const editorExample = {
  object: 'store_home_editor',
  store_id: storeExample.id,
  template: 'all_in_one',
  variant: 'classic',
  sections_allowed: storeTemplates[0].sections,
  draft: [
    { id: 'a1b2c3d4', type: 'hero', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Digital products,', accent: 'delivered fast.', subtitle: 'Gift cards, top-ups, bills and more.', search: true, categoryChips: true },
    { id: 'b2c3d4e5', type: 'quick_buy', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Top up now', subtitle: '', categories: ['airtime', 'data'] },
  ],
  published: true,
  version: 3,
  published_at: '2026-10-17T10:00:00.000Z',
  updated_at: '2026-10-18T11:58:00.000Z',
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
    StoreTraffic: storeTraffic,
    StoreDesign: storeDesign,
    StoreTemplate: storeTemplate,
    StoreHomeEditor: storeHomeEditor,
    StoreHomeVersion: storeHomeVersion,
    StoreHomePreview: storeHomePreview,
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
    'GET /v1/stores/{id}/traffic': {
      status: 200,
      description: 'The store’s traffic over the period.',
      schema: 'StoreTraffic',
      example: {
        object: 'store_traffic',
        days: 3,
        from: '2026-10-16',
        to: '2026-10-18',
        views: 412,
        visitors: 131,
        hosts: [
          { host: 'adadigital.com', views: 301, visitors: 97 },
          { host: 'adadigital.bitocard.com', views: 111, visitors: 34 },
        ],
        daily: [
          { date: '2026-10-16', views: 120, visitors: 41 },
          { date: '2026-10-17', views: 158, visitors: 49 },
          { date: '2026-10-18', views: 134, visitors: 41 },
        ],
      },
    },
    'POST /v1/stores/{id}/publish': { status: 200, description: 'The store, now published.', schema: 'Store', example: storeExample },
    'GET /v1/store-templates': {
      status: 200,
      description: 'Every store template with its design variants and colour themes.',
      schema: list(ref('StoreTemplate'), {}, false),
      example: { object: 'list', data: templateExamples },
    },
    'GET /v1/stores/{id}/home': { status: 200, description: 'The store’s home page in the editor.', schema: 'StoreHomeEditor', example: editorExample },
    'PUT /v1/stores/{id}/home/draft': { status: 200, description: 'The saved draft.', schema: 'StoreHomeEditor', example: editorExample },
    'POST /v1/stores/{id}/home/publish': { status: 200, description: 'The page, now published as the next version.', schema: 'StoreHomeEditor', example: { ...editorExample, version: 4, published_at: '2026-10-18T12:00:00.000Z' } },
    'POST /v1/stores/{id}/home/reset': { status: 200, description: 'The draft, back to the design’s starting page.', schema: 'StoreHomeEditor', example: editorExample },
    'GET /v1/stores/{id}/home/versions': {
      status: 200,
      description: 'Published versions, newest first (the latest 50).',
      schema: list(ref('StoreHomeVersion'), {}, false),
      example: { object: 'list', data: [{ object: 'store_home_version', version: 3, template: 'all_in_one', variant: 'classic', sections: 6, restorable: true, published_at: '2026-10-17T10:00:00.000Z' }] },
    },
    'POST /v1/stores/{id}/home/restore': { status: 200, description: 'The draft, now that version.', schema: 'StoreHomeEditor', example: editorExample },
    'POST /v1/stores/{id}/home/preview': {
      status: 200,
      description: 'A preview link to the draft.',
      schema: 'StoreHomePreview',
      example: { object: 'store_home_preview', url: 'https://adadigital.bitocard.com/preview?token=1792332000000.c2lnbmF0dXJl', token: '1792332000000.c2lnbmF0dXJl', expires_at: '2026-10-18T12:30:00.000Z' },
    },
    'POST /v1/stores/{id}/unpublish': { status: 200, description: 'The store, back to a draft (a suspended store is returned unchanged).', schema: 'Store', example: { ...storeExample, status: 'draft' } },
    'GET /v1/storefronts/{subdomain}': {
      status: 200,
      description: 'The published store. Drafts, suspended stores and unknown addresses are not found.',
      schema: 'Storefront',
      example: {
        object: 'storefront',
        name: storeExample.name,
        subdomain: storeExample.subdomain,
        branding: storeExample.branding,
        design: designExample,
        focus: null,
        country: 'NG',
        currency: 'NGN',
        checkout_mode: 'live',
        app: { desktop_nav: 'rail' },
        domain: 'adadigital.com',
      },
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
