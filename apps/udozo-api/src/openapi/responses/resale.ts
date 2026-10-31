import { eventObjectSchemas, exampleResaleOrder } from '../../webhooks/openapi.js';
import { array, bool, constant, int, nullable, nullableInt, nullableStr, nullableTime, nullableUuid, objectSchema, oneOf, ref, type Schema, shape, str, time, uuid } from '../schema.js';
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
  floor_bps: bps('How far below the supplier’s price your deal lets you sell (0 without one)'),
  markup_max_bps: bps('How far above the supplier’s price you may sell'),
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
  floor_bps: 0,
  markup_max_bps: 3000,
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

/** A resale order's own fields: defined once with the webhook events (`ResaleOrder`), which carry the same object. */
const orderFields = (eventObjectSchemas.ResaleOrder as { properties: Record<string, Schema> }).properties;
const orderDetail = objectSchema(
  'ResaleOrderDetail',
  {
    ...orderFields,
    supplier: shape({ name: str('The supplier, first name and initial: the seller of record.') }),
    buyer: nullable(
      shape(
        { name: str('The buyer’s name.'), email: str('Their email address.'), phone: nullableStr('Their confirmed mobile number, E.164.'), address: nullableStr('The delivery address, for a delivery.') },
        'The buyer’s details, from the supplier’s acceptance until 30 days after the order ends (null otherwise). Use them only for this order; every view is logged.',
      ),
    ),
    note_shown: nullableStr('Your approved note as the buyer saw it when buying.'),
    shipment: nullable(
      shape(
        {
          courier: nullableStr('The courier.'),
          tracking_number: nullableStr('The tracking number.'),
          tracking_url: nullableStr('The tracking page.'),
          delivered_at: nullableTime('When it was reported delivered.'),
          events: array(shape({ status: oneOf('What happened.', ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned']), note: nullableStr('A note with it.'), reported_by: oneOf('Who reported it.', ['seller', 'courier', 'bitocard']), at: time('When.') }), 'The tracking timeline, oldest first.'),
          dispatch_photos: array(shape({ id: uuid('Photo ID.'), url: str('The image itself (JPEG or PNG), read with your API key or session.'), content_type: str('`image/jpeg` or `image/png`.'), width: nullableInt('Width in pixels.'), height: nullableInt('Height in pixels.') }), 'The supplier’s photos of the item and the sealed parcel before shipping.'),
        },
        'For a delivery: its courier, tracking and timeline (null for a hand-over in person).',
      ),
    ),
    deadlines: shape({ accept_by: time('The supplier accepts by then.'), pay_by: nullableTime('Not used for resale orders (always null).'), handover_by: nullableTime('The supplier hands it over or ships it by then.'), confirm_by: nullableTime('Released by then unless the buyer confirms sooner or disputes it.') }),
    timeline: shape({
      requested_at: time('When it was bought.'),
      locked_at: nullableTime('When the buyer’s money was locked.'),
      accepted_at: nullableTime('When the supplier accepted it.'),
      paid_at: nullableTime('When the money went to BitoCard’s hold (on acceptance).'),
      sent_at: nullableTime('When it was shipped.'),
      released_at: nullableTime('When the money was released.'),
      refunded_at: nullableTime('When the buyer was refunded.'),
      closed_at: nullableTime('When it ended before acceptance.'),
    }),
    ended_by: nullable(oneOf('Who ended it early.', ['buyer', 'seller', 'reseller', 'bitocard'])),
    end_reason: nullableStr('Why, when given.'),
    dispute: nullable(shape({ id: uuid('Dispute ID.'), status: oneOf('`open` or `decided`.', ['open', 'decided']), reason: oneOf('The buyer’s reason.', ['not_received', 'not_as_described', 'damaged', 'other']), decision: nullable(oneOf('BitoCard’s decision.', ['refund', 'partial', 'release'])) })),
  },
  'A resale order with the buyer’s details (once accepted), its shipment and its timeline.',
);
const orderMessage = objectSchema('ResaleOrderMessage', {
  object: constant('resale_order_message'),
  id: uuid('Message ID.'),
  thread: oneOf('`order` (with the buyer) or `trade` (with the supplier).', ['order', 'trade']),
  from: oneOf('`me` (your team), `buyer`, `supplier` or `bitocard`.', ['me', 'buyer', 'supplier', 'reseller', 'bitocard']),
  name: str('Who wrote it: the buyer’s or supplier’s first name and initial, your store’s name, or BitoCard.'),
  body: str('The message.'),
  created_at: time('When it was written.'),
});
const disputeMessage = objectSchema('ResaleDisputeMessage', {
  object: constant('classified_dispute_message'),
  id: uuid('Message ID.'),
  from: oneOf('`me` (your team), `them` (the buyer or the supplier) or `bitocard`.', ['me', 'them', 'bitocard']),
  name: str('Who wrote it: the buyer’s or supplier’s first name and initial, your store’s name, or BitoCard.'),
  body: str('The message (may be empty beside a photo).'),
  photo: nullable(shape({ url: str('The photo itself (JPEG or PNG), read with your API key or session.'), content_type: nullableStr('Its type.'), size: nullableInt('Bytes.'), width: nullableInt('Width in pixels.'), height: nullableInt('Height in pixels.') })),
  created_at: time('When it was written.'),
});
const dispute = objectSchema(
  'ResaleOrderDispute',
  {
    object: constant('classified_dispute'),
    id: uuid('Dispute ID.'),
    order_id: uuid('The resale order.'),
    reason: oneOf('The buyer’s reason.', ['not_received', 'not_as_described', 'damaged', 'other']),
    status: oneOf('`open` (BitoCard is deciding; the money stays held) or `decided`.', ['open', 'decided']),
    decision: nullable(oneOf('`refund` (all back to the buyer), `partial` (part back, the rest split between you and the supplier in proportion) or `release` (paid as normal).', ['refund', 'partial', 'release'])),
    fault: nullable(oneOf('Whose strike an upheld dispute is: `supplier`, `reseller` (your store’s note or claims misled the buyer) or `none`.', ['supplier', 'reseller', 'none'])),
    refund: nullableInt('What a part refund gave back of the price, in minor units.'),
    note: nullableStr('BitoCard’s note on its decision.'),
    decided_at: nullableTime('When BitoCard decided.'),
    created_at: time('When the buyer opened it.'),
    messages: array(ref('ResaleDisputeMessage'), 'Every message, oldest first.'),
  },
  'A buyer’s dispute on one of your resale orders, with its messages.',
);
const disputeMessageExample = { object: 'classified_dispute_message', id: '6e7f8a9b-0c1d-4e2f-8a3b-5c6d7e8f9a0b', from: 'me', name: 'Gadget Hub', body: 'The listing showed the corner crack in photo 4; we pointed the buyer to it before they bought.', photo: null, created_at: '2026-10-29T10:00:00.000Z' };
const disputeExample = {
  object: 'classified_dispute',
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  order_id: '7b6a5c4d-3e2f-4a1b-9c0d-8e7f6a5b4c3d',
  reason: 'damaged',
  status: 'open',
  decision: null,
  fault: null,
  refund: null,
  note: null,
  decided_at: null,
  created_at: '2026-10-29T09:00:00.000Z',
  messages: [
    { ...disputeMessageExample, id: '7f8a9b0c-1d2e-4f3a-9b4c-6d7e8f9a0b1c', from: 'them', name: 'Amaka E.', body: 'The screen arrived cracked in one corner.', photo: { url: '/v1/resale/orders/7b6a5c4d-3e2f-4a1b-9c0d-8e7f6a5b4c3d/dispute/photos/7f8a9b0c-1d2e-4f3a-9b4c-6d7e8f9a0b1c', content_type: 'image/jpeg', size: 182044, width: 1600, height: 1200 }, created_at: '2026-10-29T09:00:00.000Z' },
    disputeMessageExample,
  ],
};
const orderDetailExample = {
  ...exampleResaleOrder({ status: 'sent', accepted_at: '2026-10-26T10:02:00.000Z', courier: 'GIG Logistics', tracking_number: 'GIG123456789', tracking_url: 'https://giglogistics.com/track/GIG123456789', updated_at: '2026-10-27T08:30:00.000Z' }),
  supplier: { name: 'Chinedu O.' },
  buyer: { name: 'Amaka Eze', email: 'amaka@example.com', phone: '+2348031234567', address: '12 Admiralty Way, Lekki Phase 1, Lagos' },
  note_shown: 'Free wall bracket with every order this month.',
  shipment: {
    courier: 'GIG Logistics',
    tracking_number: 'GIG123456789',
    tracking_url: 'https://giglogistics.com/track/GIG123456789',
    delivered_at: null,
    events: [{ status: 'shipped', note: 'GIG Logistics GIG123456789', reported_by: 'seller', at: '2026-10-27T08:30:00.000Z' }],
    dispatch_photos: [
      { id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', url: '/v1/resale/orders/7b6a5c4d-3e2f-4a1b-9c0d-8e7f6a5b4c3d/dispatch-photos/2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', content_type: 'image/jpeg', width: 1600, height: 1200 },
      { id: '3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e', url: '/v1/resale/orders/7b6a5c4d-3e2f-4a1b-9c0d-8e7f6a5b4c3d/dispatch-photos/3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e', content_type: 'image/jpeg', width: 1600, height: 1200 },
    ],
  },
  deadlines: { accept_by: '2026-10-27T09:12:00.000Z', pay_by: null, handover_by: '2026-10-31T10:02:00.000Z', confirm_by: '2026-11-06T08:30:00.000Z' },
  timeline: { requested_at: '2026-10-26T09:12:00.000Z', locked_at: '2026-10-26T09:12:00.000Z', accepted_at: '2026-10-26T10:02:00.000Z', paid_at: '2026-10-26T10:02:00.000Z', sent_at: '2026-10-27T08:30:00.000Z', released_at: null, refunded_at: null, closed_at: null },
  ended_by: null,
  end_reason: null,
  dispute: null,
};
const orderMessageExample = { object: 'resale_order_message', id: '4c5d6e7f-8a9b-4c0d-9e1f-3a4b5c6d7e8f', thread: 'order', from: 'buyer', name: 'Amaka E.', body: 'Can it arrive before Friday?', created_at: '2026-10-26T11:00:00.000Z' };

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
    ResaleOrderDetail: orderDetail,
    ResaleOrderMessage: orderMessage,
    ResaleDisputeMessage: disputeMessage,
    ResaleOrderDispute: dispute,
  },
  responses: {
    'GET /v1/resale/orders': {
      status: 200,
      description: 'Orders on your Resale shops, newest first.',
      schema: shape({ object: constant('list'), data: array(ref('ResaleOrder')), has_more: bool('Whether there are more after these.'), total: int('How many match.') }),
      example: { object: 'list', data: [exampleResaleOrder()], has_more: false, total: 1 },
    },
    'GET /v1/resale/orders/{id}': { status: 200, description: 'The order.', schema: 'ResaleOrderDetail', example: orderDetailExample },
    'POST /v1/resale/orders/{id}/cancel': {
      status: 200,
      description: 'The cancelled order: the buyer’s money unlocked, or refunded in full.',
      schema: 'ResaleOrderDetail',
      example: { ...orderDetailExample, status: 'cancelled', buyer: null, shipment: { ...orderDetailExample.shipment, courier: null, tracking_number: null, tracking_url: null, events: [], dispatch_photos: [] }, courier: null, tracking_number: null, tracking_url: null, accepted_at: null, ended_by: 'reseller', end_reason: 'The customer asked to cancel.', timeline: { ...orderDetailExample.timeline, accepted_at: null, paid_at: null, sent_at: null, closed_at: '2026-10-26T09:40:00.000Z' } },
    },
    'GET /v1/resale/orders/{id}/messages': {
      status: 200,
      description: 'The thread’s messages, oldest first.',
      schema: shape({ object: constant('list'), thread: oneOf('The thread.', ['order', 'trade']), data: array(ref('ResaleOrderMessage')) }),
      example: { object: 'list', thread: 'order', data: [{ ...orderMessageExample, id: '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a', from: 'bitocard', name: 'BitoCard', body: 'Your order is placed. Your payment is locked in your wallet until the supplier confirms it; never pay anyone outside BitoCard.', created_at: '2026-10-26T09:12:00.000Z' }, orderMessageExample] },
    },
    'GET /v1/resale/orders/{id}/dispute': { status: 200, description: 'The dispute and its messages.', schema: 'ResaleOrderDispute', example: disputeExample },
    'POST /v1/resale/orders/{id}/dispute/messages': { status: 201, description: 'Your message on the dispute.', schema: 'ResaleDisputeMessage', example: disputeMessageExample },
    'POST /v1/resale/orders/{id}/messages': { status: 201, description: 'Your message.', schema: 'ResaleOrderMessage', example: { ...orderMessageExample, from: 'me', name: 'Gadget Hub', body: 'Yes: the supplier ships it today.' } },
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
