// The listing page: what the seller wrote, the seller, the checks before paying; Save and Chat ask to sign in first,
// and signed in, Chat sends the first message and opens the chat.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ListingScreen from '@/app/listing/[ref]';

import { answers, mockedApi, renderScreen } from './helpers';

const mockAccount = { customer: null as unknown, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [], fixed: false, choose: jest.fn() }) }));

const listing = {
  object: 'classified_listing_page',
  id: '11111111-1111-4111-8111-111111111111',
  ref: 77,
  sku: 'PHN-000077',
  status: 'active',
  title: 'iPhone 13 Pro 256 GB',
  slug: 'iphone-13-pro-256-gb',
  url: 'https://udozo.com/ng/l/77-iphone-13-pro-256-gb',
  description: 'Clean, **no scratches**.\n- Box\n- Charger',
  price: { kind: 'negotiable', amount: 65000000, currency: 'NGN' },
  condition: 'untested',
  category: { slug: 'mobile-phones', name: 'Mobile phones', parent: null, safety_checklist: ['Check the IMEI'] },
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  features: [{ key: 'storage', name: 'Storage', icon: 'hard-drive', unit: 'GB', value: 256 }],
  brand: { object: 'classified_brand', slug: 'apple', name: 'Apple', logo_url: null, color: null },
  photos: [],
  video: null,
  delivery: 'none',
  reserved: false,
  contact: { chat: true, phone: true },
  seller: { name: 'Chidi O.', handle: 'abc123', username: 'chidi', member_since: '2025-01-10T00:00:00Z', badges: ['phone_confirmed'], active_listings: 4, response_rate: 90 },
  published_at: '2026-11-10T10:00:00Z',
  sold_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ref: '77', country: 'NG' });
  mockAccount.customer = null;
});

test('shows the listing in full, and asks a signed-out shopper to sign in before saving or chatting', async () => {
  answers({ 'GET /v1/classifieds/listings/77': listing });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('iPhone 13 Pro 256 GB')).toBeTruthy();
  expect(screen.getByText('₦650,000')).toBeTruthy();
  expect(screen.getByText('Negotiable')).toBeTruthy();
  expect(screen.getByText(/Foreign used/)).toBeTruthy();
  expect(screen.getByText('256 GB')).toBeTruthy();
  expect(screen.getByText('no scratches')).toBeTruthy();
  expect(screen.getByText('• Check the IMEI')).toBeTruthy();
  expect(screen.getByText('Chidi O.')).toBeTruthy();
  expect(mockedApi.mock.calls.some(([path]) => String(path).includes('/viewer'))).toBe(false);

  await fireEvent.press(screen.getByLabelText('Save'));
  expect(router.push).toHaveBeenCalledWith('/signin');
  await fireEvent.press(screen.getByText('Chat with seller'));
  expect(router.push).toHaveBeenCalledTimes(2);

  await fireEvent.press(screen.getByLabelText('Seller Chidi O.. See their page'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/seller/[key]', params: { key: 'chidi' } });
});

test('signed in, the first message opens a chat', async () => {
  mockAccount.customer = { id: 'c1', name: 'Ada Obi' };
  const sent: unknown[] = [];
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: { own: false, favourite: false, conversation_id: null, can_contact: true },
    'POST /v1/classifieds/conversations': (body: unknown) => (sent.push(body), { id: 'chat-1' }),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Chat with seller'));
  await fireEvent.press(await screen.findByText('Send'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'chat-1' } }));
  expect(sent).toEqual([{ listing_id: listing.id, body: 'Hello, is “iPhone 13 Pro 256 GB” still available?' }]);
});

test('the seller sees their own listing as theirs', async () => {
  mockAccount.customer = { id: 'c2', name: 'Chidi Obi' };
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: { own: true, favourite: false, conversation_id: null, can_contact: false },
  });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('This is your listing.')).toBeTruthy();
  expect(screen.queryByText('Report this listing')).toBeNull();
});
