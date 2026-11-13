// An order's extras: a Connect return's words and when it can be sent on, the claim to an auction's left-over, and a
// resale order's money for its supplier.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canClaim, canShip, claimWords, returnTitle, sellerLines, transferWords } from '../src/lib/order-extras.ts';

const now = Date.parse('2026-11-13T12:00:00Z');
const item = { id: 'r1', number: 'RT-000007', reason: 'not_collected' as const, status: 'accepted' as const, answer_by: '', decided_by: null, collect_by: '2026-11-20T00:00:00Z', collected_at: null };

test('a return is titled by where it stands, and is sent on only while accepted, at the centre and in time', () => {
  assert.equal(returnTitle({ ...item, status: 'requested' }), 'Return RT-000007: asked for');
  assert.equal(returnTitle({ ...item, place: 'auctioned' }), 'Return RT-000007: ended at auction');
  assert.equal(canShip(item, now), true);
  assert.equal(canShip({ ...item, collect_by: '2026-11-01T00:00:00Z' }, now), false);
  assert.equal(canShip({ ...item, abandoned_at: '2026-11-10T00:00:00Z' }, now), false);
  const to = { name: 'Yaba Connect Centre', address: '2 Road', state: 'Lagos', hours: '9 to 6', phone: '0800' };
  const move = { number: 'TF-1', status: 'sent' as const, to, shipping: 0, courier: 'GIG', tracking_number: 'T1', sent_at: null, arrived_at: null };
  assert.equal(canShip({ ...item, transfer: move }, now), false);
  assert.equal(transferWords(move, 'Ikeja'), 'On its way to Yaba Connect Centre, 2 Road, Lagos with GIG (tracking T1).');
});

test('an auction left-over is claimed once, within its days', () => {
  const auction = { number: 'AU-1', sale: 6_000_000, left_over: 1_200_000, claim_by: '2026-12-01T00:00:00Z', unclaimed_at: null, claim: null };
  assert.equal(canClaim(auction, now), true);
  assert.match(claimWords(auction, 'NGN', now), /^₦12,000 is left over for you/);
  assert.equal(canClaim({ ...auction, claim: { number: 'CL-1', status: 'requested', amount: 1_200_000, decision_note: null, decided_at: null } }, now), false);
  assert.equal(canClaim({ ...auction, left_over: 0 }, now), false);
  assert.equal(claimWords({ ...auction, left_over: 0 }, 'NGN', now), 'Its sale paid what it could of the storage owed. Nothing is left over.');
});

test('a supplier sees their price, the reseller’s discount, the fee and what they receive', () => {
  const lines = sellerLines({ price: 4_500_000, quantity: 1, resale: { supplier_price: 4_500_000, discount_bps: 1000, supplier_net: 4_050_000, deal_id: null }, delivery_fee: 0, seller_fee: 50_000, payout: 4_000_000, status: 'paid' }, 'UdozoPay fee');
  assert.deepEqual(lines, [
    { label: 'Your price', amount: 4_500_000 },
    { label: 'Reseller’s discount', amount: -450_000 },
    { label: 'UdozoPay fee', amount: -50_000 },
    { label: 'You receive', amount: 4_000_000, strong: true },
  ]);
});
