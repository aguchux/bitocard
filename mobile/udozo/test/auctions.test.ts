// Auctions in the app: where a lot stands, what it says to its reader, and whether a bid can be sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auctionNote, auctionState, bidProblem, bidRefusal, lotShipRefusal, lotTransferWords, timeLeft } from '../src/lib/auctions.ts';

const now = Date.parse('2026-11-13T12:00:00Z');

test('time left and the state are said in words', () => {
  assert.equal(timeLeft('2026-11-13T12:10:00Z', now), '10 minutes');
  assert.equal(timeLeft('2026-11-13T15:00:00Z', now), '3 hours');
  assert.equal(timeLeft('2026-11-16T12:00:00Z', now), '3 days');
  assert.equal(timeLeft('2026-11-13T11:00:00Z', now), 'now');
  assert.match(auctionState({ status: 'live', starts_at: '', ends_at: '2026-11-13T15:00:00Z' }, now), /^Ends in 3 hours/);
  assert.equal(auctionState({ status: 'unsold', starts_at: '', ends_at: '' }), 'The auction ended without a sale.');
});

test('the reader is told where they stand', () => {
  const lot = { status: 'live' as const, kind: 'listing' as const };
  const viewer = { highest: null, leading: false, to_pay: null, won: false, seller: false };
  assert.equal(auctionNote({ ...lot, viewer: { ...viewer, seller: true } }, 'NGN'), 'Your listing is at auction: it sells to the highest bid at or above your reserve.');
  assert.equal(auctionNote({ ...lot, viewer: { ...viewer, highest: 50_000, leading: true } }, 'NGN'), 'You are the highest bidder.');
  assert.equal(auctionNote({ ...lot, viewer: { ...viewer, highest: 50_000 } }, 'NGN'), 'You were outbid.');
  assert.match(auctionNote({ status: 'awaiting_payment', kind: 'abandoned', viewer: { ...viewer, to_pay: { amount: 5_000_000, pay_by: null, order_id: null } } }, 'NGN')!, /^You won it at ₦50,000\. Pay from your Udozo wallet, or/);
  assert.equal(auctionNote({ ...lot, viewer: undefined }, 'NGN'), null);
});

test('a bid must be readable and at least the next step; refusals are worded', () => {
  assert.equal(bidProblem(null, 10_000, 'NGN'), 'Give your bid as an amount.');
  assert.equal(bidProblem(9_000, 10_000, 'NGN'), 'Bid at least ₦100.');
  assert.equal(bidProblem(10_000, 10_000, 'NGN'), null);
  assert.equal(bidRefusal('own_item', 'x'), 'You cannot bid on your own listing.');
  assert.equal(bidRefusal('phone_required', 'x'), 'Confirm your mobile number to bid.');
  assert.equal(bidRefusal('something_else', 'Said by the API.'), 'Said by the API.');
});

test("a won lot's move to a Connect Centre is put in one sentence, and its refusals in words", () => {
  const to = { name: 'Ikeja Connect', address: '5 Allen Avenue', state: 'Lagos', hours: '9 to 6', phone: '+2348000000000' } as never;
  assert.equal(lotTransferWords({ status: 'paid', to, courier: null, tracking_number: null }), 'Udozo is sending it from its warehouse to Ikeja Connect, 5 Allen Avenue, Lagos. We tell you when it arrives.');
  assert.equal(lotTransferWords({ status: 'sent', to, courier: 'GIG', tracking_number: 'T1' }), 'On its way to Ikeja Connect, 5 Allen Avenue, Lagos with GIG (tracking T1).');
  assert.match(lotTransferWords({ status: 'arrived', to, courier: null, tracking_number: null }), /Collect it there with your collection code/);
  assert.equal(lotShipRefusal('price_changed', 'Sending it to a Connect Centre costs ₦3,600 now.'), 'Sending it to a Connect Centre costs ₦3,600 now. Look at the new total and try again.');
  assert.equal(lotShipRefusal('other', 'As it was.'), 'As it was.');
});
