// Money in the app: what each side of an order can do, what a checkout charges and sends, the Buy button, a shop's
// payment link, and when a money step keeps its Idempotency-Key.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buyAction, checkoutBody, checkoutCharges, checkoutProblem, clock, keepKey, orderActions, orderNext, posPayOutcome, scannedPayToken, secondsLeft, walletShort } from '../src/lib/money.ts';

const token = `pw_${'a'.repeat(32)}`;

test('a refused money step gets a new key; no answer or a failing API keeps it, so a retry never pays twice', () => {
  assert.equal(keepKey({ status: 0 }), true);
  assert.equal(keepKey({ status: 502 }), true);
  assert.equal(keepKey(new Error('no status')), true);
  assert.equal(keepKey({ status: 402 }), false);
  assert.equal(keepKey({ status: 409 }), false);
});

test('the wallet shortfall', () => {
  assert.equal(walletShort(10_000, 25_000), 15_000);
  assert.equal(walletShort(30_000, 25_000), 0);
  assert.equal(walletShort(null, 25_000), 0);
});

test('each side of an order can do what udozo.com offers', () => {
  const order = (role: 'buyer' | 'seller', status: string, fulfilment = 'meet_up', extra = {}) => ({ role, status, fulfilment, ...extra }) as Parameters<typeof orderActions>[0];
  assert.deepEqual(orderActions(order('buyer', 'requested')), ['cancel']);
  assert.deepEqual(orderActions(order('seller', 'requested')), ['accept', 'decline']);
  assert.deepEqual(orderActions(order('buyer', 'awaiting_payment')), ['pay', 'cancel']);
  assert.deepEqual(orderActions(order('buyer', 'paid')), ['release_code', 'cancel', 'dispute']);
  assert.deepEqual(orderActions(order('seller', 'paid')), ['enter_code', 'cancel']);
  assert.deepEqual(orderActions(order('seller', 'paid', 'delivery')), ['sent', 'cancel']);
  assert.deepEqual(orderActions(order('buyer', 'sent', 'delivery')), ['received', 'dispute']);
  assert.deepEqual(orderActions(order('seller', 'sent', 'delivery')), ['delivered']);
  assert.deepEqual(orderActions(order('seller', 'sent', 'delivery', { shipment: { delivered_at: '2026-11-13T10:00:00Z' } })), []);
  // At a Connect Centre the buyer gives their code at the counter, paying any storage first.
  assert.deepEqual(orderActions(order('buyer', 'at_centre', 'connect', { connect: { storage_owed: 2100 } })), ['pay_storage', 'release_code', 'dispute']);
  assert.deepEqual(orderActions(order('buyer', 'at_centre', 'connect', { connect: { storage_owed: 0 } })), ['release_code', 'dispute']);
  assert.deepEqual(orderActions(order('seller', 'at_centre', 'connect')), []);
  assert.deepEqual(orderActions(order('buyer', 'released')), []);
});

test('the line under an order says what to do next', () => {
  const base = { deadlines: { accept_by: '2026-11-14T10:00:00Z', pay_by: null, handover_by: null, confirm_by: null }, with: { name: 'Ada O.' } };
  assert.match(orderNext({ ...base, role: 'buyer', status: 'requested', fulfilment: 'meet_up' }), /^Waiting for Ada O\. to accept, by /);
  assert.equal(orderNext({ ...base, role: 'seller', status: 'paid', fulfilment: 'meet_up' }), 'Meet Ada O. and enter their release code.');
  const centre = { centre: { id: 'c', number: 'CC-1', name: 'Ikeja Centre', address: '', landmark: null, area: '', state: '', hours: '', phone: '' }, received_at: null, ready_at: '2026-11-13T09:00:00Z', collect_by: null };
  assert.match(orderNext({ ...base, role: 'buyer', status: 'at_centre', fulfilment: 'connect', connect: centre }), /^Ready at Ikeja Centre\. Inspect it at the counter/);
});

const quote = {
  listing_id: 'l1',
  offer_id: null,
  total: 46_000,
  fulfilment: ['meet_up', 'delivery', 'connect'] as ('meet_up' | 'delivery' | 'connect')[],
  delivery: { state_id: 's-lagos', within_state: 2_000, nationwide: 5_000 },
  connect: {
    fee: { kind: 'percent' as const, bps: 500 },
    free_hours: 72,
    states: [{ id: 's-lagos', name: 'Lagos', slug: 'lagos', shipping: 3_000, connect_fee: 150, centres: [{ id: 'cc1', number: 'CC-1', name: 'Ikeja', area: { id: 'a', name: 'Ikeja', latitude: 0, longitude: 0 }, address: '1 Allen Avenue', landmark: null, hours: '9 to 6', phone: '' }] }],
  },
};

test('a checkout adds the way it is handed over to the total, and sends only what that way needs', () => {
  assert.deepEqual(checkoutCharges(quote, { fulfilment: 'meet_up' }), { delivery: 0, connectFee: 0, total: 46_000 });
  assert.deepEqual(checkoutCharges(quote, { fulfilment: 'delivery', zone: 'elsewhere' }), { delivery: 5_000, connectFee: 0, total: 51_000 });
  assert.deepEqual(checkoutCharges(quote, { fulfilment: 'connect', connectStateId: 's-lagos', centreId: 'cc1' }), { delivery: 3_000, connectFee: 150, total: 49_150 });

  assert.equal(checkoutProblem(quote, { fulfilment: 'delivery', address: 'short' }), 'Write the delivery address in full.');
  assert.equal(checkoutProblem(quote, { fulfilment: 'connect', connectStateId: 's-lagos' }), 'Choose the Connect Centre you collect it from.');
  assert.equal(checkoutProblem(quote, { fulfilment: 'connect', connectStateId: 's-lagos', centreId: 'cc1' }), null);

  assert.deepEqual(checkoutBody(quote, { fulfilment: 'delivery', zone: 'state', address: ' 12 Awolowo Road, Ikoyi ' }), { listing_id: 'l1', fulfilment: 'delivery', delivery_address: '12 Awolowo Road, Ikoyi', delivery_state_id: 's-lagos' });
  assert.deepEqual(checkoutBody(quote, { fulfilment: 'delivery', zone: 'elsewhere', address: '5 Ring Road, Ibadan' }), { listing_id: 'l1', fulfilment: 'delivery', delivery_address: '5 Ring Road, Ibadan' });
  assert.deepEqual(checkoutBody({ ...quote, offer_id: 'o1' }, { fulfilment: 'connect', connectStateId: 's-lagos', centreId: 'cc1' }), { listing_id: 'l1', fulfilment: 'connect', offer_id: 'o1', connect_centre_id: 'cc1' });
});

test('the Buy button: carry on an order, else buy where UdozoPay is open and there is a price and stock', () => {
  const listing = { status: 'active' as const, reserved: false, price: { kind: 'fixed' as const, amount: 45_000, currency: 'NGN' }, in_stock: true };
  assert.deepEqual(buyAction(listing, null, true), { kind: 'checkout', label: 'Buy with UdozoPay' });
  assert.deepEqual(buyAction(listing, { own: false, order: { id: 'o1', number: 'SP-000101', status: 'requested' } }, true), { kind: 'order', id: 'o1', label: 'Continue order SP-000101' });
  assert.equal(buyAction(listing, { own: true, order: null }, true), null);
  assert.equal(buyAction(listing, null, false), null);
  assert.equal(buyAction({ ...listing, in_stock: false }, null, true), null);
  assert.equal(buyAction({ ...listing, price: { kind: 'on_request', amount: null, currency: 'NGN' } } as never, null, true), null);
  assert.equal(buyAction({ ...listing, sale_method: 'auction' }, null, true), null);
});

test('only a Udozo till’s code opens a payment', () => {
  assert.equal(scannedPayToken(`https://udozo.com/pay/${token}`), token);
  assert.equal(scannedPayToken(`https://www.udozo.com/pay/${token}?from=till`), token);
  assert.equal(scannedPayToken(`udozo://pay/${token}`), token);
  assert.equal(scannedPayToken(token), token);
  assert.equal(scannedPayToken(`https://udozo.example/pay/${token}`), null);
  assert.equal(scannedPayToken('https://udozo.com/pay/pw_short'), null);
  assert.equal(scannedPayToken('hello'), null);
});

test('a till payment’s outcome and countdown', () => {
  assert.equal(posPayOutcome({ status: 'waiting', shop: { name: 'Ada Stores' } }), null);
  assert.equal(posPayOutcome({ status: 'paid', shop: { name: 'Ada Stores' } }), 'Paid. Show this to Ada Stores: the sale is done.');
  assert.equal(secondsLeft('2026-11-13T10:05:00Z', Date.parse('2026-11-13T10:00:55Z')), 245);
  assert.equal(secondsLeft('2026-11-13T10:00:00Z', Date.parse('2026-11-13T10:01:00Z')), 0);
  assert.equal(clock(245), '4:05');
});
