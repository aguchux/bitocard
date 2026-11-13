// Buy orders in the app: the list by side, each step asked first (a counter's price, a reason), Buy this on a listing,
// and Mark sold asking who bought it.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import BuyOrderScreen from '@/app/buy-order/[id]';
import BuyOrdersScreen from '@/app/buy-orders';
import ListingScreen from '@/app/listing/[ref]';
import MyListingsScreen from '@/app/my-listings';

import { answers, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', country: 'NG', currency: 'NGN', phone_verified: true }, pending: false }) }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', currency: 'NGN', buy_orders: true }], fixed: true, choose: jest.fn() }) }));

const listingId = '11111111-1111-4111-8111-111111111111';
const buyOrder = (overrides: Record<string, unknown> = {}) => ({
  object: 'classified_buy_order',
  id: 'b1',
  number: 'BO-000004',
  status: 'requested',
  role: 'seller',
  price: 25_000_000,
  counter: null,
  currency: 'NGN',
  quantity: 1,
  actions: ['accept', 'counter', 'decline'],
  listing: { id: listingId, ref: 77, title: 'Leather sofa', path: '/ng/l/77-leather-sofa', status: 'active', cover_url: null, price: { kind: 'fixed', amount: 27_000_000, currency: 'NGN' } },
  with: { name: 'Ada O.' },
  note: 'Can you deliver?',
  meet_note: 'Ikeja City Mall',
  conversation_id: null,
  respond_by: null,
  meet_by: null,
  meet_extended: false,
  accepted_at: null,
  bought_at: null,
  completes_at: null,
  completed_at: null,
  completed_by: null,
  void_until: null,
  ended_by: null,
  end_reason: null,
  created_at: '2026-11-13T10:00:00Z',
  updated_at: '2026-11-13T10:00:00Z',
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

test('the list shows what waits on the reader, by side', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ role: 'selling' });
  answers({ 'GET /v1/classifieds/me/buy-orders': { object: 'list', data: [buyOrder()], waiting: 1 } });
  await renderScreen(<BuyOrdersScreen />);
  expect(await screen.findByText('Leather sofa')).toBeTruthy();
  expect(screen.getByText('1 waiting for you')).toBeTruthy();
  expect(screen.getByText('BO-000004 · Answer the buyer · ₦250,000')).toBeTruthy();
  await fireEvent.press(screen.getByText('Leather sofa'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/buy-order/[id]', params: { id: 'b1' } });
});

test('the seller offers another price, asked first with the price typed', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'b1' });
  const steps: unknown[] = [];
  answers({
    'GET /v1/classifieds/buy-orders/b1': buyOrder(),
    'POST /v1/classifieds/buy-orders/b1/counter': (body: unknown) => (steps.push(body), buyOrder({ status: 'countered', counter: 26_000_000, actions: ['cancel'] })),
  });
  await renderScreen(<BuyOrderScreen />);
  expect(await screen.findByText('Note: Can you deliver?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Offer another price'));
  await fireEvent.press(await screen.findByText('Send my price'));
  expect(screen.getByText('Give your price as an amount, such as 250,000.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Your price (NGN)'), '260,000');
  await fireEvent.press(screen.getByText('Send my price'));
  await waitFor(() => expect(steps).toEqual([{ price: 26_000_000 }]));
  expect(await screen.findByText('Waiting for the buyer')).toBeTruthy();
});

test('Buy this sends a buy order from the listing and opens it', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ref: '77', country: 'NG' });
  const sent: unknown[] = [];
  answers({
    'GET /v1/classifieds/listings/77': {
      object: 'classified_listing_page',
      id: listingId,
      ref: 77,
      status: 'active',
      title: 'Leather sofa',
      slug: 'leather-sofa',
      description: null,
      price: { kind: 'fixed', amount: 27_000_000, currency: 'NGN' },
      condition: 'used',
      category: { slug: 'sofas', name: 'Sofas', parent: null, safety_checklist: [] },
      area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
      features: [],
      photos: [],
      video: null,
      delivery: 'none',
      reserved: false,
      available: 1,
      contact: { chat: true, phone: true },
      seller: { name: 'Chidi O.', handle: 'abc123', username: null, member_since: '2025-01-10T00:00:00Z', badges: [], active_listings: 4, response_rate: null },
      published_at: '2026-11-10T10:00:00Z',
      sold_at: null,
    },
    [`GET /v1/classifieds/listings/${listingId}/viewer`]: { own: false, favourite: false, conversation_id: null, order: null, buy_orders: true, buy_order: null },
    [`POST /v1/classifieds/listings/${listingId}/buy-orders`]: (body: unknown) => (sent.push(body), buyOrder({ role: 'buyer' })),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Buy this'));
  await fireEvent.changeText(screen.getByLabelText('Your price for all of them (NGN)'), '250,000');
  await fireEvent.changeText(screen.getByLabelText('Where you would like to meet (optional)'), 'Ikeja City Mall');
  await fireEvent.press(screen.getByText('Send buy order'));
  await waitFor(() => expect(sent).toEqual([{ price: 25_000_000, quantity: 1, meet_note: 'Ikeja City Mall' }]));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/buy-order/[id]', params: { id: 'b1' } });
});

test('Mark sold asks who bought it when buy orders were accepted, and marks it sold to them', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  const calls: string[] = [];
  answers({
    'GET /v1/classifieds/me/listings': {
      object: 'list',
      data: [{ id: listingId, status: 'active', title: 'Leather sofa', price: { kind: 'fixed', amount: 27_000_000, currency: 'NGN' }, stock: 1, views: 3, leads: 1, photos: [], expires_at: null, url: null }],
      has_more: false,
    },
    [`GET /v1/classifieds/me/listings/${listingId}/buy-orders`]: { data: [buyOrder({ status: 'accepted', actions: ['complete'] })] },
    'POST /v1/classifieds/buy-orders/b1/complete': () => (calls.push('complete'), buyOrder({ status: 'completed' })),
  });
  await renderScreen(<MyListingsScreen />);
  await fireEvent.press(await screen.findByText('Mark sold'));
  expect(await screen.findByText('Who bought it?')).toBeTruthy();
  await fireEvent.press(screen.getByText('Sold to Ada O. · ₦250,000'));
  await waitFor(() => expect(calls).toEqual(['complete']));
});
