// Post an ad and My listings: the first step makes the draft, a saved draft opens where it stopped, posting accepts the
// terms first, and a live ad is marked sold or restocked.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import MyListingsScreen from '@/app/my-listings';
import PostScreen from '@/app/post/[id]';

import { answers, refused, renderScreen } from './helpers';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@/lib/account', () => ({ useAccount: () => ({ customer: { id: 'c1', country: 'NG', currency: 'NGN' }, pending: false, error: null, retry: jest.fn() }) }));
jest.mock('@/lib/market', () => ({ useMarket: () => ({ country: 'NG', markets: [{ country: 'NG', currency: 'NGN' }], fixed: true, choose: jest.fn() }) }));

const categories = {
  data: [
    {
      id: 't1',
      slug: 'phones-tablets',
      name: 'Phones and tablets',
      children: [{ id: 'c-phones', slug: 'mobile-phones', name: 'Mobile phones', keywords: ['phone'], features: [{ key: 'storage', name: 'Storage', data_type: 'number', unit: 'GB', choices: [], placeholder: null, filter: true }] }],
    },
  ],
};
const areas = { data: [{ id: 's-lagos', name: 'Lagos', kind: 'state', areas: [{ id: 'a-ikeja', name: 'Ikeja', kind: 'area' }] }] };

const listing = (overrides: Record<string, unknown> = {}) => ({
  object: 'classified_listing',
  id: 'l1',
  ref: 101,
  sku: 'PHN-000101',
  status: 'draft',
  review_reason: null,
  review_flags: [],
  title: 'iPhone 13 128GB',
  description: 'Clean, no scratches.',
  price: { kind: 'fixed', amount: 45_000_000, currency: 'NGN' },
  condition: 'used',
  category: { id: 'c-phones', slug: 'mobile-phones', name: 'Mobile phones', parent: null },
  country: 'NG',
  area: { id: 'a-ikeja', slug: 'ikeja', name: 'Ikeja', state: { id: 's-lagos', slug: 'lagos', name: 'Lagos' } },
  features: [],
  photos: [0, 1, 2, 3].map(index => ({ id: `p${index}`, url: `https://udozo.com/img/p${index}.jpg`, width: 1600, height: 1200, status: 'ready' })),
  video: null,
  delivery: 'none',
  pickup: true,
  delivery_fees: { within_state: 0, nationwide: 0 },
  contact: 'both',
  views: 12,
  leads: 3,
  on_shop: true,
  resale: { enabled: false, discount_bps: null, markup_max_bps: null, paused: false },
  stock: 1,
  url: 'https://udozo.com/ng/l/101-iphone-13',
  created_at: '2026-11-10T09:00:00Z',
  updated_at: '2026-11-10T09:00:00Z',
  submitted_at: null,
  published_at: null,
  expires_at: null,
  sold_at: null,
  ...overrides,
});

const base = {
  'GET /v1/classifieds/categories': categories,
  'GET /v1/classifieds/areas': areas,
  'GET /v1/classifieds/assistant': refused(404, 'resource_missing', 'No assistant.'),
};

beforeEach(() => jest.clearAllMocks());

test('the first step says what is missing, then makes the draft and moves to photos', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'new' });
  const created: unknown[] = [];
  answers({
    ...base,
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'POST /v1/classifieds/listings': (body: unknown) => (created.push(body), listing({ title: 'iPhone 13 128GB', photos: [], price: { kind: 'fixed', amount: null, currency: 'NGN' } })),
    'GET /v1/classifieds/me/listings/l1': listing({ photos: [] }),
  });
  await renderScreen(<PostScreen />);
  await fireEvent.press(await screen.findByText('Next'));
  expect(await screen.findByText('Give your ad a title of at least 5 characters.')).toBeTruthy();
  expect(created).toHaveLength(0);

  await fireEvent.changeText(screen.getByLabelText('Title'), 'iPhone 13 128GB');
  await fireEvent.press(screen.getByLabelText('Category: Choose a category'));
  await fireEvent.press(await screen.findByText('Phones and tablets'));
  await fireEvent.press(await screen.findByText('Mobile phones'));
  await fireEvent.press(screen.getByText('Next'));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toMatchObject({ title: 'iPhone 13 128GB', category_id: 'c-phones', price_kind: 'fixed', price: null, pickup: true, contact: 'both', stock: 1 });
  expect(await screen.findByText('Step 2 of 5')).toBeTruthy();
  expect(screen.getByText('Add at least 4 clear photos, up to 12. The first is the cover.')).toBeTruthy();
});

test('a finished draft opens at the last step; posting accepts the terms first, then submits', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1' });
  const calls: string[] = [];
  answers({
    ...base,
    'GET /v1/classifieds/me/listings/l1': listing(),
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: false, previous_version: null },
    'POST /v1/classifieds/terms/accept': (body: unknown) => (calls.push(`accept ${JSON.stringify(body)}`), { accepted: true }),
    'PATCH /v1/classifieds/listings/l1': (body: unknown) => (calls.push('save'), expect(body).toMatchObject({ price: 45_000_000, area_id: 'a-ikeja' }), listing()),
    'POST /v1/classifieds/listings/l1/submit': () => (calls.push('submit'), listing({ status: 'active' })),
  });
  await renderScreen(<PostScreen />);
  expect(await screen.findByText('Check and post')).toBeTruthy();
  expect(screen.getByText('Ikeja, Lagos')).toBeTruthy();

  await fireEvent.press(screen.getByText('Post my ad'));
  expect(await screen.findByText('Tick to accept Udozo’s terms first.')).toBeTruthy();
  expect(calls).toEqual(['save']);

  await fireEvent.press(screen.getByText('I accept Udozo’s terms'));
  await fireEvent.press(screen.getByText('Post my ad'));
  expect(await screen.findByText('Your ad is live')).toBeTruthy();
  expect(calls).toEqual(['save', 'save', 'accept {"version":"2026-11-10"}', 'submit']);
});

test('a refusal from the API opens the step holding its field', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1' });
  answers({
    ...base,
    'GET /v1/classifieds/me/listings/l1': listing(),
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'PATCH /v1/classifieds/listings/l1': listing(),
    'POST /v1/classifieds/listings/l1/submit': refused(400, 'photos_required', 'Add at least 5 photos.', 'photos'),
  });
  await renderScreen(<PostScreen />);
  await fireEvent.press(await screen.findByText('Post my ad'));
  expect(await screen.findByText('Add at least 5 photos.')).toBeTruthy();
  expect(screen.getByText('Step 2 of 5')).toBeTruthy();
});

test('My listings marks a live ad sold after asking, and restocks one', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => buttons?.at(-1)?.onPress?.());
  const calls: string[] = [];
  answers({
    'GET /v1/classifieds/me/listings': { object: 'list', data: [listing({ status: 'active', stock: 2 })], has_more: false },
    'POST /v1/classifieds/listings/l1/sold': () => (calls.push('sold'), listing({ status: 'sold' })),
    'PATCH /v1/classifieds/listings/l1': (body: unknown) => (calls.push(`stock ${JSON.stringify(body)}`), listing({ status: 'active', stock: 5 })),
  });
  await renderScreen(<MyListingsScreen />);
  expect(await screen.findByText('iPhone 13 128GB')).toBeTruthy();
  expect(screen.getByText(/Live · 2 in stock · 12 views · 3 leads/)).toBeTruthy();

  await fireEvent.press(screen.getByText('Mark sold'));
  expect(alert.mock.calls[0][0]).toBe('Mark it sold?');
  await waitFor(() => expect(calls).toEqual(['sold']));

  await fireEvent.press(screen.getByText('Restock'));
  await fireEvent.changeText(screen.getByLabelText('In stock'), '5');
  await fireEvent.press(screen.getByText('Save'));
  await waitFor(() => expect(calls).toEqual(['sold', 'stock {"stock":5}']));
  alert.mockRestore();
});
