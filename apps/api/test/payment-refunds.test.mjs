// Refunds through the payment gateways: a retry after a timeout must find the refund already made, never make a second.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FlutterwaveProvider } from '../dist/payments/flutterwave.provider.js';
import { MonnifyProvider } from '../dist/payments/monnify.provider.js';
import { StripeProvider, stripeFee } from '../dist/payments/stripe.provider.js';
import { fakeFlutterwave, fakeMonnify, fakeStripe } from './fakes.mjs';

let stripe;
let monnify;

before(async () => {
  stripe = await fakeStripe();
  monnify = await fakeMonnify();
});

after(async () => {
  await stripe.close();
  await monnify.close();
});

describe('gateway refunds are idempotent', () => {
  test('Stripe: the same refund reference returns the refund already made', async () => {
    const provider = new StripeProvider('sk_test_fake', stripe.url);
    const opened = await provider.createCheckout({
      reference: 'bc_pay_1',
      amount: 50000n,
      currency: 'USD',
      country: 'US',
      name: 'Ada',
      email: 'ada@example.com',
      description: 'Gift card',
      returnUrl: 'https://bitocard.com/checkout/return',
    });
    const payment = { reference: 'bc_pay_1', providerTransactionId: opened.providerTransactionId, amount: 50000n, currency: 'USD', refundReference: 'bc_rf_one' };
    const first = await provider.refund(payment);
    const again = await provider.refund(payment);
    assert.equal(again.providerRefundId, first.providerRefundId);
    assert.equal(Object.keys(stripe.state.refunds).length, 1, 'one refund at Stripe');
    assert.equal(stripe.state.refunds[first.providerRefundId].idempotencyKey, 'bc_rf_one');
  });

  test('Monnify: a reference it has seen is looked up instead of failing the refund', async () => {
    const provider = new MonnifyProvider('MK_TEST_fake', 'monnify-secret', '1234567890', monnify.url);
    const payment = { reference: 'bc_pay_2', providerTransactionId: 'MNFY|1|1', amount: 50000n, currency: 'NGN', refundReference: 'bc_rf_two' };
    const first = await provider.refund(payment);
    const again = await provider.refund(payment);
    assert.deepEqual([first.status, again.status, again.providerRefundId], ['refunded', 'refunded', 'bc_rf_two']);
    assert.equal(Object.keys(monnify.state.refunds).length, 1);
  });
});

describe('Flutterwave refunds', () => {
  test('a refund already made for the transaction is returned instead of refunding again; a failed one does not count', async () => {
    const flw = await fakeFlutterwave();
    try {
      const provider = new FlutterwaveProvider('FLWSECK_TEST-fake', flw.url);
      const payment = { reference: 'bc_pay_3', providerTransactionId: '777', amount: 50000n, currency: 'NGN', refundReference: 'bc_rf_three' };
      flw.state.refundStatus = 'failed';
      const failed = await provider.refund(payment);
      assert.equal(failed.status, 'failed');
      flw.state.refundStatus = 'pending';
      const first = await provider.refund(payment);
      const again = await provider.refund(payment);
      assert.deepEqual([first.status, again.providerRefundId], ['pending', first.providerRefundId]);
      assert.equal(Object.keys(flw.state.refunds).length, 2, 'the failed refund and one more, never a third');

      flw.state.fail = { '/refunds': 500 };
      await assert.rejects(provider.refund({ ...payment, providerTransactionId: '888' }), error => error.definite === false, 'no lookup, no refund');
      assert.equal(Object.keys(flw.state.refunds).length, 2);
    } finally {
      await flw.close();
    }
  });
});

describe('Stripe fees', () => {
  test('a fee in another settlement currency is converted to the charge currency', () => {
    assert.equal(stripeFee({ fee: 150, currency: 'usd' }, 'USD'), 150n);
    // ₦1 = $0.000625 (exchange_rate converts charge to settlement): a 150-cent fee is ₦2,400 = 240,000 kobo.
    assert.equal(stripeFee({ fee: 150, currency: 'usd', exchange_rate: 0.000625 }, 'NGN'), 240000n);
    assert.equal(stripeFee({ fee: 150, currency: 'usd' }, 'NGN'), 0n, 'no rate: not booked rather than booked wrong');
    assert.equal(stripeFee({ fee: 0, currency: 'usd' }, 'USD'), 0n);
  });
});
