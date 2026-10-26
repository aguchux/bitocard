import { array, bool, constant, int, nullable, nullableInt, nullableStr, nullableTime, nullableUuid, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** B2B reselling for resellers (`/v1/resale`): the catalogue, store listings, notes, rules, suppliers and deals. */
const minor = (what: string) => int(`${what}, in minor units of \`currency\`.`);
const bps = (what: string) => int(`${what}, in basis points (100 = 1%).`);
const range = shape({ min: minor('The lowest price you may sell at'), max: minor('The highest price you may sell at') }, 'The prices you may sell at: the supplier’s price (or a deal’s floor below it) up to their markup limit.');
const photo = shape({ url: str('Image address.'), width: nullableInt('Width in pixels.'), height: nullableInt('Height in pixels.') });
const badges = array(oneOf('`phone_confirmed` or `id_checked` (BitoCard checked their identity).', ['phone_confirmed', 'id_checked']));
const supplierFields = { id: uuid('The supplier.'), name: str('First name and initial.'), member_since: time('When they joined BitoCard.'), badges };
const supplier = shape(supplierFields);
const states = ['selling', 'paused', 'removed', 'supplier_stopped', 'unavailable', 'supplier_paused', 'sold_out', 'price_out_of_range'];

const account = objectSchema('ResaleAccount', {
  object: constant('resale_account'),
  available: bool('Whether you can resell now.'),
  reason: nullable(oneOf('Why not: `switch_off`, `house_account`, `not_verified`, `no_country` or `resale_closed` (not open in your country).', ['switch_off', 'house_account', 'not_verified', 'no_country', 'resale_closed'])),
  country: nullableStr('Your business country.'),
  stores: array(shape({ id: uuid('Store ID.'), name: str('Store name.'), subdomain: str('Its address on bitocard.com.'), published: bool('Whether it is open to shoppers.') }), 'Your stores on the Resale shop template.'),
  reseller_fee_bps: nullableInt('BitoCard’s fee on your margin per sale, in basis points.'),
  reseller_fee_cap: nullableInt('The most that fee can be per sale, in minor units of your currency.'),
});

const catalogueProperties = {
  object: constant('resale_catalogue_listing'),
  id: uuid('The supplier’s listing.'),
  ref: int('Its number on BitoCard Shop.'),
  title: str('Its title, as the supplier wrote it.'),
  condition: nullable(oneOf('Condition.', ['new', 'used', 'untested', 'parts'])),
  category: nullable(shape({ slug: str('Category slug.'), name: str('Category name.') })),
  area: nullable(shape({ name: str('Area.'), state: nullableStr('State or region.') })),
  cover: nullable(photo),
  delivery: oneOf('Where the supplier delivers: `none` (meet-up in their area), `state` or `nationwide`.', ['none', 'state', 'nationwide']),
  currency: str('Currency, ISO 4217.'),
  supplier_price: minor('The supplier’s price: your floor unless a deal lowers it'),
  available: int('Units not yet sold or held by paid orders.'),
  discount_bps: bps('What you earn off the supplier’s price (yours or a deal’s, the bigger)'),
  floor_bps: bps('How far below the supplier’s price a deal lets you sell (0 without one)'),
  markup_max_bps: bps('How far above the supplier’s price you may sell'),
  deal_id: nullableUuid('Your running deal on this listing, if any.'),
  price_range: range,
  earnings_at_max: nullableInt('What you would keep per sale at the top of the range, after BitoCard’s fee, in minor units (null until BitoCard’s fee is set).'),
  supplier,
  in_stores: array(shape({ store_id: uuid('Your store.'), resale_listing_id: uuid('Its resale listing there.') }), 'Your stores already selling it.'),
  published_at: nullableTime('When it went live.'),
};
const catalogueListing = objectSchema('ResaleCatalogueListing', catalogueProperties);
const catalogueDetail = objectSchema('ResaleCatalogueListingDetail', {
  ...catalogueProperties,
  object: constant('resale_catalogue_listing_detail'),
  description: nullableStr('The supplier’s description (limited Markdown).'),
  features: array(shape({ key: str('Feature key.'), name: str('Feature name.'), unit: nullableStr('Unit.'), value: { type: ['string', 'number', 'boolean', 'null'], description: 'The value.' } })),
  photos: array(photo),
  video: nullable(shape({ url: str('Video address.'), poster_url: nullableStr('Poster image.'), duration_ms: nullableInt('Length in milliseconds.') })),
});

const price = objectSchema('ResalePrice', {
  object: constant('resale_price'),
  currency: str('Currency, ISO 4217.'),
  supplier_price: minor('The supplier’s price'),
  price: minor('Your price'),
  price_range: range,
  in_range: bool('Whether your price is inside the range (only then does it sell).'),
  discount_bps: bps('Your discount off the supplier’s price'),
  floor_bps: bps('Your deal’s floor below the supplier’s price'),
  markup_max_bps: bps('The supplier’s markup limit'),
  deal_id: nullableUuid('The deal it uses, if any.'),
  margin: minor('Your margin: your price less what the supplier receives'),
  reseller_fee: minor('BitoCard’s fee on your margin'),
  earnings: minor('What you keep per sale'),
  buyer_fee: minor('The buyer’s Safe pay fee, paid on top'),
  buyer_pays: minor('What the buyer pays in all'),
});

const note = nullable(
  shape({
    text: str('Your note.'),
    status: oneOf('`pending` (waiting for the supplier), `approved` (shown on the store), `refused` or `withdrawn` (the supplier took back their approval).', ['pending', 'approved', 'refused', 'withdrawn']),
    reason: nullableStr('Why the supplier refused or withdrew it.'),
    submitted_at: nullableTime('When you last changed it.'),
    decided_at: nullableTime('When the supplier decided.'),
  }),
);
const listing = objectSchema('ResaleListing', {
  object: constant('resale_listing'),
  id: uuid('Resale listing ID.'),
  store_id: uuid('Your store.'),
  listing_id: uuid('The supplier’s listing.'),
  supplier_relationship_id: uuid('Your relationship with the supplier (`/v1/resale/suppliers/{id}`).'),
  status: oneOf('What you set: `active`, `paused` or `removed`.', ['active', 'paused', 'removed']),
  state: oneOf(
    'What it can do now: `selling` (on sale), `paused` or `removed` (by you), `supplier_stopped` (the supplier stopped you reselling their listings), `unavailable` (no longer open to resellers), `supplier_paused`, `sold_out`, or `price_out_of_range` (reprice it).',
    states,
  ),
  title: str('The supplier’s title.'),
  cover: nullable(photo),
  currency: str('Currency, ISO 4217.'),
  supplier_price: nullableInt('The supplier’s price now, in minor units.'),
  markup_bps: nullableInt('Your markup over the supplier’s price, in basis points, when you set one.'),
  fixed_price: nullableInt('Your fixed price, in minor units, when you set one.'),
  price: minor('Your price now'),
  price_range: range,
  discount_bps: bps('Your discount off the supplier’s price'),
  deal_id: nullableUuid('The deal it uses, if any.'),
  margin: minor('Your margin per sale'),
  reseller_fee: minor('BitoCard’s fee on it'),
  earnings: minor('What you keep per sale'),
  available: int('Units left to sell.'),
  note,
  supplier,
  rule_id: nullableUuid('The auto-listing rule that added it.'),
  created_at: time('When it was added.'),
  updated_at: time('When it last changed.'),
});

const rule = objectSchema('ResaleRule', {
  object: constant('resale_rule'),
  id: uuid('Rule ID.'),
  store_id: uuid('The store listings are added to.'),
  category: nullable(shape({ slug: str('Category slug.'), name: str('Category name.') })),
  markup_bps: bps('Your markup, held to each listing’s limit'),
  excluded_supplier_ids: array(uuid('A supplier.'), 'Suppliers it never adds.'),
  active: bool('Whether it adds new listings.'),
  listings_added: int('Listings it has added.'),
  last_run_at: nullableTime('When it last looked for new listings.'),
  created_at: time('When it was made.'),
});

const deal = objectSchema('ResaleDeal', {
  object: constant('resale_deal'),
  id: uuid('Deal ID.'),
  supplier_relationship_id: uuid('The supplier relationship.'),
  listing: nullable(shape({ id: uuid('The listing.'), title: str('Its title.') })),
  discount_bps: bps('Your discount under the deal'),
  floor_bps: bps('How far below the supplier’s price you may sell under it'),
  status: oneOf('`offered` (waiting for your answer), `active`, `declined`, `withdrawn` or `ended`.', ['offered', 'active', 'declined', 'withdrawn', 'ended']),
  ends_at: nullableTime('When it ends by itself.'),
  responded_at: nullableTime('When you answered.'),
  ended_at: nullableTime('When it ended.'),
  ended_by: nullableStr('`supplier`, `reseller`, `expired` or `replaced` (by a newer deal you accepted).'),
  created_at: time('When it was offered.'),
});

const supplierRow = objectSchema('ResaleSupplier', {
  object: constant('resale_supplier'),
  id: uuid('Your relationship with the supplier.'),
  supplier: shape({ ...supplierFields, phone: nullableStr('Their confirmed phone number, while the chat is open.') }),
  stopped_by_supplier: bool('The supplier stopped you reselling their listings.'),
  closed_by_you: bool('You closed the chat.'),
  listings_in_stores: int('Their listings on your stores.'),
  unread: int('Messages you have not read.'),
  deals: array(ref('ResaleDeal'), 'Deals offered or running.'),
  last_message_at: nullableTime('The latest message.'),
  created_at: time('When you started working together.'),
});

const message = objectSchema('ResaleMessage', {
  object: constant('resale_message'),
  id: uuid('Message ID.'),
  author: oneOf('`supplier`, `reseller` or `system` (a deal offered, answered or ended).', ['supplier', 'reseller', 'system']),
  author_name: str('Who wrote it.'),
  mine: bool('Written by your side.'),
  body: str('The message.'),
  deal: nullable(ref('ResaleDeal')),
  created_at: time('When it was sent.'),
});

const page = (item: string) => shape({ object: constant('list'), data: array(ref(item)), total: int('How many match.'), offset: int('How many were skipped.'), limit: int('How many were asked for.') });
const deleted = (title: string, object: string) => objectSchema(title, { object: constant(object), id: uuid('ID.'), deleted: { type: 'boolean', const: true, description: 'Always `true`.' } });

const ids = {
  store: '5b2c7d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  listing: '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
  supplier: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  relationship: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  resale: '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918',
  rule: '4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d',
  deal: '6f7e8d9c-0b1a-4293-8475-a6b7c8d9e0f1',
  message: '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a',
};
const supplierExample = { id: ids.supplier, name: 'Chinedu O.', member_since: '2026-06-02T10:00:00.000Z', badges: ['phone_confirmed', 'id_checked'] };
const cover = { url: 'https://media.bitocard.com/bitocard/classifieds/listings/0f1e2d3c/1.jpg', width: 1600, height: 1200 };
const cardExample = {
  object: 'resale_catalogue_listing',
  id: ids.listing,
  ref: 104233,
  title: 'Hisense 50 inch 4K smart TV',
  condition: 'new',
  category: { slug: 'tvs', name: 'TVs' },
  area: { name: 'Gwarinpa', state: 'Abuja (FCT)' },
  cover,
  delivery: 'state',
  currency: 'NGN',
  supplier_price: 25000000,
  available: 4,
  discount_bps: 1000,
  floor_bps: 0,
  markup_max_bps: 3000,
  deal_id: null,
  price_range: { min: 25000000, max: 32500000 },
  earnings_at_max: 9700000,
  supplier: supplierExample,
  in_stores: [],
  published_at: '2026-10-20T08:30:00.000Z',
};
const detailExample = {
  ...cardExample,
  object: 'resale_catalogue_listing_detail',
  description: 'Brand new, sealed in the box with a one-year warranty.',
  features: [{ key: 'screen_size', name: 'Screen size', unit: 'in', value: 50 }],
  photos: [cover],
  video: null,
};
const priceExample = {
  object: 'resale_price',
  currency: 'NGN',
  supplier_price: 25000000,
  price: 28750000,
  price_range: { min: 25000000, max: 32500000 },
  in_range: true,
  discount_bps: 1000,
  floor_bps: 0,
  markup_max_bps: 3000,
  deal_id: null,
  margin: 6250000,
  reseller_fee: 187500,
  earnings: 6062500,
  buyer_fee: 100000,
  buyer_pays: 28850000,
};
const listingExample = {
  object: 'resale_listing',
  id: ids.resale,
  store_id: ids.store,
  listing_id: ids.listing,
  supplier_relationship_id: ids.relationship,
  status: 'active',
  state: 'selling',
  title: 'Hisense 50 inch 4K smart TV',
  cover,
  currency: 'NGN',
  supplier_price: 25000000,
  markup_bps: 1500,
  fixed_price: null,
  price: 28750000,
  price_range: { min: 25000000, max: 32500000 },
  discount_bps: 1000,
  deal_id: null,
  margin: 6250000,
  reseller_fee: 187500,
  earnings: 6062500,
  available: 4,
  note: null,
  supplier: supplierExample,
  rule_id: null,
  created_at: '2026-10-26T09:00:00.000Z',
  updated_at: '2026-10-26T09:00:00.000Z',
};
const notedExample = { ...listingExample, note: { text: 'Free wall bracket with every order this month.', status: 'pending', reason: null, submitted_at: '2026-10-26T09:05:00.000Z', decided_at: null } };
const ruleExample = {
  object: 'resale_rule',
  id: ids.rule,
  store_id: ids.store,
  category: { slug: 'tvs', name: 'TVs' },
  markup_bps: 1500,
  excluded_supplier_ids: [],
  active: true,
  listings_added: 12,
  last_run_at: '2026-10-26T09:15:00.000Z',
  created_at: '2026-10-26T09:00:00.000Z',
};
const dealExample = {
  object: 'resale_deal',
  id: ids.deal,
  supplier_relationship_id: ids.relationship,
  listing: null,
  discount_bps: 1500,
  floor_bps: 500,
  status: 'offered',
  ends_at: '2026-11-30T00:00:00.000Z',
  responded_at: null,
  ended_at: null,
  ended_by: null,
  created_at: '2026-10-26T10:00:00.000Z',
};
const acceptedExample = { ...dealExample, status: 'active', responded_at: '2026-10-26T10:30:00.000Z' };
const supplierRowExample = {
  object: 'resale_supplier',
  id: ids.relationship,
  supplier: { ...supplierExample, phone: '+2348031234567' },
  stopped_by_supplier: false,
  closed_by_you: false,
  listings_in_stores: 3,
  unread: 1,
  deals: [dealExample],
  last_message_at: '2026-10-26T10:00:00.000Z',
  created_at: '2026-10-26T09:00:00.000Z',
};
const messageExample = { object: 'resale_message', id: ids.message, author: 'reseller', author_name: 'Ada Obi', mine: true, body: 'Can you hold two units for a customer collecting on Friday?', deal: null, created_at: '2026-10-26T10:05:00.000Z' };

export const resaleDocs: DocsArea = {
  schemas: {
    ResaleAccount: account,
    ResaleCatalogueListing: catalogueListing,
    ResaleCatalogueListingDetail: catalogueDetail,
    ResalePrice: price,
    ResaleListing: listing,
    ResaleRule: rule,
    ResaleDeal: deal,
    ResaleSupplier: supplierRow,
    ResaleMessage: message,
  },
  responses: {
    'GET /v1/resale': {
      status: 200,
      description: 'Your reselling status.',
      schema: 'ResaleAccount',
      example: { object: 'resale_account', available: true, reason: null, country: 'NG', stores: [{ id: ids.store, name: 'Ada Gadgets', subdomain: 'adagadgets', published: true }], reseller_fee_bps: 300, reseller_fee_cap: 500000 },
    },
    'GET /v1/resale/catalogue': { status: 200, description: 'Resale listings in your country.', schema: page('ResaleCatalogueListing'), example: { object: 'list', data: [cardExample], total: 1, offset: 0, limit: 24 } },
    'GET /v1/resale/catalogue/{id}': { status: 200, description: 'The listing as the supplier wrote it, with its terms for you.', schema: 'ResaleCatalogueListingDetail', example: detailExample },
    'GET /v1/resale/price-preview': { status: 200, description: 'What one sale would give.', schema: 'ResalePrice', example: priceExample },
    'GET /v1/resale/listings': { status: 200, description: 'Your resale listings.', schema: page('ResaleListing'), example: { object: 'list', data: [listingExample], total: 1, offset: 0, limit: 50 } },
    'POST /v1/resale/listings': { status: 201, description: 'The listing on your store.', schema: 'ResaleListing', example: listingExample },
    'GET /v1/resale/listings/{id}': { status: 200, description: 'The resale listing.', schema: 'ResaleListing', example: listingExample },
    'PATCH /v1/resale/listings/{id}': { status: 200, description: 'The updated resale listing.', schema: 'ResaleListing', example: { ...listingExample, markup_bps: 2000, price: 30000000, margin: 7500000, reseller_fee: 225000, earnings: 7275000 } },
    'DELETE /v1/resale/listings/{id}': { status: 200, description: 'It is off the store.', schema: deleted('DeletedResaleListing', 'resale_listing'), example: { object: 'resale_listing', id: ids.resale, deleted: true } },
    'PUT /v1/resale/listings/{id}/note': { status: 200, description: 'The listing with your note waiting for the supplier.', schema: 'ResaleListing', example: notedExample },
    'DELETE /v1/resale/listings/{id}/note': { status: 200, description: 'The listing without a note.', schema: 'ResaleListing', example: listingExample },
    'GET /v1/resale/rules': { status: 200, description: 'Your rules.', schema: shape({ object: constant('list'), data: array(ref('ResaleRule')) }), example: { object: 'list', data: [ruleExample] } },
    'POST /v1/resale/rules': { status: 201, description: 'The rule, already applied to listings open now.', schema: 'ResaleRule', example: ruleExample },
    'PATCH /v1/resale/rules/{id}': { status: 200, description: 'The updated rule.', schema: 'ResaleRule', example: { ...ruleExample, markup_bps: 1200 } },
    'DELETE /v1/resale/rules/{id}': { status: 200, description: 'The rule is gone; listings it added stay.', schema: deleted('DeletedResaleRule', 'resale_rule'), example: { object: 'resale_rule', id: ids.rule, deleted: true } },
    'GET /v1/resale/suppliers': { status: 200, description: 'Your suppliers.', schema: shape({ object: constant('list'), data: array(ref('ResaleSupplier')) }), example: { object: 'list', data: [supplierRowExample] } },
    'POST /v1/resale/suppliers': { status: 200, description: 'The supplier you now work with.', schema: 'ResaleSupplier', example: { ...supplierRowExample, listings_in_stores: 0, unread: 0, deals: [], last_message_at: null } },
    'GET /v1/resale/suppliers/{id}': { status: 200, description: 'The supplier.', schema: 'ResaleSupplier', example: supplierRowExample },
    'GET /v1/resale/suppliers/{id}/messages': {
      status: 200,
      description: 'Messages, oldest first.',
      schema: shape({ object: constant('list'), data: array(ref('ResaleMessage')), closed: bool('Whether the chat is closed (either side).') }),
      example: { object: 'list', data: [{ ...messageExample, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', author: 'system', author_name: 'BitoCard', mine: false, body: 'Deal offered: 15% off every listing, selling from 5% below the price, until 30 Nov 2026.', deal: dealExample }, messageExample], closed: false },
    },
    'POST /v1/resale/suppliers/{id}/messages': { status: 201, description: 'Your message.', schema: 'ResaleMessage', example: messageExample },
    'POST /v1/resale/suppliers/{id}/close': { status: 200, description: 'The supplier, with the chat closed.', schema: 'ResaleSupplier', example: { ...supplierRowExample, closed_by_you: true, supplier: { ...supplierRowExample.supplier, phone: null } } },
    'POST /v1/resale/suppliers/{id}/reopen': { status: 200, description: 'The supplier, with the chat open again.', schema: 'ResaleSupplier', example: supplierRowExample },
    'POST /v1/resale/deals/{id}/accept': { status: 200, description: 'The running deal.', schema: 'ResaleDeal', example: acceptedExample },
    'POST /v1/resale/deals/{id}/decline': { status: 200, description: 'The declined deal.', schema: 'ResaleDeal', example: { ...dealExample, status: 'declined', responded_at: '2026-10-26T10:30:00.000Z' } },
    'POST /v1/resale/deals/{id}/end': { status: 200, description: 'The ended deal.', schema: 'ResaleDeal', example: { ...acceptedExample, status: 'ended', ended_at: '2026-10-28T12:00:00.000Z', ended_by: 'reseller' } },
  },
};
