// Bidding on a listing sold by auction: the bid is checked, confirmed with its amount (and the phone's lock), sent with
// a kept Idempotency-Key, and a refusal is put in words; a lot of Udozo's is paid from the wallet.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';

import ListingScreen from '@/app/listing/[ref]';

import { answers, mockedApi, refused, renderScreen } from './helpers';

const mockAccount = { customer: { id: 'c1', country: 'NG', currency: 'NGN', phone_verified: true } as unknown, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', currency: 'NGN', safe_pay: true }], fixed: true, choose: jest.fn() }) }));

const id = '11111111-1111-4111-8111-111111111111';
const auction = (overrides: Record<string, unknown> = {}) => ({
  object: 'listing_auction',
  number: 'AU-000012',
  ref: '000012',
  kind: 'listing',
  warehouse: null,
  status: 'live',
  start_price: 10_000_000,
  current_price: 12_000_000,
  next_bid: 12_600_000,
  bids: 3,
  reserve_met: false,
  starts_at: '2026-11-10T10:00:00Z',
  ends_at: '2099-11-20T10:00:00Z',
  rules: { step_pct: 5, step_min: 50_000, extend_minutes: 5, pay_hours: 48 },
  recent_bids: [{ name: 'Ada N.', amount: 12_000_000, at: '2026-11-12T10:00:00Z' }],
  viewer: { highest: null, leading: false, to_pay: null, won: false, seller: false },
  ...overrides,
});
const listing = (lot: unknown) => ({
  object: 'classified_listing_page',
  id,
  ref: 77,
  sku: 'PHN-000077',
  status: 'active',
  sale_method: 'auction',
  auction: lot,
  title: 'iPhone 13 Pro 256 GB',
  slug: 'iphone-13-pro-256-gb',
  description: null,
  price: { kind: 'fixed', amount: 10_000_000, currency: 'NGN' },
  condition: 'used',
  category: { slug: 'mobile-phones', name: 'Mobile phones', parent: null, safety_checklist: [] },
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  features: [],
  photos: [],
  video: null,
  delivery: 'none',
  reserved: false,
  contact: { chat: true, phone: true },
  seller: { name: 'Chidi O.', handle: 'abc123', username: 'chidi', member_since: '2025-01-10T00:00:00Z', badges: [], active_listings: 4, response_rate: 90 },
  published_at: '2026-11-10T10:00:00Z',
  sold_at: null,
});
const viewerOf = (lot: unknown) => ({ own: false, favourite: false, conversation_id: null, order: null, auction: lot });

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ref: '77', country: 'NG' });
});

test('a bid below the next step is stopped; a good one is confirmed and sent; a refusal is worded', async () => {
  const bids: unknown[] = [];
  answers({
    'GET /v1/classifieds/listings/77': listing(auction()),
    [`GET /v1/classifieds/listings/${id}/viewer`]: viewerOf(auction()),
    [`POST /v1/classifieds/listings/${id}/bids`]: (body: unknown) => (bids.push(body), auction({ current_price: 13_000_000, next_bid: 13_650_000, bids: 4 })),
  });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('Auction AU-000012')).toBeTruthy();
  expect(screen.getByText('Highest bid')).toBeTruthy();
  expect(screen.getByText('Reserve not met')).toBeTruthy();
  expect(screen.getByText('Ada N.')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Your bid (NGN)'), '125,000');
  await fireEvent.press(screen.getByText('Place bid'));
  expect(screen.getByText('Bid at least ₦126,000.')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Your bid (NGN)'), '130,000');
  await fireEvent.press(screen.getByText('Place bid'));
  expect(await screen.findByText('Bid ₦130,000?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Place my bid'));
  await waitFor(() => expect(bids).toEqual([{ amount: 13_000_000 }]));
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: 'Bid ₦130,000' }));
  const sent = mockedApi.mock.calls.find(([path]) => String(path).endsWith('/bids'));
  expect(sent?.[1]).toMatchObject({ idempotencyKey: expect.any(String) });

  answers({
    'GET /v1/classifieds/listings/77': listing(auction()),
    [`GET /v1/classifieds/listings/${id}/viewer`]: viewerOf(auction()),
    [`POST /v1/classifieds/listings/${id}/bids`]: refused(403, 'own_item', 'This is your own listing.'),
  });
  await fireEvent.changeText(screen.getByLabelText('Your bid (NGN)'), '140,000');
  await fireEvent.press(screen.getByText('Place bid'));
  await fireEvent.press(await screen.findByText('Place my bid'));
  expect(await screen.findByText('You cannot bid on your own listing.')).toBeTruthy();
});

test('a won lot of a seller opens its order', async () => {
  answers({
    'GET /v1/classifieds/listings/77': listing(auction({ status: 'awaiting_payment' })),
    [`GET /v1/classifieds/listings/${id}/viewer`]: viewerOf(auction({ status: 'awaiting_payment', viewer: { highest: 13_000_000, leading: true, to_pay: { amount: 13_000_000, pay_by: null, order_id: 'o9' }, won: false, seller: false } })),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Pay for your winning bid'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: 'o9' } });
});

test('a lot of Udozo is paid from the wallet', async () => {

  const paid: string[] = [];
  const lot = auction({ kind: 'abandoned', status: 'awaiting_payment', warehouse: { name: 'Udozo Lagos', address: '1 Road', hours: '9 to 5', state: 'Lagos' }, viewer: { highest: 13_000_000, leading: true, to_pay: { amount: 13_000_000, pay_by: null, order_id: null }, won: false, seller: false } });
  answers({
    'GET /v1/classifieds/listings/77': listing(lot),
    [`GET /v1/classifieds/listings/${id}/viewer`]: viewerOf(lot),
    'POST /v1/classifieds/auctions/000012/pay': () => (paid.push('pay'), { status: 'paid' }),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Pay ₦130,000 from your wallet'));
  expect(await screen.findByText('Pay ₦130,000?')).toBeTruthy();
  await fireEvent.press(await screen.findByText('Pay from my wallet'));
  await waitFor(() => expect(paid).toEqual(['pay']));
});

test('a won lot of Udozo is sent to a Connect Centre near the buyer, its total confirmed, and the move can be stopped', async () => {
  const centre = { id: '22222222-2222-4222-8222-222222222222', name: 'Ikeja Connect', area: 'Ikeja', state: 'Lagos', address: '5 Allen Avenue', landmark: null, hours: '9 to 6', phone: '+2348000000000' };
  const won = { highest: 13_000_000, leading: true, to_pay: null, won: true, seller: false, collected: false };
  let transfer: unknown = null;
  const lot = () => auction({ kind: 'abandoned', status: 'sold', warehouse: { name: 'Udozo Lagos', address: '1 Road', hours: '9 to 5', state: 'Lagos' }, viewer: { ...won, transfer } });
  const sent: unknown[] = [];
  const stopped: string[] = [];
  answers({
    'GET /v1/classifieds/listings/77': () => listing(lot()),
    [`GET /v1/classifieds/listings/${id}/viewer`]: () => viewerOf(lot()),
    'GET /v1/classifieds/auctions/000012/ship-options': { object: 'list', currency: 'NGN', shipping: 300_000, fee: 50_000, total: 350_000, data: [{ centre }] },
    'POST /v1/classifieds/auctions/000012/ship': (body: unknown) => {
      sent.push(body);
      transfer = { object: 'connect_transfer', number: 'TF-000004', status: 'paid', shipping: 300_000, fee: 50_000, to: centre, courier: null, tracking_number: null };
      return { number: 'TF-000004', status: 'paid' };
    },
    'POST /v1/classifieds/auctions/000012/ship/cancel': () => (stopped.push('cancel'), (transfer = null), { status: 'cancelled' }),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Have it sent to a Connect Centre near me'));
  await fireEvent.press(await screen.findByText('Lagos: Ikeja Connect, Ikeja'));
  expect(screen.getByText('Shipping ₦3,000 and the centre\'s Connect fee ₦500.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay ₦3,500 and send it'));
  expect(await screen.findByText('Send it to Ikeja Connect?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pay and send it'));
  await waitFor(() => expect(sent).toEqual([{ centre_id: centre.id, expected_total: 350_000 }]));
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: 'Pay ₦3,500 to send it' }));
  const call = mockedApi.mock.calls.find(([path]) => String(path).endsWith('/ship'));
  expect(call?.[1]).toMatchObject({ idempotencyKey: expect.any(String) });

  expect(await screen.findByText(/TF-000004: Udozo is sending it from its warehouse to Ikeja Connect/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Stop sending it'));
  expect(await screen.findByText('Stop sending it?')).toBeTruthy();
  await fireEvent.press(screen.getAllByText('Stop sending it').at(-1)!);
  await waitFor(() => expect(stopped).toEqual(['cancel']));
});
