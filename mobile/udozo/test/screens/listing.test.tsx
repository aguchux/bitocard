// The listing page: the summary and its chips, the contact row by what the viewer allows (call backs and contact
// requests), what the seller wrote, the seller, the checks before paying and the rails; Save and Chat ask to sign in
// first, and signed in, Chat sends the first message and opens the chat.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ListingScreen from '@/app/listing/[ref]';

import { answers, mockedApi, refused, renderScreen } from './helpers';

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
  available: 3,
  in_stock: true,
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
  expect(screen.getByText('3 in stock')).toBeTruthy();
  expect(mockedApi.mock.calls.some(([path]) => String(path).includes('/viewer'))).toBe(false);

  await fireEvent.press(screen.getByLabelText('Save'));
  expect(router.push).toHaveBeenCalledWith('/signin');
  await fireEvent.press(screen.getByText('Chat with seller'));
  expect(router.push).toHaveBeenCalledTimes(2);
  // Signed out, the contact row offers every way the listing takes, each asking to sign in first.
  for (const label of ['Chat', 'Call', 'Request call back', 'Request contact']) {
    await fireEvent.press(screen.getByText(label));
    expect(router.push).toHaveBeenLastCalledWith('/signin');
  }
  expect(screen.getByText('Seller page')).toBeTruthy();

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
  expect(screen.queryByText('Request call back')).toBeNull();
  await fireEvent.press(screen.getByText('Edit listing'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: listing.id } });
});

test('the summary chips open the place, the category and the brand', async () => {
  answers({ 'GET /v1/classifieds/listings/77': listing });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByLabelText('Ikeja, Lagos'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/search', params: { country: 'NG', area: 'ikeja', state: 'lagos', place: 'Ikeja, Lagos' } });
  await fireEvent.press(screen.getByLabelText('Mobile phones'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/category/[slug]', params: { slug: 'mobile-phones', country: 'NG' } });
  await fireEvent.press(screen.getByLabelText('Apple'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/brand/[slug]', params: { slug: 'apple', country: 'NG' } });
});

test('the summary and contact row draw while the viewer cannot be read', async () => {
  mockAccount.customer = { id: 'c1', name: 'Ada Obi' };
  answers({ 'GET /v1/classifieds/listings/77': listing });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('iPhone 13 Pro 256 GB')).toBeTruthy();
  expect(screen.getByText('Chat')).toBeTruthy();
  expect(screen.getByText('Seller page')).toBeTruthy();
  // Nothing the viewer has not allowed yet.
  expect(screen.queryByText('Request call back')).toBeNull();
});

const viewer = (more: object) => ({ object: 'classified_listing_viewer', listing_id: listing.id, own: false, favourite: false, conversation_id: null, order: null, can_contact: true, ...more });

test('a call back is asked for, then can be cancelled', async () => {
  mockAccount.customer = { id: 'c1', name: 'Ada Obi' };
  const posted: unknown[] = [];
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: viewer({ callback: { available: true, request: null }, contact: { available: true, shared: null, request: null } }),
    [`POST /v1/classifieds/listings/${listing.id}/callbacks`]: (body: unknown) => (posted.push(body), { object: 'classified_contact_request', id: 'r1', kind: 'callback', status: 'pending' }),
    'POST /v1/classifieds/contact-requests/r1/cancel': () => (posted.push('cancel'), { id: 'r1', status: 'cancelled' }),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Request call back'));
  await fireEvent.changeText(screen.getByLabelText('When is a good time? (optional)'), 'After 6pm');
  await fireEvent.press(screen.getByText('Ask them to call me'));
  expect(await screen.findByText('Sent. The seller has your number and can call you.')).toBeTruthy();
  expect(posted[0]).toEqual({ note: 'After 6pm' });
  await fireEvent.press(screen.getByText('Done'));
  expect(await screen.findByText('Call back asked')).toBeTruthy();
  await fireEvent.press(screen.getByText('Cancel my call back request'));
  await waitFor(() => expect(posted).toContain('cancel'));
});

test('a call back without a confirmed mobile says how to confirm it', async () => {
  mockAccount.customer = { id: 'c1', name: 'Ada Obi' };
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: viewer({ callback: { available: true, request: null } }),
    [`POST /v1/classifieds/listings/${listing.id}/callbacks`]: () => refused(409, 'phone_required', 'Confirm your mobile number first.'),
  });
  await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Request call back'));
  await fireEvent.press(screen.getByText('Ask them to call me'));
  await fireEvent.press(await screen.findByText('Confirm my mobile'));
  expect(router.push).toHaveBeenLastCalledWith('/verify');
});

test("a contact request is sent; once accepted, the seller's phone and email open the phone and mail", async () => {
  mockAccount.customer = { id: 'c1', name: 'Ada Obi' };
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: viewer({ contact: { available: true, shared: null, request: null } }),
    [`POST /v1/classifieds/listings/${listing.id}/contact-requests`]: { object: 'classified_contact_request', id: 'r2', kind: 'contact', status: 'pending' },
  });
  const first = await renderScreen(<ListingScreen />);
  await fireEvent.press(await screen.findByText('Request contact'));
  await fireEvent.press(screen.getByText('Send request'));
  expect(await screen.findByText('Sent. If the seller accepts, their phone and email will show here.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Done'));
  expect(await screen.findByText('Contact requested')).toBeTruthy();
  await first.unmount();

  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  answers({
    'GET /v1/classifieds/listings/77': listing,
    [`GET /v1/classifieds/listings/${listing.id}/viewer`]: viewer({ contact: { available: true, shared: { phone: '+2348030000001', email: 'chidi@example.com' }, request: { id: 'r2', status: 'accepted', ask_again_at: null } } }),
  });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('The seller shared their contact with you')).toBeTruthy();
  expect(screen.queryByText('Request contact')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Call +2348030000001'));
  expect(open).toHaveBeenCalledWith('tel:+2348030000001');
  await fireEvent.press(screen.getByLabelText('Email chidi@example.com'));
  expect(open).toHaveBeenCalledWith('mailto:chidi@example.com');
});

test('more from the seller and similar listings, never this listing itself', async () => {
  const card = (id: string, ref: number, title: string) => ({ object: 'classified_listing_card', id, ref, title, slug: 's', country: 'NG', url: '', price: { kind: 'fixed', amount: 100000, currency: 'NGN' }, condition: 'used', category: null, area: listing.area, cover: null, photo_count: 0, has_video: false, highlights: [], delivery: 'none', seller: { name: 'Chidi O.', badges: [] }, published_at: null, tier: null, delivers_to_you: false });
  answers({
    'GET /v1/classifieds/listings/77': listing,
    'GET /v1/classifieds/listings': { object: 'list', data: [card(listing.id, 77, 'iPhone 13 Pro 256 GB'), card('22222222-2222-4222-8222-222222222222', 78, 'Galaxy S23')], total: 2, tiers: null, offset: 0, limit: 24, sort: 'relevant' },
  });
  await renderScreen(<ListingScreen />);
  expect(await screen.findByText('More from this seller')).toBeTruthy();
  expect(await screen.findByText('Similar listings')).toBeTruthy();
  expect(screen.getAllByText('Galaxy S23')).toHaveLength(2);
  // Only the page's own title, never a card of it.
  expect(screen.queryAllByLabelText(/^iPhone 13 Pro 256 GB,/)).toHaveLength(0);
  const asked = mockedApi.mock.calls.map(([path]) => String(path));
  expect(asked).toContain('/v1/classifieds/listings?country=NG&offset=0&limit=24&seller=chidi');
  expect(asked).toContain('/v1/classifieds/listings?country=NG&offset=0&limit=24&category=mobile-phones&area=ikeja&state=lagos');
});
