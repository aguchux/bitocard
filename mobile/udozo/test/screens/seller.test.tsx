// A seller's page: the banner with the seller's name once, Back, Chat and Call over it, and both always about a listing:
// straight on with one, a chooser with several; Call hidden where the seller takes no calls; signed out, sign in first.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SellerScreen from '@/app/seller/[key]';

import { answers, mockedApi, renderScreen } from './helpers';

const mockAccount = { customer: null as unknown, pending: false };
jest.mock('@/lib/account', () => ({ useAccount: () => mockAccount }));
const mockCalls = { busy: false, start: jest.fn() };
jest.mock('@/components/calls/call-provider', () => ({ useCalls: () => mockCalls }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const listingA = { id: '11111111-1111-4111-8111-111111111111', ref: 77, title: 'iPhone 13 Pro', slug: 'iphone-13-pro', currency: 'NGN', chat: true, phone: true };
const listingB = { id: '22222222-2222-4222-8222-222222222222', ref: 78, title: 'Galaxy S23', slug: 'galaxy-s23', currency: 'NGN', chat: true, phone: false };

const profile = (over: Record<string, unknown> = {}) => ({
  object: 'classified_seller',
  handle: 'abc123',
  username: 'chidi',
  name: 'Chidi O.',
  avatar_url: null,
  banner_url: null,
  country: 'NG',
  url: 'https://udozo.com/ng/seller/chidi',
  member_since: '2025-01-10T00:00:00Z',
  badges: ['phone_confirmed'],
  response_rate: 90,
  active_listings: 2,
  sold_listings: 5,
  safe_pay_sales: 1,
  last_listed_at: null,
  categories: [],
  states: [],
  contact: { chat: true, phone: true },
  contact_listings: [listingA],
  reviews: null,
  scores: null,
  ...over,
});
const card = (item: typeof listingA, amount: number) => ({
  object: 'classified_listing_card',
  id: item.id,
  ref: item.ref,
  title: item.title,
  slug: item.slug,
  country: 'NG',
  url: `https://udozo.com/ng/l/${item.ref}-${item.slug}`,
  price: { kind: 'fixed', amount, currency: 'NGN' },
  condition: 'used',
  category: null,
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  cover: null,
  photo_count: 0,
  has_video: false,
  highlights: [],
  delivery: 'none',
  seller: { name: 'Chidi O.', handle: 'abc123', username: 'chidi', badges: [] },
  published_at: '2026-11-10T10:00:00Z',
});
const viewer = (over: Record<string, unknown> = {}) => ({ object: 'classified_listing_viewer', own: false, can_contact: true, favourite: false, conversation_id: null, calls: true, seller_online: true, ...over });

function serve(seller: ReturnType<typeof profile>, extra: Record<string, unknown> = {}) {
  answers({
    'GET /v1/classifieds/sellers/chidi': seller,
    'GET /v1/classifieds/listings': { object: 'list', data: [card(listingA, 65000000), card(listingB, 52000000)], total: 2, offset: 0 },
    [`GET /v1/classifieds/listings/${listingA.id}/viewer`]: viewer(),
    [`GET /v1/classifieds/listings/${listingB.id}/viewer`]: viewer({ conversation_id: 'chat-b' }),
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount.customer = { id: 'c1', name: 'Ada Obi', seller_handle: 'zzz999', username: null };
  (useLocalSearchParams as jest.Mock).mockReturnValue({ key: 'chidi' });
});

test('the banner names the seller once, with Back, Chat and Call', async () => {
  serve(profile());
  await renderScreen(<SellerScreen />);
  expect(await screen.findByText('Chidi O.')).toBeTruthy();
  expect(screen.getAllByText('Chidi O.')).toHaveLength(1);
  expect(screen.getByText('@chidi')).toBeTruthy();
  expect(screen.getByText('Phone confirmed')).toBeTruthy();
  expect(screen.getByText('On Udozo since January 2025')).toBeTruthy();
  expect(screen.getByLabelText('Back')).toBeTruthy();
  expect(screen.getByLabelText('Chat with seller')).toBeTruthy();
  expect(screen.getByLabelText('Call seller')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Back'));
  expect(router.back).toHaveBeenCalled();
});

test('Chat with one listing goes straight to its message box', async () => {
  serve(profile(), { 'POST /v1/classifieds/conversations': { id: 'chat-a' } });
  await renderScreen(<SellerScreen />);
  fireEvent.press(await screen.findByLabelText('Chat with seller'));
  expect(await screen.findByText('Message the seller')).toBeTruthy();
  expect(screen.queryByText('About which listing?')).toBeNull();
  fireEvent.press(screen.getByText('Send'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'chat-a' } }));
  expect(mockedApi).toHaveBeenCalledWith('/v1/classifieds/conversations', { body: { listing_id: listingA.id, body: 'Hello, is “iPhone 13 Pro” still available?' } });
});

test('Chat with several listings asks which, then opens the chat already going', async () => {
  serve(profile({ contact_listings: [listingA, listingB] }));
  await renderScreen(<SellerScreen />);
  fireEvent.press(await screen.findByLabelText('Chat with seller'));
  expect(await screen.findByText('About which listing?')).toBeTruthy();
  fireEvent.press(await screen.findByLabelText('Galaxy S23, ₦520,000'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'chat-b' } }));
});

test('Call rings the seller about the listing', async () => {
  serve(profile());
  await renderScreen(<SellerScreen />);
  fireEvent.press(await screen.findByLabelText('Call seller'));
  await waitFor(() => expect(mockCalls.start).toHaveBeenCalledWith({ listing_id: listingA.id }));
});

test('Call is hidden where the seller takes no calls', async () => {
  serve(profile({ contact: { chat: true, phone: false }, contact_listings: [{ ...listingA, phone: false }] }));
  await renderScreen(<SellerScreen />);
  expect(await screen.findByLabelText('Chat with seller')).toBeTruthy();
  expect(screen.queryByLabelText('Call seller')).toBeNull();
});

test('signed out, Chat asks to sign in first', async () => {
  mockAccount.customer = null;
  serve(profile());
  await renderScreen(<SellerScreen />);
  fireEvent.press(await screen.findByLabelText('Chat with seller'));
  expect(router.push).toHaveBeenCalledWith('/signin');
});

test('their own page offers Edit profile instead of Chat and Call', async () => {
  mockAccount.customer = { id: 'c2', name: 'Chidi Okafor', seller_handle: 'abc123', username: 'chidi' };
  serve(profile());
  await renderScreen(<SellerScreen />);
  expect(await screen.findByLabelText('Edit profile')).toBeTruthy();
  expect(screen.queryByLabelText('Chat with seller')).toBeNull();
  expect(screen.queryByLabelText('Call seller')).toBeNull();
});
