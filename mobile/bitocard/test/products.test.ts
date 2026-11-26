// Buying bills, pay-TV and software in the app: who it goes to, the value, what the provider's check said, and the
// shape the API takes; reported problems and bank deposits in the customer's words.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { depositsPath, depositStatusWords } from '../src/lib/deposits.ts';
import { canDispute, disputeOpen, disputeStatus } from '../src/lib/disputes.ts';
import { cataloguePath, emailsCodes, faceValueOf, recipientField, recipientLines, recipientOf, storeProductPageSize, takesQuantity } from '../src/lib/products.ts';

test('catalogue requests stay within the production page limit', () => {
  assert.equal(storeProductPageSize, 60);
  assert.equal(cataloguePath('gift_cards', 'NG', 'NGN'), '/v1/store/products?category=gift_cards&market=NG&currency=NGN&limit=60&sort=popular');
  assert.equal(cataloguePath('pay_tv', 'GH'), '/v1/store/products?category=pay_tv&market=GH&limit=60&sort=popular');
});

test('who a product goes to', () => {
  assert.equal(recipientField('meter')?.label, 'Meter number');
  assert.equal(recipientField('smartcard')?.label, 'Smartcard or IUC number');
  assert.equal(recipientField('account')?.kind, 'account');
  assert.equal(recipientField('phone')?.kind, 'phone');
  assert.equal(recipientField(null), null);
  assert.ok(takesQuantity('software') && !takesQuantity('bills'));
  assert.ok(emailsCodes('gift_cards') && !emailsCodes('pay_tv'));
});

test('the value: a fixed one chosen, or a typed amount in range', () => {
  assert.deepEqual(faceValueOf({ denominations: [500000, 1000000], range: null, face_currency: 'NGN' }, 500000, ''), { value: 500000 });
  assert.ok('problem' in faceValueOf({ denominations: [500000], range: null, face_currency: 'NGN' }, null, ''));
  const range = { denominations: null, range: { min: 50000, max: 50000000 }, face_currency: 'NGN' };
  assert.deepEqual(faceValueOf(range, null, '5,000'), { value: 500000 });
  assert.ok('problem' in faceValueOf(range, null, '100'), 'below the range');
  assert.ok('problem' in faceValueOf(range, null, 'abc'));
});

test('the provider’s check, to confirm before paying', () => {
  assert.deepEqual(recipientLines({ account_number: '45012345678', account_name: 'ADA OBI', address: '12 Allen Ave', min_amount: '500' }), [
    ['Name on the account', 'ADA OBI'],
    ['Address', '12 Allen Ave'],
  ]);
  assert.deepEqual(recipientLines(null), []);
});

test('the recipient as the API takes it', () => {
  assert.deepEqual(recipientOf({ account: '7027914329', phone: '08031234567', transaction: 'renew' }), { account_number: '7027914329', phone: '08031234567', transaction_type: 'renew' });
  assert.deepEqual(recipientOf({ email: 'a@b.co' }), { email: 'a@b.co' });
  assert.deepEqual(recipientOf({ transaction: 'nonsense' }), undefined);
});

test('reported problems', () => {
  assert.equal(disputeStatus({ status: 'open', outcome: null }).label, 'Being looked at');
  assert.equal(disputeStatus({ status: 'escalated', outcome: null }).label, 'With BitoCard');
  assert.equal(disputeStatus({ status: 'resolved', outcome: 'refunded_customer' }).label, 'Refunded');
  assert.equal(disputeStatus({ status: 'resolved', outcome: 'rejected' }).label, 'Closed');
  assert.ok(disputeOpen({ status: 'escalated' }) && !disputeOpen({ status: 'resolved' }));
  assert.ok(canDispute('completed') && !canDispute('awaiting_payment'));
});

test('bank deposits', () => {
  assert.equal(depositStatusWords.credited, 'Added to your wallet');
  assert.equal(depositsPath('all'), '/v1/store/wallet/bank-deposits?limit=20');
  assert.equal(depositsPath('open', 'd-1'), '/v1/store/wallet/bank-deposits?limit=20&show=open&starting_after=d-1');
});
