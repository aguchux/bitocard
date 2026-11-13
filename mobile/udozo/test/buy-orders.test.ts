// Buy orders: what happens next, the question before each step, and the step's route and body.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buyOrderBody, buyOrderNext, buyOrderPath, buyQuestion } from '../src/lib/buy-orders.ts';

const order = { status: 'requested' as const, role: 'seller' as const, respond_by: null, meet_by: null, bought_at: null, completes_at: null, void_until: null, with: { name: 'Ada O.' } };

test('each side is told what happens next', () => {
  assert.equal(buyOrderNext(order), 'Accept, offer another price or decline.');
  assert.equal(buyOrderNext({ ...order, role: 'buyer' }), 'Waiting for Ada O. to answer.');
  assert.equal(buyOrderNext({ ...order, status: 'accepted' }), 'Meet: inspect it, then pay in person. Mark it sold once they have bought it.');
  assert.equal(buyOrderNext({ ...order, status: 'accepted', bought_at: '2026-11-13T10:00:00Z' }), 'Ada O. says they bought it: mark it sold to confirm.');
  assert.equal(buyOrderNext({ ...order, status: 'declined' }), 'Ended.');
});

test('each step is asked first, with a price or a reason where one is needed', () => {
  const view = { price: 25_000_000, counter: 27_000_000, currency: 'NGN', with: { name: 'Ada O.' }, listing: { title: 'Sofa' } } as Parameters<typeof buyQuestion>[1];
  assert.equal(buyQuestion('accept', view).title, 'Accept ₦250,000?');
  assert.equal(buyQuestion('accept_counter', view).action, 'Accept ₦270,000');
  assert.equal(buyQuestion('counter', view).price, true);
  assert.deepEqual(buyQuestion('void', view).reason, { label: 'What happened', required: true });
  assert.equal(buyQuestion('decline', view).tone, 'danger');
});

test('the step goes to its hyphenated route with only what it needs', () => {
  assert.equal(buyOrderPath('b1', 'accept_counter'), '/v1/classifieds/buy-orders/b1/accept-counter');
  assert.equal(buyOrderPath('b1', 'no_show'), '/v1/classifieds/buy-orders/b1/no-show');
  assert.deepEqual(buyOrderBody('counter', { price: 2_000_000, reason: '  ' }), { price: 2_000_000 });
  assert.deepEqual(buyOrderBody('decline', { price: 2_000_000, reason: ' Sold already ' }), { reason: 'Sold already' });
  assert.deepEqual(buyOrderBody('accept', {}), {});
});
