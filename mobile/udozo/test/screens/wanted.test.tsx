// Sell's two cards (Post an ad, then Request an ad where wanted requests are open), posting a request, its refusals in
// words, the reader's requests and closing one.
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SellScreen from '@/app/(tabs)/sell';
import WantedRequestScreen from '@/app/wanted/[id]';
import WantedScreen from '@/app/wanted/index';
import NewWantedScreen from '@/app/wanted/new';

import { answers, mockedApi, refused, renderScreen } from './helpers';

jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', country: 'NG', currency: 'NGN' }, pending: false, error: null, retry: jest.fn() }) }));

const categories = { data: [{ id: 't1', slug: 'vehicles', name: 'Vehicles', children: [{ id: 'c-cars', slug: 'cars', name: 'Cars', keywords: ['car'], features: [] }] }] };
const areas = { data: [{ id: 's-lagos', name: 'Lagos', kind: 'state', areas: [{ id: 'a-ikeja', name: 'Ikeja', kind: 'area' }] }] };
const channels = (wanted: boolean) => ({ object: 'classified_channels', country: 'NG', whatsapp: { available: false, number: null }, wanted });

const card = {
  object: 'classified_listing_card',
  id: 'l1',
  ref: 77,
  title: 'Toyota Corolla 2012',
  slug: 'toyota-corolla-2012',
  country: 'NG',
  url: 'https://udozo.com/ng/l/77-toyota-corolla-2012',
  price: { kind: 'fixed', amount: 400_000_000, currency: 'NGN' },
  condition: 'used',
  category: null,
  area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } },
  cover: null,
  photo_count: 0,
  has_video: false,
  highlights: [],
  delivery: 'none',
  seller: { name: 'Ada O.', badges: [] },
  published_at: null,
};
const id = '0b6c7c9e-1d2a-4f3b-9a8e-123456789abc';
const request = (overrides: Record<string, unknown> = {}) => ({
  object: 'classified_wanted_request',
  id,
  number: 'WR-000012',
  words: 'Toyota Corolla',
  details: null,
  country: 'NG',
  category: { id: 'c-cars', slug: 'cars', name: 'Cars' },
  place: 'Ikeja, Lagos',
  state: null,
  area: null,
  budget: { min: null, max: 450_000_000, currency: 'NGN', text: '₦4,500,000' },
  conditions: [],
  condition_text: null,
  status: 'open',
  source: 'web',
  mine: true,
  buyer: 'Chidi O.',
  sellers_told: 4,
  responses: 1,
  expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  created_at: '2026-11-13T10:00:00Z',
  ...overrides,
});

const sellRoutes = {
  'GET /v1/classifieds/me/listings': { object: 'list', data: [] },
  'GET /v1/classifieds/me/contact-requests': { pending: 0 },
  'GET /v1/classifieds/me/resellers': { data: [] },
};

beforeEach(() => jest.clearAllMocks());

test('Sell shows Post an ad first, with Request an ad beside it where requests are open', async () => {
  answers({ ...sellRoutes, 'GET /v1/classifieds/channels': channels(true) });
  await renderScreen(<SellScreen />);
  expect(await screen.findByTestId('sell-carousel')).toBeTruthy();
  const titles = screen.getAllByText(/^(Post an ad|Request an ad)$/, { exact: true }).map(node => node.props.children);
  expect(titles[0]).toBe('Post an ad');
  expect(screen.getByLabelText('Post an ad, 1 of 2').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByLabelText('Request an ad, 2 of 2').props.accessibilityState).toEqual({ selected: false });
  await fireEvent.press(screen.getByRole('button', { name: 'Request an ad' }));
  expect(router.push).toHaveBeenCalledWith('/wanted/new');
  expect(screen.getByText('Wanted requests')).toBeTruthy();
});

test('Sell shows only Post an ad where requests are closed', async () => {
  answers({ ...sellRoutes, 'GET /v1/classifieds/channels': channels(false) });
  await renderScreen(<SellScreen />);
  expect(await screen.findByRole('button', { name: 'Post an ad' })).toBeTruthy();
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/v1/classifieds/channels?country=NG'));
  expect(screen.queryByTestId('sell-carousel')).toBeNull();
  expect(screen.queryByText('Request an ad')).toBeNull();
  expect(screen.queryByText('Wanted requests')).toBeNull();
});

async function fillForm() {
  await renderScreen(<NewWantedScreen />);
  await fireEvent.changeText(await screen.findByLabelText('What are you looking for?'), 'Toyota Corolla');
  await fireEvent.press(await screen.findByLabelText('Category: Choose a category'));
  await fireEvent.press(screen.getByText('Vehicles'));
  await fireEvent.press(screen.getByText('Cars'));
  await fireEvent.press(screen.getByLabelText('Where (state): Anywhere'));
  await fireEvent.press(screen.getByText('Lagos'));
  await fireEvent.press(screen.getByText('Ikeja'));
  await fireEvent.changeText(screen.getByLabelText('Most you would pay (NGN, optional)'), '4,500,000');
  await fireEvent.press(screen.getByText('Used is fine'));
}

test('a request is posted with the budget in minor units, then what may fit shows', async () => {
  const posted = jest.fn(() => ({ ...request({ responses: 0 }), matches: [card] }));
  answers({
    'GET /v1/classifieds/channels': channels(true),
    'GET /v1/classifieds/categories': categories,
    'GET /v1/classifieds/areas': areas,
    'POST /v1/classifieds/wanted': posted,
  });
  await fillForm();
  await fireEvent.press(screen.getByRole('button', { name: 'Post request' }));
  expect(await screen.findByText('Request WR-000012 is up for 14 days')).toBeTruthy();
  expect(posted).toHaveBeenCalledWith({ words: 'Toyota Corolla', category_id: 'c-cars', area_id: 'a-ikeja', budget_max: 450_000_000, conditions: ['used', 'untested'] });
  expect(screen.getByText('We told 4 sellers who sell this. Their answers come to your chats.')).toBeTruthy();
  expect(screen.getByLabelText(/^Toyota Corolla 2012, ₦4,000,000/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'See your request' }));
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/wanted/[id]', params: { id } });
});

test('a refusal is said in words', async () => {
  answers({
    'GET /v1/classifieds/channels': channels(true),
    'GET /v1/classifieds/categories': categories,
    'GET /v1/classifieds/areas': areas,
    'POST /v1/classifieds/wanted': refused(409, 'too_many_requests', 'You have 3 open requests. Close one first.'),
  });
  await fillForm();
  await fireEvent.press(screen.getByRole('button', { name: 'Post request' }));
  expect(await screen.findByText(/Close one you no longer need in My wanted requests/)).toBeTruthy();
});

test('nothing is sent while what is needed is missing', async () => {
  answers({ 'GET /v1/classifieds/channels': channels(true), 'GET /v1/classifieds/categories': categories, 'GET /v1/classifieds/areas': areas });
  await renderScreen(<NewWantedScreen />);
  await fireEvent.changeText(await screen.findByLabelText('What are you looking for?'), 'Toyota Corolla');
  await fireEvent.press(screen.getByRole('button', { name: 'Post request' }));
  expect(screen.getByText('Choose a category.')).toBeTruthy();
  expect(mockedApi).not.toHaveBeenCalledWith('/v1/classifieds/wanted', expect.anything());
});

test('my requests list each with its answers and open it', async () => {
  answers({ 'GET /v1/classifieds/me/wanted': { object: 'list', data: [request()], total: 1 } });
  await renderScreen(<WantedScreen />);
  expect(await screen.findByText('Toyota Corolla')).toBeTruthy();
  expect(screen.getByText('1 answer from sellers')).toBeTruthy();
  await fireEvent.press(screen.getByText('Toyota Corolla'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/wanted/[id]', params: { id } });
});

test('a request shows the sellers’ answers, and I found it closes it', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id });
  let closed = false;
  const close = jest.fn(() => {
    closed = true;
    return request({ status: 'fulfilled' });
  });
  answers({
    [`GET /v1/classifieds/wanted/${id}`]: () => ({
      ...request({ status: closed ? 'fulfilled' : 'open' }),
      matches: [],
      responses: [{ id: 'r1', seller: 'Bola A.', note: 'Clean, one owner', listing: card, conversation_id: 'conv-1', created_at: '2026-11-13T11:00:00Z' }],
    }),
    [`POST /v1/classifieds/wanted/${id}/close`]: close,
  });
  await renderScreen(<WantedRequestScreen />);
  expect(await screen.findByText('Bola A.')).toBeTruthy();
  expect(screen.getByText('Clean, one owner')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Open the chat' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'conv-1' } });
  await fireEvent.press(screen.getByRole('button', { name: 'I found it' }));
  const dialog = within(screen.getByTestId('dialog'));
  expect(dialog.getByRole('header', { name: 'Did you find it?' })).toBeTruthy();
  await fireEvent.press(dialog.getByRole('button', { name: 'I found it' }));
  await waitFor(() => expect(close).toHaveBeenCalledWith({ fulfilled: true }));
  expect(await screen.findByRole('alert', { name: 'Glad you found it. Your request is closed.' })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'I found it' })).toBeNull());
  expect(screen.getByText('WR-000012 · Found it')).toBeTruthy();
});
