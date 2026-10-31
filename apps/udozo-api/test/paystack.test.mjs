// Paystack as a payment gateway: its payment page, reading a payment back, signed notifications and refunds that a
// retry after a timeout never sends twice.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ProviderError } from '../dist/payments/provider-error.js';
import { fromPaystackReference, PaystackProvider, toPaystackReference } from '../dist/payments/paystack.provider.js';
import { fakePaystack } from './fakes.mjs';

let paystack;
let provider;

before(async () => {
  paystack = await fakePaystack();
  provider = new PaystackProvider('sk_test_fake', paystack.url);
});

after(async () => {
  await paystack.close();
});

const input = reference => ({
  reference,
  amount: 1_250_050n,
  currency: 'NGN',
  country: 'NG',
  name: 'Ada Obi',
  email: 'ada@example.com',
  description: 'Wallet top-up',
  returnUrl: 'https://shq.bitocard.com/wallet',
});

const ref = (reference, amount = 1_250_050n) => ({ reference, providerTransactionId: null, amount, currency: 'NGN' });

describe('Paystack payment pages', () => {
  test('our references reach Paystack with dots for underscores, and come back as ours', () => {
    assert.equal(toPaystackReference('bc_top_0a1b2c'), 'bc.top.0a1b2c');
    assert.equal(fromPaystackReference('bc.top.0a1b2c'), 'bc_top_0a1b2c');
  });

  test('opens the page in the subunit (kobo) with our reference and return address', async () => {
    const opened = await provider.createCheckout(input('bc_top_page1'));
    assert.match(opened.checkoutUrl, /^https:\/\/checkout\.paystack\.com\//);
    const sent = paystack.state.transactions['bc.top.page1'].body;
    assert.deepEqual([sent.amount, sent.currency, sent.email, sent.callback_url], ['1250050', 'NGN', 'ada@example.com', 'https://shq.bitocard.com/wallet']);
  });

  test('a page opened but not paid waits; paid, it succeeds with Paystack’s fee; reversed fails', async () => {
    await provider.createCheckout(input('bc_top_page2'));
    const waiting = await provider.verify(ref('bc_top_page2'));
    assert.deepEqual([waiting.status, waiting.reference], ['pending', 'bc_top_page2'], 'abandoned is still payable');

    Object.assign(paystack.state.transactions['bc.top.page2'], { status: 'success', fees: 18_751 });
    const paid = await provider.verify(ref('bc_top_page2'));
    assert.deepEqual([paid.status, paid.reference, paid.amount, paid.currency, paid.fee], ['succeeded', 'bc_top_page2', 1_250_050n, 'NGN', 18_751n]);
    assert.equal(paid.providerTransactionId, String(paystack.state.transactions['bc.top.page2'].id));

    Object.assign(paystack.state.transactions['bc.top.page2'], { status: 'reversed', gateway_response: 'Reversed by bank' });
    const reversed = await provider.verify(ref('bc_top_page2'));
    assert.deepEqual([reversed.status, reversed.failureReason], ['failed', 'Reversed by bank']);
  });

  test('no transaction yet is null; a refused key is an error, never "not paid"', async () => {
    assert.equal(await provider.verify(ref('bc_top_never')), null);
    await assert.rejects(new PaystackProvider('not-a-key', paystack.url).verify(ref('bc_top_never')), error => error instanceof ProviderError && error.status === 401);
  });

  test('takes each market’s own currency only', () => {
    assert.equal(provider.supportsCheckout('NG', 'NGN'), true);
    assert.equal(provider.supportsCheckout('GH', 'GHS'), true);
    assert.equal(provider.supportsCheckout('NG', 'USD'), false);
    assert.equal(provider.supportsCheckout('UG', 'UGX'), false);
  });

  test('notifications are trusted only with the HMAC-SHA512 of the raw body under the secret key', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'bc.top.x' } }));
    const signature = createHmac('sha512', 'sk_test_fake').update(raw).digest('hex');
    assert.equal(provider.webhookTrusted(raw, signature), true);
    assert.equal(provider.webhookTrusted(raw, createHmac('sha512', 'another').update(raw).digest('hex')), false);
    assert.equal(provider.webhookTrusted(raw, undefined), false);
    assert.equal(provider.webhookTrusted(undefined, signature), false);
  });
});

describe('Paystack refunds', () => {
  test('a refund already made for the transaction is returned instead of refunding again; a failed one does not count', async () => {
    await provider.createCheckout(input('bc_top_refund'));
    const tx = Object.assign(paystack.state.transactions['bc.top.refund'], { status: 'success' });
    const payment = { ...ref('bc_top_refund'), providerTransactionId: String(tx.id), refundReference: 'bc_rf_pay_refund' };

    paystack.state.refundStatus = 'failed';
    const failed = await provider.refund(payment);
    assert.deepEqual([failed.status, failed.failureReason], ['failed', 'Refund failed']);

    paystack.state.refundStatus = 'pending';
    const first = await provider.refund(payment);
    assert.equal(first.status, 'pending');
    const again = await provider.refund(payment);
    assert.equal(again.providerRefundId, first.providerRefundId, 'the pending refund is found, not sent again');
    assert.equal(Object.values(paystack.state.refunds).filter(refund => refund.transaction === tx.id).length, 2, 'the failed one and one more');
    assert.equal(paystack.state.refunds[first.providerRefundId].amount, 1_250_050, 'in full, in kobo');

    paystack.state.refunds[first.providerRefundId].status = 'needs-attention';
    assert.equal((await provider.refundStatus({ providerRefundId: first.providerRefundId })).status, 'pending');
    paystack.state.refunds[first.providerRefundId].status = 'processed';
    assert.equal((await provider.refundStatus({ providerRefundId: first.providerRefundId })).status, 'refunded');
  });

  test('a payment without Paystack’s transaction cannot be refunded', async () => {
    await assert.rejects(provider.refund({ ...ref('bc_top_none'), refundReference: 'bc_rf_none' }), error => error instanceof ProviderError && error.definite);
  });
});
