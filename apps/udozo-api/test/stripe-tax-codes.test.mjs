// Stripe product tax codes and Managed Payments: every session opts out of it (BitoCard is the seller); where Stripe
// applies it anyway it refuses a payment without an eligible code. Software
// checkouts send downloadable software's code; everything else sends the admin's default code, or none.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fakeStripe } from './fakes.mjs';

let stripe;
let StripeProvider;
let ProviderError;

before(async () => {
  stripe = await fakeStripe();
  ({ StripeProvider } = await import('../dist/payments/stripe.provider.js'));
  ({ ProviderError } = await import('../dist/payments/provider-error.js'));
});

after(() => stripe?.close());

const base = { amount: 5000n, currency: 'USD', country: 'US', email: 'ada@example.com', name: 'Ada', returnUrl: 'https://bitocard.com/checkout/return' };
let n = 0;
const open = (provider, category) => provider.createCheckout({ ...base, reference: `bc_tax_${(n += 1)}`, description: 'Thing', category });
const taxCode = id => stripe.state.sessions[id].fields['line_items[0][price_data][product_data][tax_code]'];

describe('Stripe product tax codes', () => {
  test('software sends downloadable software; other payments send none without a default', async () => {
    const provider = new StripeProvider('sk_live_x', stripe.url);
    assert.equal(taxCode((await open(provider, 'software')).providerTransactionId), 'txcd_10202000');
    assert.equal(taxCode((await open(provider, 'gift_cards')).providerTransactionId), undefined);
    assert.equal(taxCode((await open(provider, null)).providerTransactionId), undefined, 'a wallet top-up');
  });

  test('the default code covers everything but software', async () => {
    const provider = new StripeProvider('sk_live_x', stripe.url, undefined, 'txcd_10000000');
    assert.equal(taxCode((await open(provider, 'airtime')).providerTransactionId), 'txcd_10000000');
    assert.equal(taxCode((await open(provider, null)).providerTransactionId), 'txcd_10000000');
    assert.equal(taxCode((await open(provider, 'software')).providerTransactionId), 'txcd_10202000');
  });

  test('every session opts out of Managed Payments, so an account with it on by default still takes gift cards and top-ups', async () => {
    stripe.state.managedPayments = true;
    try {
      const provider = new StripeProvider('sk_live_x', stripe.url);
      const opened = await open(provider, 'gift_cards');
      assert.ok(opened.checkoutUrl, 'a gift card opens');
      assert.equal(stripe.state.sessions[opened.providerTransactionId].fields['managed_payments[enabled]'], 'false');
      assert.ok((await open(provider, null)).checkoutUrl, 'a wallet top-up opens');
    } finally {
      stripe.state.managedPayments = false;
    }
  });

  test('Stripe applying Managed Payments anyway is a clear refusal that says what to change', async () => {
    Object.assign(stripe.state, { managedPayments: true, ignoresOptOut: true });
    try {
      const provider = new StripeProvider('sk_live_x', stripe.url);
      assert.ok((await open(provider, 'software')).checkoutUrl, 'software still opens');
      const refused = await open(provider, 'gift_cards').then(
        () => null,
        error => error,
      );
      assert.ok(refused instanceof ProviderError);
      assert.equal(refused.definite, true);
      assert.match(refused.message, /^stripe: Invalid line_items\[0\]: the product tax code is missing/);
      assert.match(refused.message, /Settings > Managed Payments\) or ask Stripe Support/);
      assert.equal(refused.message.match(/stripe: /g).length, 1, 'named once');
      assert.doesNotMatch(refused.message, /which is enabled by Stripe/, 'Stripe’s message ends at a full sentence before the advice');
      assert.match(refused.message, /product-tax-code-requirements\)\. Stripe applied Managed Payments/);
    } finally {
      Object.assign(stripe.state, { managedPayments: false, ignoresOptOut: false });
    }
  });

  test('an account that does not know the opt-out is asked again without it, once, and remembered', async () => {
    const { forgetStripeCurrencies } = await import('../dist/payments/stripe.provider.js');
    stripe.state.unknownManagedPayments = true;
    try {
      const provider = new StripeProvider('sk_live_old', stripe.url);
      const before = stripe.calls.length;
      const first = await open(provider, 'gift_cards');
      assert.equal(stripe.state.sessions[first.providerTransactionId].fields['managed_payments[enabled]'], undefined);
      assert.equal(stripe.calls.length - before, 2, 'refused once, then opened without it');
      const second = await open(provider, 'gift_cards');
      assert.ok(second.checkoutUrl);
      assert.equal(stripe.calls.length - before, 3, 'later sessions leave it out straight away');
    } finally {
      stripe.state.unknownManagedPayments = false;
      forgetStripeCurrencies();
    }
  });

  test('long provider messages end at a full sentence, else a whole word, never mid-sentence', async () => {
    const { clip } = await import('../dist/payments/provider-error.js');
    assert.equal(clip('Short.', 300), 'Short.');
    const long = `${'First sentence is here. '.repeat(10)}And the last one is cut`;
    assert.equal(clip(long, 250), 'First sentence is here. '.repeat(10).trimEnd());
    assert.equal(clip('word '.repeat(80), 30), `${'word '.repeat(6).trimEnd()}…`);
  });

  test('the integration setting is validated as a Stripe tax code', async () => {
    const { configSchema } = await import('../dist/config/config.js');
    const parse = value => configSchema.safeParse({ ...process.env, DATABASE_URL: 'postgres://x', STRIPE_TAX_CODE: value }).success;
    assert.equal(parse('txcd_10000000'), true);
    assert.equal(parse('10000000'), false);
    assert.equal(parse('txcd_1'), false);
  });
});
