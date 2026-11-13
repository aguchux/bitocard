// Post an ad and My listings: the first step makes the draft, a saved draft opens where it stopped, posting accepts the
// terms first, and a live ad is marked sold or restocked.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import MyListingsScreen from '@/app/my-listings';
import PostScreen from '@/app/post/[id]';
import { pickVideo, uploadListingVideo } from '@/lib/picture';

import { answers, refused, renderScreen } from './helpers';

jest.mock('@/lib/picture', () => ({ ...jest.requireActual('@/lib/picture'), pickVideo: jest.fn(), uploadListingVideo: jest.fn() }));
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
  expect(await screen.findByText('Step 2 of 6')).toBeTruthy();
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
  expect(screen.getByText('Step 2 of 6')).toBeTruthy();
});

test('My listings marks a live ad sold after asking, and restocks one', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
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
  const dialog = within(screen.getByTestId('dialog'));
  expect(dialog.getByRole('header', { name: 'Mark it sold?' })).toBeTruthy();
  await fireEvent.press(dialog.getByRole('button', { name: 'Mark sold' }));
  await waitFor(() => expect(calls).toEqual(['sold']));
  expect(await screen.findByRole('alert', { name: 'Marked sold' })).toBeTruthy();

  await fireEvent.press(screen.getByText('Restock'));
  await fireEvent.changeText(screen.getByLabelText('In stock'), '5');
  await fireEvent.press(screen.getByText('Save'));
  await waitFor(() => expect(calls).toEqual(['sold', 'stock {"stock":5}']));
});

test('the photos step sends a video with its progress, never holds the ad back while it is prepared, and words a refusal', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1' });
  let video: unknown = null;
  answers({
    ...base,
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'GET /v1/classifieds/me/listings/l1': () => listing({ title: 'iPhone', photos: [], video }),
  });
  let progress: (percent: number) => void = () => undefined;
  let finish: () => void = () => undefined;
  (pickVideo as jest.Mock).mockResolvedValue({ video: { uri: 'file:///clip.mp4', name: 'clip.mp4', type: 'video/mp4' } });
  (uploadListingVideo as jest.Mock).mockImplementation((id: string, picked: unknown, onProgress: (percent: number) => void) => {
    progress = onProgress;
    return { done: new Promise<void>(resolve => (finish = resolve)), abort: jest.fn() };
  });
  await renderScreen(<PostScreen />);
  expect(await screen.findByText('Add a video (optional)')).toBeTruthy();

  await fireEvent.press(screen.getByText('Choose a video'));
  expect(pickVideo).toHaveBeenCalledWith('library');
  await waitFor(() => expect(uploadListingVideo).toHaveBeenCalledWith('l1', expect.objectContaining({ type: 'video/mp4' }), expect.any(Function)));
  await act(async () => progress(40));
  expect(screen.getByText('Sending video (40%)')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);

  video = { id: 'v1', url: null, poster_url: null, duration_ms: null, status: 'processing', failure_reason: null };
  await act(async () => finish());
  expect(await screen.findByText('Udozo is preparing your video. Carry on: it joins the ad once it is ready.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(false);

  // Removed, then another refused by the API: the seller is told why in words.
  const removed: string[] = [];
  answers({
    ...base,
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'GET /v1/classifieds/me/listings/l1': () => listing({ title: 'iPhone', photos: [], video: removed.length ? null : video }),
    'DELETE /v1/classifieds/listings/l1/media/v1': () => (removed.push('v1'), null),
  });
  await fireEvent.press(screen.getByText('Remove the video'));
  await waitFor(() => expect(removed).toEqual(['v1']));
  (uploadListingVideo as jest.Mock).mockReturnValue({ done: Promise.reject(refused(409, 'video_exists', 'This listing already has a video. Remove it first.')), abort: jest.fn() });
  await fireEvent.press(await screen.findByText('Choose a video'));
  expect(await screen.findByText('This ad already has a video. Remove it first, then add another.')).toBeTruthy();
});

test('Record a video records with the camera and sends it through the same path, or says how to allow the camera', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1' });
  answers({
    ...base,
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'GET /v1/classifieds/me/listings/l1': () => listing({ title: 'iPhone', photos: [], video: null }),
  });
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  (pickVideo as jest.Mock).mockResolvedValueOnce({ video: null, refused: true });
  await renderScreen(<PostScreen />);
  await fireEvent.press(await screen.findByText('Record a video'));
  const dialog = within(await screen.findByTestId('dialog'));
  expect(dialog.getByRole('header', { name: 'Camera turned off' })).toBeTruthy();
  await fireEvent.press(dialog.getByRole('button', { name: 'Open settings' }));
  await waitFor(() => expect(settings).toHaveBeenCalled());
  expect(uploadListingVideo).not.toHaveBeenCalled();

  (pickVideo as jest.Mock).mockResolvedValueOnce({ video: { uri: 'file:///rec.mov', name: 'rec.mov', type: 'video/quicktime' } });
  (uploadListingVideo as jest.Mock).mockReturnValue({ done: Promise.resolve(), abort: jest.fn() });
  await fireEvent.press(screen.getByText('Record a video'));
  expect(pickVideo).toHaveBeenLastCalledWith('camera');
  await waitFor(() => expect(uploadListingVideo).toHaveBeenCalledWith('l1', expect.objectContaining({ type: 'video/quicktime' }), expect.any(Function)));
  settings.mockRestore();
});

test('brand and model come from their lists, a typed one is kept, and the title offers both', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'l1' });
  const withBrand = {
    data: [
      {
        ...categories.data[0],
        children: [{ ...categories.data[0].children[0], features: [{ key: 'model', name: 'Model', data_type: 'text', unit: null, choices: [], placeholder: null, filter: true }, { key: 'brand', name: 'Brand', data_type: 'text', unit: null, choices: [], placeholder: null, filter: true }] }],
      },
    ],
  };
  const samsung = { object: 'classified_brand', slug: 'samsung', name: 'Samsung', logo_url: null, color: null };
  const apple = { object: 'classified_brand', slug: 'apple', name: 'Apple', logo_url: null, color: null };
  const saved: unknown[] = [];
  answers({
    ...base,
    'GET /v1/classifieds/categories': withBrand,
    'GET /v1/classifieds/terms': { version: '2026-11-10', path: '/legal/terms', accepted: true, previous_version: null },
    'GET /v1/classifieds/me/listings/l1': listing({ title: 'Samsung Galaxy S23 Ultra', condition: null }),
    'GET /v1/classifieds/models/detect': { object: 'classified_model_match', brand: samsung, model: 'Galaxy S23 Ultra' },
    'GET /v1/classifieds/brands': { data: [apple, samsung] },
    'GET /v1/classifieds/models': { data: [{ object: 'classified_model', name: 'iPhone 15', brand: apple }] },
    'PATCH /v1/classifieds/listings/l1': (body: unknown) => (saved.push(body), listing()),
  });
  await renderScreen(<PostScreen />);
  expect(await screen.findByText('Step 3 of 6')).toBeTruthy();
  // The model sits straight after the brand, whatever order the category lists them in.
  const rows = screen.getAllByLabelText(/^(Brand|Model): /).map(row => row.props.accessibilityLabel);
  expect(rows).toEqual(['Brand: Choose or type it', 'Model: Choose or type it']);

  await fireEvent.press(await screen.findByText('Use this', {}, { timeout: 3000 }));
  expect(screen.getByLabelText('Brand: Samsung')).toBeTruthy();
  expect(screen.getByLabelText('Model: Galaxy S23 Ultra')).toBeTruthy();

  // Another brand from the list clears the model taken for Samsung.
  await fireEvent.press(screen.getByLabelText('Brand: Samsung'));
  await fireEvent.press(await screen.findByText('Apple'));
  expect(screen.getByLabelText('Brand: Apple')).toBeTruthy();
  expect(screen.getByLabelText('Model: Choose or type it')).toBeTruthy();

  // A model the list lacks is kept as typed.
  await fireEvent.press(screen.getByLabelText('Model: Choose or type it'));
  expect(await screen.findByText('iPhone 15')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Choose or type it'), 'iPhone 15 Pro Max Gold');
  await fireEvent.press(await screen.findByText('Use “iPhone 15 Pro Max Gold”'));
  expect(screen.getByLabelText('Model: iPhone 15 Pro Max Gold')).toBeTruthy();
});
