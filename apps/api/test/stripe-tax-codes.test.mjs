// Stripe product tax codes: Managed Payments refuses a payment without one, and takes only digital products. Software
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

  test('Managed Payments refusing a payment without a code is a clear refusal that says what to change', async () => {
    stripe.state.managedPayments = true;
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
      assert.match(refused.message, /Turn Managed Payments off in the Stripe dashboard/);
      assert.equal(refused.message.match(/stripe: /g).length, 1, 'named once');
      assert.doesNotMatch(refused.message, /which is enabled by Stripe/, 'Stripe’s message ends at a full sentence before the advice');
      assert.match(refused.message, /product-tax-code-requirements\)\. Stripe Managed Payments is on/);
    } finally {
      stripe.state.managedPayments = false;
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
