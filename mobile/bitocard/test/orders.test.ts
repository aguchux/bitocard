// What an order says to its customer: its status in words and its timeline, for every status the API has.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inProgress, recipientOf, statusOf, stepsOf } from '../src/lib/orders.ts';

const wallet = { id: 'wallet', label: 'Wallet' };

test('every status has words, and only moving ones are polled', () => {
  assert.deepEqual(statusOf('completed'), { label: 'Delivered', tone: 'good' });
  assert.equal(statusOf('refunded').label, 'Refunded');
  assert.equal(inProgress('paid'), true);
  assert.equal(inProgress('completed'), false);
  assert.equal(inProgress('refund_pending'), true);
});

test('the timeline follows the order, and a refund says where it stopped', () => {
  assert.deepEqual(stepsOf({ status: 'paid', method: wallet }).map(step => step.state), ['done', 'now', 'todo']);
  assert.equal(stepsOf({ status: 'paid', method: wallet })[0]!.label, 'Paid from your wallet');
  assert.equal(stepsOf({ status: 'completed', method: { id: 'stripe', label: 'Card' } })[0]!.label, 'Paid by Card');
  assert.deepEqual(stepsOf({ status: 'refunded', method: wallet }).map(step => step.label), ['Paid from your wallet', 'Could not be delivered', 'Refunded in full']);
});

test('the recipient is the number, else the account or email', () => {
  assert.equal(recipientOf({ recipient: { phone: '+2348068573376' } }), '+2348068573376');
  assert.equal(recipientOf({ recipient: { email: 'a@b.co' } }), 'a@b.co');
  assert.equal(recipientOf({ recipient: null }), null);
});
