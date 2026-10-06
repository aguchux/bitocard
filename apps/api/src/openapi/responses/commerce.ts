import { productFeatureKeys } from '../../catalogue/features.js';
import { ProductCategory } from '../../generated/prisma/client.js';
import { eventObjectSchemas } from '../../webhooks/openapi.js';
import { array, bool, constant, int, list, listExample, mode, money, nullable, nullableStr, nullableUuid, num, objectSchema, oneOf, ref, type Schema, shape, str, stringMap, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** Every product category. */
export const categories = Object.values(ProductCategory);
export const category = (description = 'Product category.') => oneOf(description, categories);
export const features = array(oneOf('Something the product can do.', productFeatureKeys), 'What the product can do, for example `sms_in` (receives SMS) or `app_codes` (receives sign-in codes from apps) on a virtual number. Empty for most products.');
const recipientTypes = ['phone', 'smartcard', 'meter', 'none'] as const;
const deliveryKinds = ['gift_card', 'licence_key', 'token', 'confirmation', 'virtual_number'] as const;

const product = objectSchema(
  'Product',
  {
    object: constant('product'),
    id: uuid('Product ID. Quote it with `POST /v1/quotes`.'),
    category: category(),
    country: str('ISO 3166-1 alpha-2 country where the product is used: the card region, or the network or biller country.'),
    brand: str('Brand slug, for example `mtn`, `dstv` or `amazon`.'),
    name: str('Product name.'),
    face_currency: str('ISO 4217 currency of the face values.'),
    denomination: {
      description: 'The face values on offer: a list of fixed values, or a range the customer chooses within. In minor units of `face_currency`.',
      oneOf: [
        shape({ type: constant('fixed'), values: array(int('A face value, in minor units of `face_currency`.')) }, 'Fixed face values.'),
        shape({ type: constant('range'), min: int('Lowest face value, in minor units of `face_currency`.'), max: int('Highest face value, in minor units of `face_currency`.') }, 'Any face value from `min` to `max`.'),
      ],
    },
    recipient_type: oneOf('What the quote needs about the customer: `phone` (airtime and data: `recipient.phone`), `smartcard` (pay-TV) or `meter` (electricity: `recipient.account_number`), or `none` (gift cards, software and the like).', recipientTypes),
    description: nullableStr('About the product.'),
    redeem_instructions: nullableStr('How the customer redeems it, where it applies.'),
    logo_url: nullableStr('The product logo from BitoCard files: the product image, else the brand logo; or null. Show it on a white tile.'),
    features,
    image_url: nullableStr('A picture for the product: its own image, else its brand’s gift card design.'),
    listed: bool('Listed on your BitoCard-hosted store. Your own systems can sell any product in your catalogue, listed or not.'),
    pricing: shape(
      {
        currency: str('ISO 4217 currency of the prices: your wallet currency.'),
        denominations: array(
          shape({
            face_value: int('Face value, in minor units of `face_currency`.'),
            wholesale: money('Your wholesale cost for one item'),
            price: money('Your price to your customer for one item, with your markup, before any tax added at checkout'),
          }),
          'Prices per face value (at most 20; for a range, its lowest and highest). A quote locks the exact price for any valid value.',
        ),
      },
      'Your prices, in your currency.',
    ),
  },
  'A product you can sell, with your wholesale cost and your price. Suppliers, their costs and routing are never shown.',
);

const productExample = {
  object: 'product',
  id: 'c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f',
  category: 'airtime',
  country: 'NG',
  brand: 'mtn',
  name: 'MTN Nigeria airtime',
  face_currency: 'NGN',
  denomination: { type: 'range', min: 5_000, max: 5_000_000 },
  recipient_type: 'phone',
  description: 'Top up any MTN Nigeria prepaid line.',
  redeem_instructions: null,
  logo_url: null,
  features: [],
  image_url: null,
  listed: true,
  pricing: {
    currency: 'NGN',
    denominations: [
      { face_value: 5_000, wholesale: 4_850, price: 5_250 },
      { face_value: 5_000_000, wholesale: 4_850_000, price: 5_250_000 },
    ],
  },
};

const giftCardExample = {
  ...productExample,
  id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d',
  category: 'gift_cards',
  country: 'US',
  brand: 'amazon',
  name: 'Amazon US',
  face_currency: 'USD',
  denomination: { type: 'fixed', values: [1_000, 2_500, 5_000] },
  recipient_type: 'none',
  description: null,
  redeem_instructions: 'Redeem at amazon.com/redeem.',
  image_url: 'https://bitocard.com/brand-cards/amazon.webp',
  listed: false,
  pricing: {
    currency: 'NGN',
    denominations: [
      { face_value: 1_000, wholesale: 1_545_000, price: 1_699_500 },
      { face_value: 2_500, wholesale: 3_862_500, price: 4_248_750 },
      { face_value: 5_000, wholesale: 7_725_000, price: 8_497_500 },
    ],
  },
};

const listingUpdate = objectSchema('Listing update', {
  object: constant('listing_update'),
  listed: bool('Whether the products are now listed (true) or unlisted (false) on your hosted store.'),
  product_ids: array(uuid('A product ID.'), 'The products you sent, without repeats.'),
  updated: int('How many changed: products newly listed, or listings removed. Products already in that state are not counted.'),
});

const pricing = objectSchema(
  'Pricing',
  {
    object: constant('pricing'),
    currency: str('ISO 4217 currency you sell in.'),
    earning: oneOf(
      'How you earn on face-value products (airtime, data, pay-TV and bills in your currency): `markup` (you sell above face value) or `discount` (you sell at face value and earn BitoCard’s discount). Set by your country’s options.',
      ['markup', 'discount'],
    ),
    markup_cap_percent: int('The Markup Protection Scheme cap: your price can be at most this percentage above wholesale price.'),
    markups: array(
      shape({
        category: category('The category the markup applies to.'),
        product_id: nullableUuid('The product, for a product markup (which overrides its category’s); null for the whole category.'),
        product_name: nullableStr('The product’s name, for a product markup.'),
        markup_bps: int('Markup over wholesale price in basis points (1500 = 15%).'),
      }),
      'Your markups. Categories and products without one sell at wholesale price (face value for face-value products).',
    ),
  },
  'How you price: your markups, the cap on them, and how you earn on face-value products.',
);

const pricingExample = {
  object: 'pricing',
  currency: 'NGN',
  earning: 'markup',
  markup_cap_percent: 50,
  markups: [
    { category: 'airtime', product_id: null, product_name: null, markup_bps: 500 },
    { category: 'gift_cards', product_id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d', product_name: 'Amazon US', markup_bps: 1000 },
  ],
};

const orderProduct = shape({ id: uuid('Product ID.'), name: str('Product name.'), category: category() }, 'The product.');
const recipient = stringMap(
  'Who receives it: `phone` for airtime and data; `account_number` (smartcard, IUC or meter) for pay-TV and bills, with the `account_name` the provider returned for the customer to confirm (and, for pay-TV, `current_package` and `transaction_type`). Null when the product needs no recipient.',
  true,
);

const quote = objectSchema(
  'Quote',
  {
    object: constant('quote'),
    id: uuid('Quote ID. Place the order with it (`POST /v1/orders`).'),
    mode,
    status: oneOf('`open` until used for an order (`used`) or past `expires_at` (`expired`).', ['open', 'used', 'expired']),
    product: orderProduct,
    face_value: int('Face value of one item, in minor units of `face_currency`.'),
    face_currency: str('ISO 4217 currency of the face value.'),
    quantity: int('Number of items (more than 1 for gift cards and software only).'),
    currency: str('ISO 4217 currency of the amounts below: your wallet currency.'),
    wholesale: money('Your wholesale cost for the whole quantity: what the order takes from your wallet, plus `tax`'),
    unit_wholesale: money('Your wholesale cost for one item'),
    price: money('What your customer pays for the whole quantity, tax included'),
    tax: nullable(
      shape(
        {
          name: str('The tax, for example `VAT`.'),
          rate_percent: num('Rate, as a percentage.'),
          amount: money('Tax included in `price`, which BitoCard collects and pays as seller of record'),
        },
        'Tax on the sale, where the category is taxed in your country.',
      ),
    ),
    reseller_profit: money('Your profit: `price` less tax and wholesale'),
    source: oneOf('`bitocard`, or `own`: fulfilled through your own supplier account, where BitoCard charges only its fee and adds no tax (you are the seller).', ['bitocard', 'own']),
    integration: nullable(shape({ id: str('Integration ID, for example `reloadly`.'), name: str('Integration name.') }, 'For `own` quotes: your supplier account that will fulfil it.')),
    bitocard_fee: nullable(
      shape(
        {
          rate_percent: str('BitoCard’s fee rate as an exact percentage string, for example `1.5`.'),
          max: money('The most the fee can be; fractions of a minor unit are carried to your next order, never rounded up'),
        },
        'For `own` quotes: BitoCard’s fee, taken from your wallet when the order completes.',
      ),
    ),
    recipient,
    customer_reference: nullableStr('Your own reference for the customer or sale, as you sent it.'),
    expires_at: time('When the locked price expires (10 minutes after it was created).'),
    created_at: time('When the quote was created.'),
  },
  'A locked price for one purchase: face value, quantity, your wholesale cost, your price, tax and the exchange rate, held for 10 minutes.',
);

const quoteExample = {
  object: 'quote',
  id: '0b9d8c7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e',
  mode: 'live',
  status: 'open',
  product: { id: 'e1d2c3b4-a596-4877-8a9b-0c1d2e3f4a5b', name: 'DStv Padi', category: 'pay_tv' },
  face_value: 440_000,
  face_currency: 'NGN',
  quantity: 1,
  currency: 'NGN',
  wholesale: 440_000,
  unit_wholesale: 440_000,
  price: 462_000,
  tax: null,
  reseller_profit: 22_000,
  source: 'bitocard',
  integration: null,
  bitocard_fee: null,
  recipient: { account_number: '7023456789', transaction_type: 'renew', account_name: 'CHINEDU OKAFOR', current_package: 'DStv Padi' },
  customer_reference: 'cust-1042',
  expires_at: '2026-10-06T09:24:58.000Z',
  created_at: '2026-10-06T09:14:58.000Z',
};

const orderSchema = eventObjectSchemas.Order as { title: string; required: string[]; properties: Record<string, Schema> };

const delivery = shape(
  {
    kind: oneOf('What was delivered: `gift_card` (code and often a PIN), `licence_key` (software key), `token` (electricity token in `code`), `confirmation` (airtime, data and pay-TV: nothing to hand over) or `virtual_number` (the number in `serial`).', deliveryKinds),
    code: nullableStr('The gift card code, licence key or electricity token. A secret: show it only to your customer.'),
    pin: nullableStr('The gift card PIN, where it has one. A secret.'),
    serial: nullableStr('A serial number, or the phone number for `virtual_number`.'),
    details: stringMap('More about the delivery, for example `units` for an electricity token, `redemption_url` and `expires_at` for some gift cards, or `number` and `number_type` for a virtual number.'),
  },
  'One delivered item.',
);

const orderDetail: Schema = {
  ...orderSchema,
  title: 'Order with deliveries',
  description: 'An order as returned for one order (`POST /v1/orders`, `GET /v1/orders/{id}`): the order plus what was delivered. Codes, PINs and tokens appear only here, never in lists or webhooks.',
  required: [...orderSchema.required, 'deliveries'],
  additionalProperties: false,
  properties: {
    ...orderSchema.properties,
    deliveries: array(delivery, 'What was delivered: one item per gift card or licence (the quantity), or one confirmation. Empty while `processing` and for failed orders.'),
  },
};

const orderBase = {
  object: 'order',
  id: '5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f',
  mode: 'live',
  status: 'completed',
  quote_id: '0b9d8c7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e',
  product: { id: 'c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f', name: 'MTN Nigeria airtime', category: 'airtime' },
  face_value: 100_000,
  face_currency: 'NGN',
  quantity: 1,
  currency: 'NGN',
  wholesale: 97_000,
  tax: 0,
  charged: 97_000,
  price: 100_000,
  reseller_profit: 3_000,
  recipient: { phone: '+2348031234567' },
  customer_reference: 'cust-1042',
  source: 'bitocard',
  integration: null,
  failure_reason: null,
  receipt_number: 'BC-000123',
  created_at: '2026-10-06T09:15:02.114Z',
  updated_at: '2026-10-06T09:15:04.870Z',
  completed_at: '2026-10-06T09:15:04.870Z',
};

const giftCardOrderExample = {
  ...orderBase,
  id: '6a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d',
  mode: 'test',
  quote_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  product: { id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d', name: 'Amazon US', category: 'gift_cards' },
  face_value: 2_500,
  face_currency: 'USD',
  quantity: 2,
  wholesale: 7_725_000,
  charged: 7_725_000,
  price: 8_497_500,
  reseller_profit: 772_500,
  recipient: null,
  deliveries: [
    { kind: 'gift_card', code: 'SANDBOX-3F9A1C7E52B4', pin: '4821', serial: null, details: {} },
    { kind: 'gift_card', code: 'SANDBOX-8D02E6B1A9C3', pin: '1937', serial: null, details: {} },
  ],
};

const receipt = objectSchema(
  'Receipt',
  {
    object: constant('receipt'),
    number: str('Receipt number, the same as the order’s `receipt_number`.'),
    order_id: uuid('The order.'),
    mode,
    issued_at: time('When the order completed.'),
    seller: {
      type: 'object',
      description: 'The seller of record: the Golojan entity for your region, with its registration number under its local label.',
      required: ['name', 'registered_address'],
      minProperties: 3,
      maxProperties: 3,
      additionalProperties: false,
      properties: {
        name: str('Legal name, for example `De-Golojan Technologies Ltd` (Africa), `Golojan Ltd` (UK and Europe) or `Golojan Technologies LLC` (elsewhere).'),
        rc_number: str('Nigerian RC number (Africa).'),
        company_number: str('Companies House number (UK and Europe).'),
        delaware_file_number: str('Delaware file number (elsewhere).'),
        registered_address: str('Registered address.'),
      },
    },
    sold_through: str('Your store name (or business name), shown as the brand the customer bought through.'),
    currency: str('ISO 4217 currency of the amounts.'),
    items: array(
      shape({
        description: str('What was sold.'),
        quantity: int('Number of items.'),
        unit_price: money('Price of one item, tax included'),
        amount: money('Line total, tax included'),
      }),
      'What was sold.',
    ),
    subtotal: money('Total before tax'),
    tax: nullable(shape({ name: str('The tax, for example `VAT`.'), rate_percent: num('Rate, as a percentage.'), amount: money('Tax') }, 'Tax charged, if any.')),
    total: money('Total paid by the customer'),
    customer_reference: nullableStr('Your own reference for the customer, as given on the quote.'),
  },
  'The customer receipt for a completed order. BitoCard (the Golojan entity for your region) is the seller of record; the receipt carries your store name.',
);

const receiptExample = {
  object: 'receipt',
  number: 'BC-000123',
  order_id: '5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f',
  mode: 'live',
  issued_at: '2026-10-06T09:15:04.870Z',
  seller: { name: 'De-Golojan Technologies Ltd', rc_number: 'RC 1606658', registered_address: '3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu' },
  sold_through: 'Ada Digital',
  currency: 'NGN',
  items: [{ description: 'MTN Nigeria airtime', quantity: 1, unit_price: 100_000, amount: 100_000 }],
  subtotal: 100_000,
  tax: null,
  total: 100_000,
  customer_reference: 'cust-1042',
};

export const commerceDocs: DocsArea = {
  schemas: { Product: product, ListingUpdate: listingUpdate, Pricing: pricing, Quote: quote, OrderDetail: orderDetail, Receipt: receipt },
  responses: {
    'GET /v1/catalogue/products': {
      status: 200,
      description: 'A page of products you can sell, ordered by product key. Products with no price available right now are left out of the page.',
      schema: list(ref('Product'), { next_cursor: nullableUuid('Pass as `starting_after` to get the next page; null on the last page.') }),
      example: { ...listExample([productExample, giftCardExample], true), next_cursor: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d' },
    },
    'GET /v1/catalogue/products/{id}': { status: 200, description: 'The product, with your prices.', schema: 'Product', example: productExample },
    'POST /v1/catalogue/listing': {
      status: 200,
      description: 'The products were listed or unlisted.',
      schema: 'ListingUpdate',
      example: { object: 'listing_update', listed: true, product_ids: ['c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f', 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d'], updated: 2 },
    },
    'GET /v1/pricing': { status: 200, description: 'Your pricing.', schema: 'Pricing', example: pricingExample },
    'PUT /v1/pricing/markups': { status: 200, description: 'The markup was set. Returns your pricing.', schema: 'Pricing', example: pricingExample },
    'DELETE /v1/pricing/markups': { status: 200, description: 'The markup was removed (or there was none). Returns your pricing.', schema: 'Pricing', example: { ...pricingExample, markups: [pricingExample.markups[0]] } },
    'POST /v1/quotes': { status: 201, description: 'The quote, with its price locked for 10 minutes.', schema: 'Quote', example: quoteExample },
    'GET /v1/quotes/{id}': { status: 200, description: 'The quote.', schema: 'Quote', example: { ...quoteExample, status: 'used' } },
    'POST /v1/orders': {
      status: 201,
      description: 'The order. `completed` with its deliveries, `failed` (the hold was released), or `processing` (the supplier has not confirmed yet: get it again or wait for the webhook).',
      schema: 'OrderDetail',
      example: giftCardOrderExample,
    },
    'GET /v1/orders': {
      status: 200,
      description: 'A page of orders, newest first. Delivered codes, PINs and tokens are never included: get the order for them.',
      schema: list(ref('Order')),
      example: listExample([
        orderBase,
        {
          ...orderBase,
          id: '7b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
          status: 'failed',
          quote_id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
          failure_reason: 'The order could not be fulfilled. The amount held has been returned to your wallet.',
          receipt_number: null,
          created_at: '2026-10-06T08:40:11.502Z',
          updated_at: '2026-10-06T08:40:13.019Z',
          completed_at: '2026-10-06T08:40:13.019Z',
        },
      ], true),
    },
    'GET /v1/orders/{id}': { status: 200, description: 'The order, with what was delivered.', schema: 'OrderDetail', example: giftCardOrderExample },
    'GET /v1/orders/{id}/receipt': { status: 200, description: 'The receipt.', schema: 'Receipt', example: receiptExample },
    'POST /v1/orders/{id}/simulate': {
      status: 200,
      description: 'The order after the simulated outcome. An order that is no longer processing is returned unchanged.',
      schema: 'OrderDetail',
      example: { ...orderBase, mode: 'test', deliveries: [{ kind: 'confirmation', code: null, pin: null, serial: null, details: {} }] },
    },
  },
};
